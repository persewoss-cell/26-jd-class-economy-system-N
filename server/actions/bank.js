// 🏦 내 통장(💰입금/출금) : 일괄/개인 입출금, 템플릿, 되돌리기, 학생 거래, 입금 승인
import { col } from "../db.js";
import { fail, requireLogin, requireAny, requireStudent, isAdminPin, adminRecorder } from "../auth.js";
import {
  adminTx, studentTx, treasuryApply, applyBalance, insertTx, getTxRows, isSavingsMemo, isInvestMemo,
  listAccounts, activeStudents,
} from "../core.js";
import { str, toInt, ior, toDate, fmtMmDd, fmtMd } from "../../shared/format.js";

const BANK_ADMIN = ["admin::🏦 내 통장"];
const SAV_ADMIN = ["admin::🏦 은행(적금)"];

function parseTemplateLabel(label) {
  const s = str(label).trim();
  if (s.startsWith("[") && s.includes("]")) {
    const end = s.indexOf("]");
    const cat = s.slice(1, end).trim();
    let rest = s.slice(end + 1).trim();
    if (rest.startsWith("-")) rest = rest.slice(1).trim();
    return [cat, rest];
  }
  return ["", s];
}

function composeLabel(base, cat) {
  base = str(base).trim();
  cat = str(cat).trim();
  return cat ? `[${cat}] ${base}` : base;
}

export async function listTemplates(db) {
  const docs = await col(db, "templates").find({});
  const out = [];
  for (const t of docs) {
    if (!t.label) continue;
    out.push({
      template_id: String(t._id),
      label: t.label,
      category: str(t.category),
      base_label: str(t.base_label),
      kind: t.kind,
      amount: toInt(t.amount),
      order: ior(t.order, 999999),
    });
  }
  out.sort((a, b) => a.order - b.order || (String(a.label) < String(b.label) ? -1 : String(a.label) > String(b.label) ? 1 : 0));
  return out;
}

async function upsertTemplate(db, { template_id, base_label, category, kind, amount, order }) {
  base_label = str(base_label).trim();
  category = str(category).trim();
  const label = composeLabel(base_label, category);
  kind = str(kind).trim();
  amount = toInt(amount);
  order = ior(order, 1);
  if (!label) fail("내역 이름이 필요합니다.");
  if (kind !== "deposit" && kind !== "withdraw") fail("종류는 deposit/withdraw만 가능합니다.");
  if (amount <= 0) fail("금액은 1 이상이어야 합니다.");
  if (order <= 0) fail("순서는 1 이상이어야 합니다.");
  const payload = { label, base_label, category, kind, amount, order };
  if (template_id) await col(db, "templates").set(template_id, payload, true);
  else await col(db, "templates").add(payload);
}

function canRollbackRow(r, blockInvest) {
  if (r.type === "rollback") return false;
  if (isSavingsMemo(r.memo) || r.type === "maturity") return false;
  if (blockInvest && isInvestMemo(r.memo)) return false;
  return true;
}

