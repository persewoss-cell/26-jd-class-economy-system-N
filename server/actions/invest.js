// 📈 투자 : 종목/주가변동/관리장부/회수(지급)/투자하기/종목관리
import { col } from "../db.js";
import { fail, requireLogin, requireAny, requireStudent, adminRecorder } from "../auth.js";
import { adminTx, applyBalance, insertTx, redeemProjection, DEFAULT_POINT_PROFIT_PCT } from "../core.js";
import { str, toInt, toFloat, forr, as2, fmtMd, fmtInvestDt } from "../../shared/format.js";

const INV_ADMIN = ["admin::📈 투자"];

function normalizeTo100(real, mn, mx) {
  mn = as2(mn);
  mx = as2(mx);
  const rp = as2(real);
  if (mx <= mn) return 0;
  let pct = ((rp - mn) / (mx - mn)) * 100;
  pct = Math.max(0, Math.min(100, pct));
  return as2(pct);
}

async function getProducts(db, activeOnly = true) {
  const q = activeOnly ? { is_active: true } : {};
  const docs = await col(db, "invest_products").find(q);
  const out = [];
  for (const x of docs) {
    const nm = str(x.name).trim();
    if (!nm) continue;
    let mn = toFloat(as2(x.min_price ?? 0), 0) || 0;
    let mx = forr(as2(x.max_price ?? 100), 100);
    const rp = toFloat(x.real_price ?? x.current_price ?? 0, 0) || 0;
    if (mx <= mn) mx = mn + 1;
    const p = {
      product_id: String(x._id),
      name: nm,
      min_price: as2(mn),
      max_price: as2(mx),
      real_price: as2(rp),
      point_profit_pct: forr(x.point_profit_pct, DEFAULT_POINT_PROFIT_PCT),
      is_active: x.is_active === undefined ? true : !!x.is_active,
    };
    p.current_price = normalizeTo100(p.real_price, p.min_price, p.max_price);
    out.push(p);
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

async function getHistory(db, pid, limit = 120) {
  const docs = await db.collection("invest_price_history").find({ product_id: String(pid) }).sort({ created_at: -1 }).limit(limit).toArray();
  return docs.map((x) => {
    const pb = as2(x.price_before ?? x.price ?? 0);
    const pa = as2(x.price_after ?? x.price ?? 0);
    return {
      dt_text: fmtInvestDt(x.created_at),
      reason: str(x.reason).trim(),
      price_before: pb,
      price_after: pa,
      real_price_before: as2(x.real_price_before ?? x.price_before ?? x.price ?? 0),
      real_price_after: as2(x.real_price_after ?? x.price_after ?? x.price ?? 0),
    };
  });
}

function isAdminLike(ctx, adminMode) {
  if (!adminMode) return false;
  return ctx.isAdmin || ctx.perms.has("admin::📈 투자");
}

export default {
  async invest_load(ctx, { admin_mode }) {
    requireLogin(ctx);
    const db = ctx.db;
    const adminLike = isAdminLike(ctx, admin_mode);
    if (admin_mode && !adminLike) fail("권한이 없습니다.");
    const products = await getProducts(db, true);
    const histories = {};
    await Promise.all(products.map(async (p) => {
      histories[p.product_id] = await getHistory(db, p.product_id, 120);
    }));
    const q = adminLike ? {} : { student_id: ctx.sid };
    const led = await db.collection("invest_ledger").find(q).sort({ buy_at: -1 }).limit(400).toArray();
    const priceBy = Object.fromEntries(products.map((p) => [p.product_id, p]));
    const ledger = led.map((x) => {
      const redeemed = !!x.redeemed;
      const pct = forr(x.point_profit_pct, DEFAULT_POINT_PROFIT_PCT);
      const row = {
        doc_id: String(x._id),
        student_id: str(x.student_id),
        product_id: str(x.product_id),
        no: toInt(x.no),
        name: str(x.name),
        product_name: str(x.product_name),
        buy_date_label: str(x.buy_date_label),
        buy_price: as2(x.buy_price ?? 0),
        pct,
        invest_amount: toInt(x.invest_amount),
        redeemed,
        sell_date_label: str(x.sell_date_label ?? x.redeemed_label ?? ""),
        sell_price: as2(x.sell_price ?? x.redeemed_price ?? 0),
        diff: as2(x.diff ?? 0),
        profit: Math.round(toFloat(x.profit ?? x.redeemed_profit ?? 0, 0)),
        redeem_amount: toInt(x.redeem_amount ?? x.redeemed_amount ?? 0),
      };
      if (!redeemed) {
        const p = priceBy[row.product_id];
        const cur = p ? as2(p.current_price) : row.buy_price;
        const pr = redeemProjection(row.invest_amount, row.buy_price, cur, null, null, pct);
        row.cur_price = cur;
        row.proj_diff = pr.diff;
        row.proj_profit = pr.profit;
        row.proj_redeem = pr.redeem;
      }
      return row;
    });
    let investEnabled = true;
    if (!ctx.isAdmin && ctx.student) investEnabled = ctx.student.invest_enabled === undefined || ctx.student.invest_enabled === null ? true : !!ctx.student.invest_enabled;
    const out = { products, histories, ledger, admin_like: adminLike, invest_enabled: investEnabled };
    if (adminLike) out.all_products = await getProducts(db, false);
    return out;
  },

  async invest_price_update(ctx, { product_id, reason, real_price }) {
    requireAny(ctx, INV_ADMIN);
    const db = ctx.db;
    reason = str(reason).trim();
    if (!reason) fail("변동 사유를 입력해 주세요.");
    const products = await getProducts(db, true);
    const p = products.find((x) => x.product_id === String(product_id));
    if (!p) fail("종목을 찾지 못했어요.");
    const norm = normalizeTo100(real_price, p.min_price, p.max_price);
    await col(db, "invest_price_history").add({
      product_id: p.product_id,
      reason,
      price_before: as2(p.current_price),
      price_after: as2(norm),
      real_price_before: as2(p.real_price),
      real_price_after: as2(real_price),
      created_at: new Date(),
    });
    await col(db, "invest_products").set(p.product_id, { real_price: as2(real_price), current_price: as2(norm), updated_at: new Date() }, true);
    return {};
  },

  async invest_redeem(ctx, { doc_id }) {
    requireAny(ctx, INV_ADMIN);
    const db = ctx.db;
    const x = await col(db, "invest_ledger").get(doc_id);
    if (!x) fail("투자 내역을 찾지 못했어요.");
    if (x.redeemed) fail("이미 지급 완료된 내역입니다.");
    const products = await getProducts(db, true);
    const pid = str(x.product_id);
    const buy = as2(x.buy_price ?? 0);
    let cur = buy;
    let curReal = buy;
    const p = products.find((pp) => pp.product_id === pid);
    if (p) {
      cur = as2(p.current_price);
      curReal = as2(p.real_price);
    }
    const pct = forr(x.point_profit_pct, DEFAULT_POINT_PROFIT_PCT);
    const pr = redeemProjection(toInt(x.invest_amount), buy, cur, null, null, pct);
    const sellLabel = fmtMd(new Date());
    // 두 번 지급되지 않도록 먼저 선점
    const claimed = await col(db, "invest_ledger").updateIf(String(doc_id), { redeemed: { $ne: true } }, { redeemed: true, redeemed_at: new Date() });
    if (!claimed) fail("이미 지급 완료된 내역입니다.");
    const deposit = Math.round(pr.redeem);
    try {
      if (deposit > 0) {
        await adminTx(db, { sid: str(x.student_id), memo: `투자 회수(${str(x.product_name)})`, deposit, recorder: adminRecorder(ctx) });
      }
    } catch (e) {
      await col(db, "invest_ledger").update(String(doc_id), { redeemed: false, redeemed_at: null });
      throw e;
    }
    await col(db, "invest_ledger").update(String(doc_id), {
      sell_date_label: sellLabel,
      sell_price: as2(cur),
      sell_real_price: as2(curReal),
      diff: as2(pr.diff),
      real_diff: as2(pr.diff),
      profit: Math.round(pr.profit),
      redeem_amount: deposit,
      redeemed_label: sellLabel,
      redeemed_amount: deposit,
    });
    return {};
  },

  async invest_buy(ctx, { product_id, amount }) {
    requireStudent(ctx);
    const db = ctx.db;
    amount = toInt(amount);
    const s = ctx.student;
    const enabled = s.invest_enabled === undefined || s.invest_enabled === null ? true : !!s.invest_enabled;
    if (!enabled) fail("이 계정은 현재 투자 기능이 비활성화되어 있어요.");
    if (amount <= 0) fail("투자 금액을 입력해 주세요.");
    const products = await getProducts(db, true);
    const p = products.find((x) => x.product_id === String(product_id)) || products[0];
    if (!p) fail("투자 종목이 아직 없어요. 관리자에게 종목 추가를 요청해 주세요.");
    const doc = await applyBalance(db, ctx.sid, -amount, { minBalance: amount });
    if (!doc) fail("통장 잔액보다 큰 액수는 투자할 수 없어요");
    await insertTx(db, { sid: ctx.sid, type: "withdraw", amount: -amount, balanceAfter: toInt(doc.balance), memo: `투자 매입(${p.name})`, recorder: str(s.name) });
    await col(db, "invest_ledger").add({
      student_id: ctx.sid,
      no: toInt(s.no),
      name: str(s.name),
      product_id: p.product_id,
      product_name: p.name,
      buy_at: new Date(),
      buy_date_label: fmtMd(new Date()),
      buy_price: as2(p.current_price),
      buy_real_price: as2(p.real_price),
      point_profit_pct: forr(p.point_profit_pct, DEFAULT_POINT_PROFIT_PCT),
      invest_amount: amount,
      redeemed: false,
    });
    return {};
  },

  async invest_product_save(ctx, { product_id, name, min_price, max_price, real_price, point_profit_pct }) {
    requireAny(ctx, INV_ADMIN);
    const db = ctx.db;
    const nm = str(name).trim();
    if (!nm) fail("종목명을 입력해 주세요.");
    if (toFloat(max_price) <= toFloat(min_price)) fail("최대값은 최하값보다 크게 입력해 주세요.");
    const all = await getProducts(db, false);
    const key = nm.replace(/ /g, "").toLowerCase();
    const dup = all.find((p) => str(p.name).trim().replace(/ /g, "").toLowerCase() === key);
    const norm = normalizeTo100(real_price, min_price, max_price);
    const payload = {
      name: nm,
      min_price: as2(min_price),
      max_price: as2(max_price),
      real_price: as2(real_price),
      current_price: as2(norm),
      point_profit_pct: toFloat(point_profit_pct, 0),
      is_active: true,
      updated_at: new Date(),
    };
    if (!product_id && dup) {
      if (dup.is_active) fail("이미 같은 종목명이 있어요. (중복 추가 불가)");
      await col(db, "invest_products").set(dup.product_id, payload, true);
      return { result: "restored" };
    }
    if (product_id && dup && dup.product_id !== String(product_id)) fail("이미 같은 종목명이 있어요. (중복 이름 불가)");
    if (!product_id) {
      await col(db, "invest_products").add({ ...payload, created_at: new Date() });
      return { result: "added" };
    }
    await col(db, "invest_products").set(String(product_id), payload, true);
    return { result: "updated" };
  },

  async invest_product_delete(ctx, { product_id }) {
    requireAny(ctx, INV_ADMIN);
    if (!product_id) fail("종목을 선택해 주세요.");
    await col(ctx.db, "invest_products").set(String(product_id), { is_active: false, updated_at: new Date() }, true);
    return {};
  },
};
