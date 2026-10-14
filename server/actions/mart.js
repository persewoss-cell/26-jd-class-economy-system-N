// 🛒 마트
import { col } from "../db.js";
import { fail, requireAny, requireStudent, adminRecorder } from "../auth.js";
import { adminTx } from "../core.js";
import { str, toInt, ior, fmtKrDatetime, kstParts, pad2, KST_OFFSET_MS } from "../../shared/format.js";

const MART_ADMIN = ["admin::🛒마트"];

// 주간 기준: 월요일 06:00(KST) ~ 다음 월요일 06:00
function weekKey(now = new Date()) {
  const p = kstParts(now);
  // KST 기준 오늘 06:00의 UTC 시각
  let monday6 = Date.UTC(p.year, p.month - 1, p.day, 6, 0, 0) - KST_OFFSET_MS - p.dowIdx * 86400000;
  if (now.getTime() < monday6) monday6 -= 7 * 86400000;
  const k = kstParts(new Date(monday6));
  return `${k.year}-${pad2(k.month)}-${pad2(k.day)}_06`;
}

async function getLimit(db) {
  const d = await col(db, "configs").get("mart");
  return toInt(d && d.weekly_limit);
}

async function listTemplates(db) {
  const docs = await col(db, "mart_templates").find({});
  const rows = docs
    .map((x) => ({ template_id: String(x._id), item: str(x.item).trim(), price: toInt(x.price), order: ior(x.order, 999999) }))
    .filter((r) => r.item);
  rows.sort((a, b) => a.order - b.order || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  return rows;
}

async function normalizeOrders(db, preferredId = "", preferredOrder = null) {
  const raw = (await col(db, "mart_templates").find({}))
    .map((x) => ({ template_id: String(x._id), item: str(x.item).trim(), order: ior(x.order, 999999) }))
    .filter((r) => r.item);
  if (!raw.length) return;
  raw.sort((a, b) => a.order - b.order || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0) || (a.template_id < b.template_id ? -1 : 1));
  let rows = raw;
  if (preferredId && raw.some((r) => r.template_id === preferredId)) {
    const target = raw.find((r) => r.template_id === preferredId);
    const rest = raw.filter((r) => r.template_id !== preferredId);
    let pos = preferredOrder !== null ? preferredOrder : target.order;
    pos = Math.max(1, Math.min(toInt(pos), raw.length));
    rows = [...rest.slice(0, pos - 1), target, ...rest.slice(pos - 1)];
  }
  let i = 1;
  for (const r of rows) {
    if (r.order !== i) await col(db, "mart_templates").set(r.template_id, { order: i, updated_at: new Date() }, true);
    i += 1;
  }
}

async function upsertTemplate(db, { item, price, order, template_id, normalize = true }) {
  item = str(item).trim();
  if (!item) fail("내역을 입력해 주세요.");
  const o = Math.max(1, ior(order, 1));
  let id = template_id ? String(template_id) : null;
  const payload = { item, price: toInt(price), order: o, updated_at: new Date(), created_at: new Date() };
  if (id) await col(db, "mart_templates").set(id, payload, true);
  else id = await col(db, "mart_templates").add(payload);
  if (normalize) await normalizeOrders(db, id, o);
}

async function usedThisWeek(db, sid) {
  return await db.collection("mart_requests").countDocuments({ student_id: String(sid), week_key: weekKey(), status: { $in: ["approved", "pending"] } });
}