// api_admin_rollback_selected
async function rollbackSelected(db, ctx, sid, txIds) {
  if (!sid || !txIds || !txIds.length) fail("되돌릴 항목이 없습니다.");
  const txDocs = [];
  for (const tid of txIds) {
    const tx = await col(db, "transactions").get(tid);
    if (!tx || str(tx.student_id) !== String(sid)) continue;
    txDocs.push(tx);
  }
  if (!txDocs.length) fail("유효한 거래를 찾지 못했습니다.");
  const blocked = [];
  const valid = [];
  for (const tx of txDocs) {
    const t = str(tx.type);
    const memo = str(tx.memo);
    if (t === "rollback") { blocked.push(tx); continue; }
    if (isSavingsMemo(memo) || t === "maturity") { blocked.push(tx); continue; }
    if (isInvestMemo(memo)) { blocked.push(tx); continue; }
    const already = await db.collection("transactions").findOne({ student_id: String(sid), type: "rollback", related_tx: String(tx._id) });
    if (already) { blocked.push(tx); continue; }
    valid.push(tx);
  }
  if (!valid.length) {
    let msg = "선택한 항목이 모두 되돌리기 불가합니다.";
    if (blocked.length) msg += " (예: 적금/이미 되돌림)";
    fail(msg);
  }
  valid.sort((a, b) => (toDate(a.created_at)?.getTime() || 0) - (toDate(b.created_at)?.getTime() || 0));
  let undone = 0;
  let delta = 0;
  const recorder = adminRecorder(ctx);
  for (const tx of valid) {
    const amount = toInt(tx.amount);
    const rb = -amount;
    const origMemo = str(tx.memo).trim();
    const rbMemo = `${origMemo || "내역"}(${fmtMmDd(tx.created_at)}) 되돌리기`;
    const origTre = toInt(tx.treasury_signed);
    if (origTre !== 0) {
      await treasuryApply(db, { memo: rbMemo, signed: -origTre, actor: "rollback", recorder });
    }
    const doc = await applyBalance(db, sid, rb);
    await insertTx(db, {
      sid, type: "rollback", amount: rb, balanceAfter: toInt(doc && doc.balance), memo: rbMemo, recorder,
      extra: { apply_treasury: origTre !== 0, treasury_signed: -origTre, treasury_memo: rbMemo, related_tx: String(tx._id) },
    });
    undone += 1;
    delta += rb;
  }
  const message = blocked.length ? `되돌리기 제외 ${blocked.length}건(적금/이미 되돌림 등)은 건너뛰었습니다.` : null;
  return { undone, delta, message };
}

// 입금 신청 승인/거절
async function approveDeposit(db, ctx, rid) {
  rid = str(rid).trim();
  if (!rid) fail("request_id가 없습니다.");
  const req = await col(db, "deposit_requests").get(rid);
  if (!req) fail("신청서를 찾지 못했습니다.");
  if (str(req.status || "pending") !== "pending") fail("이미 처리된 신청입니다.");
  const sid = str(req.student_id).trim();
  if (!sid) fail("student_id가 없습니다.");
  const amount = toInt(req.amount);
  if (amount <= 0) fail("금액이 올바르지 않습니다.");
  const st = await col(db, "students").get(sid);
  if (!st) fail("대상 학생을 찾지 못했습니다.");
  // 동시에 두 번 승인되지 않도록 먼저 선점
  const claimed = await col(db, "deposit_requests").updateIf(rid, { $or: [{ status: "pending" }, { status: { $exists: false } }, { status: null }, { status: "" }] }, { status: "approving" });
  if (!claimed) fail("이미 처리된 신청입니다.");
  const memo = str(req.memo).trim() || "입금";
  const recorder = adminRecorder(ctx);
  if (req.apply_treasury) {
    await treasuryApply(db, { memo: str(req.treasury_memo || memo).trim(), signed: -amount, actor: "deposit_approve", recorder });
  }
  const doc = await applyBalance(db, sid, amount);
  const txId = await insertTx(db, { sid, type: "deposit", amount, balanceAfter: toInt(doc && doc.balance), memo, recorder });
  await col(db, "deposit_requests").update(rid, { status: "approved", processed_at: new Date(), tx_id: String(txId) });
  return true;
}

async function rejectDeposit(db, rid) {
  rid = str(rid).trim();
  if (!rid) fail("request_id가 없습니다.");
  const req = await col(db, "deposit_requests").get(rid);
  if (!req) fail("신청서를 찾지 못했습니다.");
  if (str(req.status || "pending") !== "pending") fail("이미 처리된 신청입니다.");
  await col(db, "deposit_requests").update(rid, { status: "rejected", processed_at: new Date() });
  return true;
}

