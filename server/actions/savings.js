// 🏦 은행(적금) : 관리자 적금 관리 장부/중도해지, 학생 적금 가입/내역/중도해지, 이자율표
import { col } from "../db.js";
import { fail, requireLogin, requireAny, requireStudent, adminRecorder } from "../auth.js";
import { adminTx, applyBalance, insertTx, calcCredit, runAutoPayouts } from "../core.js";
import { str, toInt, toFloat, toDate, fmtMd, fmtMmDd, pyRound } from "../../shared/format.js";

const SAV_ADMIN = ["admin::🏦 은행(적금)"];

function excelRates() {
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rates = {};
  for (let g = 1; g <= 10; g++) {
    rates[String(g)] = {};
    for (const w of weeks) rates[String(g)][String(w)] = (11 - g) * w;
  }
  return { weeks, rates };
}

function sameTable(d) {
  try {
    const x = excelRates();
    const wdb = (d.weeks || []).map((v) => toInt(v));
    if (JSON.stringify(wdb) !== JSON.stringify(x.weeks)) return false;
    for (let g = 1; g <= 10; g++) {
      const gm = (d.rates || {})[String(g)];
      if (!gm) return false;
      for (const w of x.weeks) if (toInt(gm[String(w)] ?? -999) !== x.rates[String(g)][String(w)]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// config/bank_rates: 엑셀 표(1~10주)와 다르면 자동으로 덮어씀(기존과 동일)
async function bankRateCfg(db) {
  const d = await col(db, "config").get("bank_rates");
  if (d && sameTable(d)) return { weeks: d.weeks || [], rates: d.rates || {} };
  const x = excelRates();
  await col(db, "config").set("bank_rates", { weeks: x.weeks, rates: x.rates, updated_at: new Date() }, false);
  return x;
}

function rateFor(cfg, grade, weeks) {
  let g = toInt(grade);
  let w = toInt(weeks);
  g = g < 1 ? 1 : g > 10 ? 10 : g;
  w = w < 1 ? 1 : w > 10 ? 10 : w;
  return toFloat(((cfg.rates || {})[String(g)] || {})[String(w)] ?? 0, 0);
}

function computeInterest(principal, rate) {
  return pyRound(toFloat(principal) * (toFloat(rate) / 100));
}

// 파이썬 f"{float(x)}%" : 10 → "10.0%"
function pyFloatStr(v) {
  const n = toFloat(v, 0);
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

function rowView(r, now) {
  const start = toDate(r.start_utc);
  const mat = toDate(r.maturity_utc);
  const status = str(r.status || "running");
  let result;
  if (status === "canceled") {
    const cdt = toDate(r.processed_at || r.updated_at || r.canceled_at);
    result = cdt ? `중도해지(${fmtMmDd(cdt)})` : "중도해지";
  } else result = mat && mat <= now ? "만기" : "진행중";
  let payout;
  if (result === "진행중") payout = "-";
  else if (result.startsWith("중도해지")) payout = toInt(r.payout_amount) || toInt(r.principal);
  else payout = toInt(r.payout_amount) || toInt(r.maturity_amount);
  return {
    _id: String(r._id),
    _status: status,
    번호: toInt(r.no),
    이름: str(r.name),
    적금기간: `${toInt(r.weeks)}주`,
    신용등급: `${toInt(r.credit_grade) || 10}등급`,
    이자율: `${pyFloatStr(r.rate_percent)}%`,
    "적금 금액": toInt(r.principal),
    이자: toInt(r.interest),
    "만기 금액": toInt(r.maturity_amount),
    "적금 날짜": start ? fmtMd(start) : "",
    "만기 날짜": mat ? fmtMd(mat) : "",
    "처리 결과": result,
    "지급 금액": payout,
  };
}

// 관리자 화면을 열 때: running 이고 만기 지난 적금 자동 처리 (기존 _ensure_maturity_processing_once)
async function tabMaturity(db) {
  const now = new Date();
  const docs = await db.collection("savings").find({ status: "running" }).toArray();
  let cnt = 0;
  for (const x of docs) {
    const m = toDate(x.maturity_utc);
    if (!m || m > now) continue;
    const sid = str(x.student_id);
    if (!sid) continue;
    const payout = toInt(x.maturity_amount);
    const claimed = await col(db, "savings").updateIf(String(x._id), { status: "running" }, { status: "matured", payout_amount: payout, processed_at: new Date() });
    if (!claimed) continue;
    try {
      await adminTx(db, { sid, memo: `적금 만기 지급 (${x.weeks}주)`, deposit: payout, recorder: "관리자" });
      cnt += 1;
    } catch {
      await col(db, "savings").update(String(x._id), { status: "running", payout_amount: null, processed_at: null });
    }
  }
  return cnt;
}

async function cancelSavings(db, docId, recorder) {
  const x = await col(db, "savings").get(docId);
  if (!x) fail("해당 적금을 찾지 못했어요.");
  if (str(x.status) !== "running") fail("진행중인 적금만 중도해지할 수 있어요.");
  const sid = str(x.student_id);
  const principal = toInt(x.principal);
  const claimed = await col(db, "savings").updateIf(String(docId), { status: "running" }, { status: "canceled", payout_amount: principal, processed_at: new Date() });
  if (!claimed) fail("이미 처리된 적금이에요.");
  try {
    await adminTx(db, { sid, memo: `적금 중도해지 지급 (${x.weeks}주)`, deposit: principal, recorder });
  } catch (e) {
    await col(db, "savings").update(String(docId), { status: "running", payout_amount: null, processed_at: null });
    fail(e.userMessage || "중도해지 실패");
  }
}

export default {
  async bank_load(ctx, { admin_mode }) {
    requireLogin(ctx);
    const db = ctx.db;
    const cfg = await bankRateCfg(db);
    const out = { rate_cfg: cfg };
    const now = new Date();
    if (admin_mode) {
      requireAny(ctx, SAV_ADMIN);
      await runAutoPayouts(db, { force: true });
      out.auto_matured = await tabMaturity(db);
      const docs = await db.collection("savings").find({}).sort({ start_utc: -1 }).limit(800).toArray();
      out.rows = docs.map((r) => rowView(r, now));
      return out;
    }
    requireStudent(ctx);
    const s = await col(db, "students").get(ctx.sid);
    out.balance = toInt(s && s.balance);
    out.credit = await calcCredit(db, ctx.sid);
    const mine = await db.collection("savings").find({ student_id: ctx.sid }).toArray();
    mine.sort((a, b) => (toDate(b.start_utc)?.getTime() || 0) - (toDate(a.start_utc)?.getTime() || 0));
    out.rows = mine.map((r) => {
      const v = rowView(r, now);
      if (v["처리 결과"].startsWith("중도해지")) v["처리 결과"] = "중도해지";
      return v;
    });
    return out;
  },

  async savings_join(ctx, { weeks, principal }) {
    requireStudent(ctx);
    const db = ctx.db;
    principal = toInt(principal);
    weeks = toInt(weeks);
    if (principal <= 0) fail("적금 금액이 0보다 커야 해요.");
    if (weeks <= 0) fail("적금 기간(주)을 선택해 주세요.");
    const cfg = await bankRateCfg(db);
    // (요청 반영) 화면의 신용등급과 같은 기준(수동 조정 포함)으로 이자율 결정
    const { score, grade } = await calcCredit(db, ctx.sid);
    const rate = rateFor(cfg, grade, weeks);
    const interest = computeInterest(principal, rate);
    const doc = await applyBalance(db, ctx.sid, -principal, { minBalance: principal });
    if (!doc) fail("잔액이 부족해요.");
    const s = ctx.student;
    await insertTx(db, { sid: ctx.sid, type: "withdraw", amount: -principal, balanceAfter: toInt(doc.balance), memo: `적금 가입 (${weeks}주)`, recorder: str(s.name) });
    const nowUtc = new Date();
    const mat = new Date(nowUtc.getTime() + weeks * 7 * 24 * 3600 * 1000);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, `.${String(d.getUTCMilliseconds()).padStart(3, "0")}000Z`);
    await col(db, "savings").add({
      student_id: ctx.sid,
      no: s.no === undefined || s.no === null ? 999999 : toInt(s.no, 999999) || 999999,
      name: str(s.name),
      weeks,
      credit_score: score,
      credit_grade: grade,
      rate_percent: rate,
      principal,
      interest,
      maturity_amount: principal + interest,
      start_utc: iso(nowUtc),
      maturity_utc: iso(mat),
      status: "running",
      payout_amount: null,
      created_at: new Date(),
    });
    return {};
  },

  async savings_cancel(ctx, { doc_id, admin_mode }) {
    requireLogin(ctx);
    const db = ctx.db;
    if (admin_mode) {
      requireAny(ctx, SAV_ADMIN);
      await cancelSavings(db, doc_id, adminRecorder(ctx));
      return {};
    }
    requireStudent(ctx);
    const x = await col(db, "savings").get(doc_id);
    if (!x || str(x.student_id) !== ctx.sid) fail("해당 적금을 찾지 못했어요.");
    await cancelSavings(db, doc_id, ctx.name);
    return {};
  },
};