export default {
  async mart_user_load(ctx) {
    requireStudent(ctx);
    const db = ctx.db;
    const limit = await getLimit(db);
    if (limit <= 0) return { blocked: "이번주는 마트 구입이 불가능합니다" };
    const used = await usedThisWeek(db, ctx.sid);
    if (used >= limit) return { blocked: "이번 주 간식은 구매 가능 횟수만큼 모두 구입하셨습니다." };
    return { templates: await listTemplates(db) };
  },

  async mart_request(ctx, { item, price }) {
    requireStudent(ctx);
    const db = ctx.db;
    const limit = await getLimit(db);
    if (limit <= 0) fail("이번주는 마트 구입이 불가능합니다");
    if ((await usedThisWeek(db, ctx.sid)) >= limit) fail("이번 주 간식은 구매 가능 횟수만큼 모두 구입하셨습니다.");
    item = str(item).trim();
    if (!item) fail("내역을 입력해 주세요.");
    price = toInt(price);
    if (price <= 0) fail("금액은 1 이상이어야 합니다.");
    const s = await col(db, "students").get(ctx.sid);
    if (price > toInt(s && s.balance)) fail("통장 잔액이 부족해서 구입할 수 없어요.");
    await col(db, "mart_requests").add({
      student_id: ctx.sid, student_no: toInt(s.no), student_name: str(s.name), item, price, status: "pending", week_key: weekKey(), created_at: new Date(),
    });
    return {};
  },

  async mart_admin_load(ctx) {
    requireAny(ctx, MART_ADMIN);
    const db = ctx.db;
    const limit = await getLimit(db);
    let available = [];
    if (limit > 0) {
      const studs = await db.collection("students").find({}).toArray();
      const wk = weekKey();
      const counts = await db.collection("mart_requests").aggregate([
        { $match: { week_key: wk, status: { $in: ["approved", "pending"] } } },
        { $group: { _id: "$student_id", n: { $sum: 1 } } },
      ]).toArray();
      const cm = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
      const set = new Map();
      for (const s of studs) {
        const no = toInt(s.no);
        if (no <= 0) continue;
        if ((cm[String(s._id)] || 0) < limit) set.set(`${no}|${str(s.name).trim()}`, [no, str(s.name).trim()]);
      }
      available = [...set.values()].sort((a, b) => a[0] - b[0]);
    }
    const pendDocs = await db.collection("mart_requests").find({ status: "pending" }).sort({ created_at: 1 }).limit(200).toArray();
    const pending = pendDocs.map((x) => ({
      request_id: String(x._id), created_at_kr: x.created_at ? fmtKrDatetime(x.created_at) : "", student_no: toInt(x.student_no), student_name: str(x.student_name), item: str(x.item), price: toInt(x.price),
    }));
    const led = await db.collection("mart_ledger").find({}).sort({ approved_at: -1 }).limit(300).toArray();
    const ledger = led.map((x) => ({ 구입일시: fmtKrDatetime(x.approved_at), 번호: toInt(x.student_no), 이름: str(x.student_name), 구입내역: str(x.item), 구입가격: toInt(x.price) }));
    return { limit, available, pending, ledger, templates: await listTemplates(db) };
  },

  async mart_limit_save(ctx, { weekly_limit }) {
    requireAny(ctx, MART_ADMIN);
    await col(ctx.db, "configs").set("mart", { weekly_limit: toInt(weekly_limit), updated_at: new Date() }, true);
    return {};
  },

  async mart_approve(ctx, { request_id }) {
    requireAny(ctx, MART_ADMIN);
    const db = ctx.db;
    const req = await col(db, "mart_requests").get(request_id);
    if (!req) fail("요청을 찾을 수 없습니다.");
    if (str(req.status) !== "pending") fail("이미 처리된 요청입니다.");
    const sid = str(req.student_id);
    const name = str(req.student_name);
    const item = str(req.item);
    const price = toInt(req.price);
    if (!sid || price <= 0) fail("요청 데이터가 올바르지 않습니다.");
    const label = adminRecorder(ctx);
    const claimed = await col(db, "mart_requests").updateIf(String(request_id), { status: "pending" }, { status: "approving" });
    if (!claimed) fail("이미 처리된 요청입니다.");
    try {
      await adminTx(db, { sid, memo: `마트 구입(${item})`, withdraw: price, applyTreasury: true, treasuryMemo: `마트 구입 세입 ${name} ${item}`.trim(), actor: "mart", recorder: label, requireBalance: true });
    } catch (e) {
      await col(db, "mart_requests").update(String(request_id), { status: "pending" });
      throw e;
    }
    await col(db, "mart_requests").set(String(request_id), { status: "approved", approved_at: new Date(), approved_by: label }, true);
    await col(db, "mart_ledger").add({ request_id: String(request_id), student_id: sid, student_no: toInt(req.student_no), student_name: name, item, price, approved_at: new Date() });
    return {};
  },

  async mart_reject(ctx, { request_id }) {
    requireAny(ctx, MART_ADMIN);
    // 대기 중인 요청만 거절 (이미 승인된 것을 거절해 돈은 빠지고 기록만 바뀌는 일 방지)
    const ok = await col(ctx.db, "mart_requests").updateIf(String(request_id), { status: "pending" }, { status: "rejected", rejected_at: new Date() });
    if (!ok) fail("이미 처리된 요청입니다.");
    return {};
  },

  async mart_tpl_save(ctx, args) {
    requireAny(ctx, MART_ADMIN);
    await upsertTemplate(ctx.db, args);
    return {};
  },

  async mart_tpl_delete(ctx, { template_id }) {
    requireAny(ctx, MART_ADMIN);
    await col(ctx.db, "mart_templates").del(String(template_id));
    await normalizeOrders(ctx.db);
    return {};
  },

  async mart_tpl_bulk(ctx, { rows, overwrite }) {
    requireAny(ctx, MART_ADMIN);
    const db = ctx.db;
    if (overwrite) await db.collection("mart_templates").deleteMany({});
    let n = 0;
    for (const r of rows || []) {
      const item = str(r["내역"]).trim();
      if (!item) continue;
      await upsertTemplate(db, { item, price: toInt(r["금액"]), order: Math.max(1, ior(r["순서"], 1)), template_id: "", normalize: false });
      n += 1;
    }
    await normalizeOrders(db);
    return { n };
  },
};

export { weekKey };