export default {
  async templates_list(ctx) {
    requireLogin(ctx);
    return { templates: await listTemplates(ctx.db) };
  },

  async accounts_list(ctx) {
    requireLogin(ctx);
    return { accounts: await listAccounts(ctx.db) };
  },

  async tx_list(ctx, { sid, limit }) {
    requireLogin(ctx);
    let target = ctx.sid;
    if (sid && String(sid) !== ctx.sid) {
      requireAny(ctx, ["admin::🏦 내 통장", "tab::🔎 개별조회"]);
      target = String(sid);
    }
    if (!target) fail("student_id가 없습니다.");
    const rows = await getTxRows(ctx.db, target, toInt(limit, 300) || 300);
    rows.forEach((r) => {
      r.can_rollback_admin = canRollbackRow(r, true);
      r.can_rollback_user = canRollbackRow(r, false);
    });
    let balance = null;
    if (target === ctx.sid) balance = toInt((await col(ctx.db, "students").get(target))?.balance);
    return { rows, balance };
  },

  // 전체 일괄 입금/출금
  async bank_bulk(ctx, { memo, dep, wd, treasury }) {
    requireAny(ctx, BANK_ADMIN);
    const db = ctx.db;
    dep = toInt(dep);
    wd = toInt(wd);
    memo = str(memo).trim();
    if ((dep > 0 && wd > 0) || (dep === 0 && wd === 0)) fail("입금/출금은 둘 중 하나만 입력해 주세요.");
    if (!memo) fail("내역(메모)을 입력해 주세요.");
    const recorder = adminRecorder(ctx);
    const amount = dep > 0 ? dep : wd;
    const signed = dep > 0 ? amount : -amount;
    const studs = await db.collection("students").find({ is_active: true }, { projection: { _id: 1 } }).toArray();
    let count = 0;
    for (const s of studs) {
      const doc = await applyBalance(db, s._id, signed);
      await insertTx(db, { sid: s._id, type: dep > 0 ? "deposit" : "withdraw", amount: signed, balanceAfter: toInt(doc && doc.balance), memo, recorder });
      count += 1;
    }
    if (treasury && count > 0) {
      await treasuryApply(db, { memo: `전체 ${memo}`.trim(), signed: dep > 0 ? -(dep * count) : wd * count, actor: "전체", recorder });
    }
    return { count, mode: dep > 0 ? "deposit" : "withdraw" };
  },

  // 체크한 학생만 입금/출금
  async bank_personal(ctx, { sids, memo, dep, wd, treasury }) {
    requireAny(ctx, BANK_ADMIN);
    const db = ctx.db;
    dep = toInt(dep);
    wd = toInt(wd);
    memo = str(memo).trim();
    if ((dep > 0 && wd > 0) || (dep === 0 && wd === 0)) fail("입금/출금은 둘 중 하나만 입력해 주세요.");
    if (!memo) fail("내역(메모)을 입력해 주세요.");
    sids = (sids || []).map(String).filter(Boolean);
    const isDeposit = dep > 0;
    if (!sids.length) return { ok_cnt: 0, mode: isDeposit ? "deposit" : "withdraw", empty: true };
    const accs = await activeStudents(db);
    const disp = {};
    for (const a of accs) {
      const no = toInt(a.no);
      disp[a.student_id] = no > 0 ? `${no}번 ${str(a.name)}` : str(a.name);
    }
    const recorder = adminRecorder(ctx);
    let okCnt = 0;
    const fails = [];
    for (const sid of sids) {
      const d = disp[sid] || sid;
      try {
        await adminTx(db, { sid, memo, deposit: dep, withdraw: wd, applyTreasury: !!treasury, treasuryMemo: `${d} ${memo}`.trim(), actor: d, recorder });
        okCnt += 1;
      } catch (e) {
        fails.push(e.userMessage || String(e.message || e));
      }
    }
    if (okCnt === 0) fail("적용 실패: " + (fails[0] || "알 수 없는 오류"));
    return { ok_cnt: okCnt, mode: isDeposit ? "deposit" : "withdraw" };
  },

  async rollback(ctx, { admin_pin, sid, tx_ids }) {
    requireLogin(ctx);
    if (!isAdminPin(admin_pin)) fail("관리자 PIN이 틀립니다.");
    return await rollbackSelected(ctx.db, ctx, String(sid || ctx.sid), (tx_ids || []).map(String));
  },

  async template_save(ctx, args) {
    requireAny(ctx, BANK_ADMIN);
    await upsertTemplate(ctx.db, args);
    return {};
  },

  async template_delete(ctx, { template_id }) {
    requireAny(ctx, BANK_ADMIN);
    template_id = str(template_id).trim();
    if (!template_id) fail("template_id가 필요합니다.");
    await col(ctx.db, "templates").del(template_id);
    return {};
  },

  async templates_bulk_save(ctx, { rows, delete_old }) {
    requireAny(ctx, BANK_ADMIN);
    const db = ctx.db;
    if (!rows || !rows.length) fail("먼저 올바른 엑셀을 업로드하세요.");
    if (delete_old) await db.collection("templates").deleteMany({});
    let saved = 0;
    const map = { 입금: "deposit", 출금: "withdraw" };
    for (const r of rows) {
      const cat = str(r["구분"]).trim();
      try {
        await upsertTemplate(db, {
          template_id: "",
          base_label: str(r["내역이름"]).trim(),
          category: cat === "없음" ? "" : cat,
          kind: map[str(r["종류"]).trim()] || "deposit",
          amount: toInt(r["금액"]),
          order: toInt(r["순서"]),
        });
        saved += 1;
      } catch {
        /* 기존처럼 실패 행은 건너뜀 */
      }
    }
    return { saved };
  },

  // 학생: 입금은 승인대기, 출금은 즉시
  async student_trade(ctx, { memo, dep, wd, treasury }) {
    requireStudent(ctx);
    const db = ctx.db;
    memo = str(memo).trim();
    dep = toInt(dep);
    wd = toInt(wd);
    if (!memo) fail("내역을 입력해 주세요.");
    if ((dep > 0 && wd > 0) || (dep === 0 && wd === 0)) fail("입금/출금은 둘 중 하나만 입력해 주세요.");
    const s = ctx.student;
    const no = toInt(s.no);
    const disp = no > 0 ? `${no}번 ${str(s.name)}` : str(s.name);
    const treMemo = `${disp} ${memo}`.trim();
    if (dep > 0) {
      await col(db, "deposit_requests").add({
        student_id: ctx.sid, no, name: str(s.name), memo, amount: dep, apply_treasury: !!treasury,
        treasury_memo: treMemo, status: "pending", created_at: new Date(), processed_at: null, tx_id: "",
      });
      return { mode: "request" };
    }
    const res = await studentTx(db, { student: s, memo, withdraw: wd, applyTreasury: !!treasury, treasuryMemo: treMemo, actor: disp });
    return { mode: "withdraw", balance: res.balance };
  },

  async dep_req_list(ctx) {
    requireAny(ctx, SAV_ADMIN);
    const docs = await ctx.db.collection("deposit_requests").find({}).sort({ created_at: 1 }).limit(300).toArray();
    const rows = docs
      .filter((x) => str(x.status || "pending") === "pending")
      .map((x) => ({
        request_id: String(x._id),
        no: toInt(x.no),
        name: str(x.name),
        when: fmtMd(x.created_at),
        memo: str(x.memo),
        amount: toInt(x.amount),
        apply_treasury: !!x.apply_treasury,
      }));
    return { rows };
  },

  async dep_req_process(ctx, { ids, action }) {
    requireAny(ctx, SAV_ADMIN);
    ids = (ids || []).map((x) => str(x).trim()).filter(Boolean);
    if (!ids.length) fail("처리할 신청이 없습니다.");
    if (action !== "approve" && action !== "reject") fail("잘못된 처리 유형입니다.");
    let processed = 0;
    let failed = 0;
    const errors = [];
    for (const rid of ids) {
      try {
        if (action === "approve") await approveDeposit(ctx.db, ctx, rid);
        else await rejectDeposit(ctx.db, rid);
        processed += 1;
      } catch (e) {
        failed += 1;
        errors.push(`${rid}: ${e.userMessage || e.message}`);
      }
    }
    return { processed, failed, errors, error: processed === 0 ? (errors[0] || "처리 실패").replace(/^[^:]+: /, "") : undefined };
  },
};

export { parseTemplateLabel };
