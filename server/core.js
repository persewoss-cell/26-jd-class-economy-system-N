// 핵심 비즈니스 로직 (app.py의 api_* / helper 함수들을 그대로 옮김)
// 잔액 변경은 MongoDB 원자 연산($inc)으로 처리해서 동시에 눌러도 금액이 어긋나지 않게 함
import { col, newId, decKey, encKey } from "./db.js";
import { curGroup, runInGroup } from "./group.js";
import { fail, DEFAULT_CREDIT_GRADE, DEFAULT_CREDIT_SCORE, ADMIN_NAME } from "./auth.js";
import {
  toInt, ior, toFloat, forr, str, as2, toDate, pyRound, scoreToGrade, normStatus,
  fmtKrDatetime, fmtMd, kstParts, monthKey,
} from "../shared/format.js";

export const DEFAULT_POINT_PROFIT_PCT = 10.0;

// -------------------------------------------------
// 통장 거래
// -------------------------------------------------
// amount: +입금 / -출금. minBalance가 있으면 잔액이 그 이상일 때만 반영(원자적)
export async function applyBalance(db, sid, amount, { minBalance = null } = {}) {
  const q = { _id: String(sid) };
  if (minBalance !== null) q.balance = { $gte: minBalance };
  const doc = await db.collection("students").findOneAndUpdate(q, { $inc: { balance: toInt(amount) } }, { returnDocument: "after" });
  return doc || null;
}

export async function insertTx(db, { sid, type, amount, balanceAfter, memo, recorder, extra = {} }) {
  return await col(db, "transactions").add({
    student_id: String(sid),
    type,
    amount: toInt(amount),
    balance_after: toInt(balanceAfter),
    memo,
    ...extra,
    recorder: str(recorder),
    created_at: new Date(),
  });
}

// 국고 반영(+세입 / -세출). memo가 없거나 0이면 아무것도 안 함 (_treasury_apply_in_transaction)
export async function treasuryApply(db, { memo, signed, actor, recorder, extra = {} }) {
  memo = str(memo).trim();
  signed = toInt(signed);
  if (!signed || !memo) return null;
  const st = await db.collection("treasury").findOneAndUpdate(
    { _id: "state" },
    { $inc: { balance: signed }, $set: { updated_at: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  const newBal = toInt(st && st.balance);
  await col(db, "treasury_ledger").add({
    type: signed > 0 ? "income" : "expense",
    amount: signed,
    income: signed > 0 ? signed : 0,
    expense: signed < 0 ? -signed : 0,
    balance_after: newBal,
    memo,
    actor: str(actor),
    recorder: str(recorder),
    ...extra,
    created_at: new Date(),
  });
  return newBal;
}

// api_add_treasury_tx: 세입/세출 중 하나만
export async function treasuryTx(db, { memo, income, expense, actor = "treasury", recorder }) {
  memo = str(memo).trim();
  income = toInt(income);
  expense = toInt(expense);
  if (!memo) fail("내역이 필요합니다.");
  if (income < 0 || expense < 0) fail("금액은 0보다 커야 합니다.");
  if ((income > 0 && expense > 0) || (income === 0 && expense === 0)) fail("세입/세출 중 하나만 입력하세요.");
  const signed = income > 0 ? income : -expense;
  return await treasuryApply(db, { memo, signed, actor, recorder });
}

// 관리자(또는 권한 학생)의 개별 입금/출금 (+선택 국고 반영). 출금은 잔액 부족이어도 허용
// requireBalance: 출금일 때 잔액이 모자라면 처리하지 않음 (마트 승인 등)
export async function adminTx(db, { sid, memo, deposit = 0, withdraw = 0, applyTreasury = false, treasuryMemo = "", actor = "admin_auto", recorder, extra = {}, requireBalance = false }) {
  memo = str(memo).trim();
  deposit = toInt(deposit);
  withdraw = toInt(withdraw);
  if (!memo) fail("내역이 필요합니다.");
  if (deposit < 0 || withdraw < 0) fail("금액은 0보다 커야 합니다.");
  if ((deposit > 0 && withdraw > 0) || (deposit === 0 && withdraw === 0)) fail("입금/출금 중 하나만 입력하세요.");
  if (!sid) fail("student_id가 없습니다.");
  const exists = await db.collection("students").findOne({ _id: String(sid) }, { projection: { _id: 1 } });
  if (!exists) fail("계정을 찾지 못했습니다.");
  const amount = deposit > 0 ? deposit : -withdraw;
  const type = deposit > 0 ? "deposit" : "withdraw";
  // 잔액을 먼저 바꾸고(실패하면 국고도 건드리지 않음) 국고 반영
  const doc = await applyBalance(db, sid, amount, requireBalance && type === "withdraw" ? { minBalance: withdraw } : {});
  if (!doc) fail("잔액이 부족해 처리할 수 없어요.");
  if (applyTreasury) {
    const treSigned = type === "withdraw" ? withdraw : -deposit;
    // 여러 명 입금/출금(배치)에서는 학생별 국고 기록을 나중에 찾을 수 있게 학생 id도 남김
    const treExtra = extra.batch_id ? { ...extra, tx_student_id: String(sid) } : extra;
    await treasuryApply(db, { memo: str(treasuryMemo) || memo, signed: treSigned, actor: str(actor) || "auto", recorder, extra: treExtra });
  }
  const newBal = toInt(doc && doc.balance);
  const txId = await insertTx(db, { sid, type, amount, balanceAfter: newBal, memo, recorder, extra });
  return { balance: newBal, tx_id: txId };
}

// 학생 본인 거래(+선택 국고). 출금은 잔액 이내만 (api_add_tx_with_treasury)
export async function studentTx(db, { student, memo, deposit = 0, withdraw = 0, applyTreasury = false, treasuryMemo = "", actor = "auto", checkBalance = true }) {
  memo = str(memo).trim();
  deposit = toInt(deposit);
  withdraw = toInt(withdraw);
  if (!memo) fail("내역이 필요합니다.");
  if (deposit < 0 || withdraw < 0) fail("금액은 0보다 커야 합니다.");
  if ((deposit > 0 && withdraw > 0) || (deposit === 0 && withdraw === 0)) fail("입금/출금 중 하나만 입력하세요.");
  const sid = String(student._id);
  const recorder = str(student.name);
  const amount = deposit > 0 ? deposit : -withdraw;
  const type = deposit > 0 ? "deposit" : "withdraw";
  let doc;
  if (type === "withdraw" && checkBalance) {
    doc = await applyBalance(db, sid, amount, { minBalance: withdraw });
    if (!doc) fail("잔액보다 큰 출금은 불가합니다.");
  } else {
    doc = await applyBalance(db, sid, amount);
  }
  if (applyTreasury) {
    const treSigned = type === "withdraw" ? withdraw : -deposit;
    await treasuryApply(db, { memo: str(treasuryMemo) || memo, signed: treSigned, actor: str(actor) || "auto", recorder });
  }
  const newBal = toInt(doc && doc.balance);
  const txId = await insertTx(db, { sid, type, amount, balanceAfter: newBal, memo, recorder });
  return { balance: newBal, tx_id: txId };
}

export function isSavingsMemo(memo) {
  memo = str(memo);
  return memo.includes("적금 가입") || memo.includes("적금 해지") || memo.includes("적금 만기") || memo.includes("적금 중도해지");
}

export function isInvestMemo(memo) {
  memo = str(memo).trim();
  return memo.startsWith("투자 ") || memo.includes("투자 매입") || memo.includes("투자 회수");
}

export async function getTxRows(db, sid, limit = 200) {
  const docs = await db.collection("transactions").find({ student_id: String(sid) }).sort({ created_at: -1 }).limit(toInt(limit)).toArray();
  return docs.map((tx) => {
    const amt = toInt(tx.amount);
    const dt = toDate(tx.created_at);
    return {
      tx_id: String(tx._id),
      created_at_kr: dt ? fmtKrDatetime(dt) : "",
      memo: str(tx.memo),
      recorder: str(tx.recorder),
      type: str(tx.type),
      amount: amt,
      deposit: amt > 0 ? amt : 0,
      withdraw: amt < 0 ? -amt : 0,
      balance_after: toInt(tx.balance_after),
      _ts: dt ? dt.getTime() : 0,
    };
  }).sort((a, b) => b._ts - a._ts);
}

// -------------------------------------------------
// 신용점수
// -------------------------------------------------
export async function getCreditCfg(db) {
  const d = await col(db, "config").get("credit_scoring");
  if (!d) return { base: 50, o: 1, x: -3, tri: 0 };
  const pick = (k, dv) => (d[k] === null || d[k] === undefined ? dv : toInt(d[k], dv));
  return { base: pick("base", 50), o: pick("o", 1), x: pick("x", -3), tri: pick("tri", 0) };
}

export async function listStatSubmissions(db, limit = 10) {
  const docs = await db.collection("stat_submissions").find({}).sort({ created_at: -1 }).limit(toInt(limit)).toArray();
  return docs.map((s) => {
    const statuses = {};
    for (const [k, v] of Object.entries(s.statuses || {})) statuses[decKey(k)] = v;
    return {
      submission_id: String(s._id),
      label: str(s.label),
      date_iso: str(s.date_iso),
      date_display: str(s.date_display),
      created_at: toDate(s.created_at),
      statuses,
    };
  });
}

export async function manualDeltaMap(db, sids = null) {
  const q = sids ? { student_id: { $in: sids.map(String) } } : {};
  const docs = await db.collection("credit_adjustments").find(q, { projection: { student_id: 1, delta: 1 } }).toArray();
  const m = {};
  for (const d of docs) {
    const k = str(d.student_id);
    m[k] = toInt(m[k]) + toInt(d.delta);
  }
  return m;
}

// _calc_credit_score_for_student (수동 조정 포함)
export function calcCreditFrom(cfg, subsDesc, sid, manualDelta = 0) {
  const delta = (v) => {
    const s = normStatus(v);
    if (s === "O") return cfg.o;
    if (s === "△") return cfg.tri;
    return cfg.x;
  };
  let score = cfg.base;
  for (let i = subsDesc.length - 1; i >= 0; i--) {
    const v = subsDesc[i].statuses[String(sid)] ?? "X";
    score = score + delta(v);
    if (score > 100) score = 100;
    if (score < 0) score = 0;
  }
  score = score + toInt(manualDelta);
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return { score, grade: scoreToGrade(score) };
}

export async function calcCredit(db, sid) {
  const [cfg, subs, md] = await Promise.all([getCreditCfg(db), listStatSubmissions(db, 200), manualDeltaMap(db, [sid])]);
  return calcCreditFrom(cfg, subs, sid, md[String(sid)] || 0);
}

// -------------------------------------------------
// 직업명 / 투자 요약 (헤더·개별조회용) — 여러 학생을 한 번에 계산
// -------------------------------------------------
export async function loadRoleLookup(db) {
  const roles = await col(db, "roles").find({});
  const roleById = {};
  for (const r of roles) roleById[String(r._id)] = str(r.role_name || r.name || r._id).trim() || String(r._id);
  const jobs = await col(db, "job_salary").find({});
  const jobsByStudent = {};
  for (const j of jobs) {
    const jname = str(j.job || j.role_name).trim();
    if (!jname) continue;
    for (const sid of (j.assigned_ids || []).map(String)) {
      if (!jobsByStudent[sid]) jobsByStudent[sid] = [];
      if (!jobsByStudent[sid].includes(jname)) jobsByStudent[sid].push(jname);
    }
  }
  return { roleById, jobsByStudent };
}

export function roleNameFor(studentDoc, sid, lookup) {
  const names = [];
  const add = (n) => {
    const s = str(n).trim();
    if (s && !names.includes(s)) names.push(s);
  };
  if (studentDoc) {
    const rid = str(studentDoc.role_id || studentDoc.job_role_id || studentDoc.job_id).trim();
    const direct = str(studentDoc.job_name || studentDoc.job).trim();
    if (direct) direct.split(",").forEach((p) => add(p.trim()));
    if (rid) add(lookup.roleById[rid] ?? rid);
  }
  (lookup.jobsByStudent[String(sid)] || []).forEach(add);
  return names.length ? names.join(", ") : "없음";
}

export async function loadInvestProductMap(db) {
  const docs = await col(db, "invest_products").find({});
  const m = {};
  for (const x of docs) {
    const pid = str(x.product_id || x._id);
    const name = str(x.name).trim() || str(x.label).trim() || str(x.title).trim() || str(x.subject).trim() || pid;
    m[pid] = { name, cur: toFloat(x.current_price, 0), pct: forr(x.point_profit_pct, DEFAULT_POINT_PROFIT_PCT) };
    if (String(x._id) !== pid) m[String(x._id)] = m[pid];
  }
  return m;
}

// _calc_invest_redeem_projection
export function redeemProjection(investAmount, buyPrice, sellPrice, buyReal = null, sellReal = null, pct = DEFAULT_POINT_PROFIT_PCT) {
  investAmount = toInt(investAmount);
  buyPrice = as2(buyPrice);
  sellPrice = as2(sellPrice);
  const br = buyReal !== null && buyReal !== undefined ? as2(buyReal) : 0;
  const sr = sellReal !== null && sellReal !== undefined ? as2(sellReal) : 0;
  pct = pct === null || pct === undefined ? DEFAULT_POINT_PROFIT_PCT : toFloat(pct, DEFAULT_POINT_PROFIT_PCT);
  const useReal = br > 0 && sr > 0;
  const diff = as2(useReal ? sr - br : sellPrice - buyPrice);
  let profit;
  let redeem;
  if (diff <= -100) {
    profit = -investAmount;
    redeem = 0;
  } else {
    profit = investAmount * diff * (pct / 100);
    redeem = investAmount + profit;
    if (redeem < 0) redeem = 0;
  }
  return { diff, profit: as2(profit), redeem: as2(redeem) };
}

// 학생별 투자 (현재평가, 원금) 요약 텍스트
export function investSummaries(ledgerRows, prodMap) {
  const evalBy = {}; // sid -> pid -> val
  const prinBy = {};
  for (const x of ledgerRows) {
    if (x.redeemed) continue;
    const sid = str(x.student_id);
    const pid = str(x.product_id);
    if (!pid) continue;
    const p = prodMap[pid] || { name: pid, cur: 0, pct: DEFAULT_POINT_PROFIT_PCT };
    const amt = toInt(x.invest_amount);
    const pct = forr(x.point_profit_pct ?? p.pct, p.pct);
    const { redeem } = redeemProjection(amt, toFloat(x.buy_price), p.cur, null, null, pct);
    evalBy[sid] = evalBy[sid] || {};
    evalBy[sid][pid] = (evalBy[sid][pid] || 0) + redeem;
    if (amt > 0) {
      prinBy[sid] = prinBy[sid] || {};
      prinBy[sid][pid] = (prinBy[sid][pid] || 0) + amt;
    }
  }
  const nameOf = (pid) => (prodMap[pid] ? prodMap[pid].name : pid) || pid;
  const sortByName = (a, b) => (nameOf(a[0]) < nameOf(b[0]) ? -1 : nameOf(a[0]) > nameOf(b[0]) ? 1 : 0);
  const out = {};
  const sids = new Set([...Object.keys(evalBy), ...Object.keys(prinBy)]);
  for (const sid of sids) {
    const ev = evalBy[sid] || {};
    const pr = prinBy[sid] || {};
    const evItems = Object.entries(ev).sort(sortByName);
    const prItems = Object.entries(pr).sort(sortByName);
    out[sid] = {
      evalText: evItems.length ? evItems.map(([pid, v]) => `${nameOf(pid)} ${pyRound(v)}드림`).join(", ") : "없음",
      evalTotal: evItems.length ? pyRound(evItems.reduce((s, [, v]) => s + v, 0)) : 0,
      prinText: prItems.length ? prItems.map(([pid, v]) => `${nameOf(pid)} ${toInt(v)}드림`).join(", ") : "없음",
      prinTotal: prItems.reduce((s, [, v]) => s + toInt(v), 0),
    };
  }
  return out;
}

export async function investSummaryFor(db, sid) {
  const [ledger, prodMap] = await Promise.all([
    db.collection("invest_ledger").find({ student_id: String(sid) }).toArray(),
    loadInvestProductMap(db),
  ]);
  return investSummaries(ledger, prodMap)[String(sid)] || { evalText: "없음", evalTotal: 0, prinText: "없음", prinTotal: 0 };
}

// -------------------------------------------------
// 월급 공제
// -------------------------------------------------
export async function getSalaryCfg(db) {
  const d = await col(db, "config").get("salary_deductions");
  if (!d) return { tax_percent: 10.0, desk_rent: 50, electric_fee: 10, health_fee: 10 };
  return {
    tax_percent: forr(d.tax_percent, 10.0),
    desk_rent: ior(d.desk_rent, 50),
    electric_fee: ior(d.electric_fee, 10),
    health_fee: ior(d.health_fee, 10),
  };
}

export function calcNet(gross, cfg) {
  gross = toInt(gross);
  cfg = cfg || {};
  const taxPct = forr(cfg.tax_percent, 10.0);
  const desk = ior(cfg.desk_rent, 50);
  const elec = ior(cfg.electric_fee, 10);
  const health = ior(cfg.health_fee, 10);
  const tax = pyRound(gross * (taxPct / 100));
  return Math.max(0, gross - tax - desk - elec - health);
}

export function paylogId(mkey, sid, jobId = "") {
  return `${mkey}_${sid}_${str(jobId).trim() || "_"}`;
}

export async function alreadyPaidThisMonth(db, mkey, sid, jobId = "", jobName = "") {
  if (await col(db, "payroll_log").get(paylogId(mkey, sid, jobId))) return true;
  const legacy = await col(db, "payroll_log").get(`${mkey}_${sid}`);
  if (!legacy) return false;
  const lj = str(legacy.job);
  return !!lj && lj === str(jobName);
}

export async function writePaylog(db, mkey, sid, amount, jobName, method, jobId = "") {
  await col(db, "payroll_log").set(paylogId(mkey, sid, jobId), {
    month: mkey, student_id: sid, amount: toInt(amount), job: str(jobName), job_id: str(jobId), method: str(method), paid_at: new Date(), grp: curGroup(),
  }, true);
}

export async function activeStudents(db) {
  const docs = await db.collection("students").find({ is_active: true }).toArray();
  return docs.map((d) => ({ ...d, student_id: String(d._id) }));
}

// api_list_accounts_cached: 이름순
export async function listAccounts(db) {
  const rows = (await activeStudents(db)).filter((s) => str(s.name)).map((s) => ({
    student_id: s.student_id, no: toInt(s.no), name: str(s.name), balance: toInt(s.balance),
  }));
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

// -------------------------------------------------
// 시스템 자동 처리(적금 만기 + 월급 자동지급) — 로그인 여부와 관계없이 접속할 때마다 시도
// -------------------------------------------------
let _lastAutoRun = 0;
// ---------------- 되돌리기 = 기록 자체를 지우고 원래대로 ----------------
// 지운 기록 뒤에 쌓인 "총액(잔액)" 값을 지운 금액만큼 당겨서 내역이 어긋나지 않게
export async function removeTx(db, tx) {
  const r = await db.collection("transactions").deleteOne({ _id: String(tx._id) });
  if (!r.deletedCount) return false;
  const amount = toInt(tx.amount);
  await applyBalance(db, tx.student_id, -amount);
  await db.collection("transactions").updateMany({ student_id: str(tx.student_id), created_at: { $gt: tx.created_at } }, { $inc: { balance_after: -amount } });
  return true;
}
export async function removeTreasuryEntry(db, led) {
  const r = await db.collection("treasury_ledger").deleteOne({ _id: led._id });
  if (!r.deletedCount) return false;
  const signed = toInt(led.amount);
  await db.collection("treasury").updateOne({ _id: "state" }, { $inc: { balance: -signed }, $set: { updated_at: new Date() } }, { upsert: true });
  await db.collection("treasury_ledger").updateMany({ created_at: { $gt: led.created_at } }, { $inc: { balance_after: -signed } });
  return true;
}
// 국고 기록의 금액만 줄임(기록은 남김): 잔액과 이후 기록의 총액도 같이 정정
async function shrinkTreasuryEntry(db, led, share) {
  const next = toInt(led.amount) - share;
  const r = await db.collection("treasury_ledger").updateOne(
    { _id: led._id, amount: led.amount },
    { $inc: { amount: -share, balance_after: -share }, $set: { type: next > 0 ? "income" : "expense", income: next > 0 ? next : 0, expense: next < 0 ? -next : 0 } }
  );
  if (!r.modifiedCount) return false;
  await db.collection("treasury").updateOne({ _id: "state" }, { $inc: { balance: -share }, $set: { updated_at: new Date() } }, { upsert: true });
  await db.collection("treasury_ledger").updateMany({ created_at: { $gt: led.created_at } }, { $inc: { balance_after: -share } });
  return true;
}

// 💰입금/출금 탭의 여러 명(개인 여러 명·전체 일괄) 기록 중 한 학생 것만 지울 때 → 국고에서도 그 학생 몫만 되돌림
// - 개인(여러 명): 학생마다 국고 기록이 따로 있으므로 그 학생 기록을 지움
// - 전체 일괄: 국고 기록이 하나이므로 그 학생 몫만큼 금액을 줄이고, 마지막 학생이면 기록을 지움
export async function removeBatchShare(db, tx, name = "") {
  const bid = str(tx.batch_id);
  if (!bid || str(tx.source) !== "bank_admin") return false;
  const share = -toInt(tx.amount); // 그 학생 거래가 국고에 준 금액(입금이면 세출)
  if (!share) return false;
  const leds = await db.collection("treasury_ledger").find({ batch_id: bid }).toArray();
  if (!leds.length) return false;
  if (str(tx.batch_kind) === "bulk") {
    const led = leds[0];
    const cur = toInt(led.amount);
    if (cur - share === 0 || Math.sign(cur - share) !== Math.sign(cur)) return await removeTreasuryEntry(db, led);
    return await shrinkTreasuryEntry(db, led, share);
  }
  let led = leds.find((l) => str(l.tx_student_id) === str(tx.student_id));
  if (!led) {
    const cands = leds.filter((l) => !l.tx_student_id && toInt(l.amount) === share);
    led = (name && cands.find((l) => str(l.memo).includes(name))) || (cands.length === 1 ? cands[0] : null);
  }
  return led ? await removeTreasuryEntry(db, led) : false;
}

// 월급 입금 기록에 딸린 "월급 공제 세입" 국고 기록 (같은 달·직업·이름, 가장 가까운 시각)
export async function findSalaryTreasury(db, tx, name) {
  const linked = await db.collection("treasury_ledger").findOne({ salary_tx_id: String(tx._id) });
  if (linked) return linked;
  const t = toDate(tx.created_at);
  if (!t) return null;
  const job = str(tx.memo).replace("월급 ", "").trim();
  const memo = `월급 공제 세입(${monthKey(t)}) ${job}` + (name ? ` - ${name}` : "");
  const cands = await db.collection("treasury_ledger").find({ memo, amount: { $gt: 0 }, created_at: { $gte: new Date(t.getTime() - 180000), $lte: new Date(t.getTime() + 180000) } }).toArray();
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(toDate(a.created_at) - t) - Math.abs(toDate(b.created_at) - t));
  return cands[0];
}
// 월급 한 건을 흔적 없이 지움: 학생 기록 + 국고 공제 세입 (+ 원하면 그 달 지급 기록)
export async function removeSalaryPayment(db, tx, name, { dropPaylog = false } = {}) {
  const led = await findSalaryTreasury(db, tx, name);
  if (!(await removeTx(db, tx))) return { removed: false, treasury: false };
  const treasury = led ? await removeTreasuryEntry(db, led) : false;
  if (dropPaylog) {
    const mkey = monthKey(toDate(tx.created_at) || new Date());
    const job = str(tx.memo).replace("월급 ", "").trim();
    const same = await db.collection("transactions").find({ student_id: str(tx.student_id), type: "deposit", memo: str(tx.memo) }, { projection: { created_at: 1 } }).toArray();
    const stillPaid = same.some((x) => monthKey(toDate(x.created_at) || new Date()) === mkey);
    if (!stillPaid) await db.collection("payroll_log").deleteMany({ month: mkey, student_id: str(tx.student_id), job });
  }
  return { removed: true, treasury };
}

// 지급일이 그 달에 없으면(예: 31일인데 30일까지인 달) 그 달 마지막 날로
export function effectivePayDay(day, kp) {
  const last = new Date(Date.UTC(kp.year, kp.month, 0)).getUTCDate();
  return Math.min(Math.max(1, day), last);
}

export async function runAutoPayouts(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - _lastAutoRun < 60000) return;
  _lastAutoRun = now;
  try {
    const nowD = new Date();
    const due = await db.collection("savings").find({ status: { $in: ["running", "active"] } }).toArray();
    for (const x of due) {
      const m = toDate(x.maturity_utc || x.maturity_date);
      if (!m || m > nowD) continue;
      await runInGroup(() => matureOne(db, x));
    }
    async function matureOne(db, x) {
      const sid = str(x.student_id).trim();
      const principal = toInt(x.principal);
      const interest = toInt(x.interest);
      const payout = toInt(x.maturity_amount) || principal + interest;
      const weeks = toInt(x.weeks);
      if (!sid || payout <= 0) return;
      const claimed = await col(db, "savings").updateIf(String(x._id), { status: { $in: ["running", "active"] } }, {
        status: "matured", result: "matured", processed_at: new Date(), payout_amount: payout,
      });
      if (!claimed) return;
      const doc = await applyBalance(db, sid, payout);
      // 학생 계정을 못 찾아 입금이 안 됐으면 만기 처리도 되돌려 다음에 다시 시도
      if (!doc) {
        await col(db, "savings").update(String(x._id), { status: str(x.status), result: x.result ?? null, processed_at: null, payout_amount: null });
        return;
      }
      await insertTx(db, { sid, type: "maturity", amount: payout, balanceAfter: toInt(doc && doc.balance), memo: `적금 만기 지급 (${weeks}주)`, recorder: "시스템(적금)" });
    }

    const pc = (await col(db, "config").get("salary_payroll")) || {};
    const autoEnabled = !!pc.auto_enabled;
    const kp = kstParts(nowD);
    const payDay = effectivePayDay(ior(pc.pay_day, 25), kp);
    if (!(autoEnabled && kp.day >= payDay)) return;
    const mkey = monthKey(nowD);
    let lockId = `${mkey}_${String(payDay).padStart(2, "0")}`;
    // 이번 달 월급을 전체 회수한 뒤: 관리자가 정한 '다시 지급일'이 되어야 자동지급
    if (pc.hold_month === mkey) {
      const re = pc.repay && pc.repay.month === mkey ? ior(pc.repay.day, 0) : 0;
      if (!re || kp.day < effectivePayDay(re, kp)) return;
      lockId = `${mkey}_re${String(re).padStart(2, "0")}`;
    }
    const created = await col(db, "payroll_auto_run").create(lockId, { month: mkey, pay_day: payDay, run_at: new Date(), source: "auto_system" });
    if (!created) return;
    const cfg = await getSalaryCfg(db);
    const accs = await listAccounts(db);
    const idToName = Object.fromEntries(accs.map((a) => [a.student_id, a.name]));
    const jobs = await db.collection("job_salary").find({}).sort({ order: 1 }).toArray();
    for (const job of jobs) {
      const jobId = String(job._id);
      const jobName = str(job.job);
      const gross = toInt(job.salary);
      const net = calcNet(gross, cfg);
      if (net <= 0) continue;
      for (let sid of job.assigned_ids || []) {
        sid = str(sid).trim();
        if (!sid || !(sid in idToName)) continue; // 삭제된 학생은 지급 안 함
        if (await alreadyPaidThisMonth(db, mkey, sid, jobId, jobName)) continue;
        // 학생 한 명의 월급(통장 입금 + 국고 공제 세입 + 지급 기록)을 한 묶음으로
        await runInGroup(async () => {
          let paid;
          try {
            paid = await adminTx(db, { sid, memo: `월급 ${jobName}`, deposit: net, actor: "system_salary", recorder: "관리자" });
          } catch {
            return;
          }
          const ded = Math.max(0, gross - net);
          if (ded > 0) {
            const nm = idToName[sid] || "";
            await treasuryApply(db, { memo: `월급 공제 세입(${mkey}) ${jobName}` + (nm ? ` - ${nm}` : ""), signed: ded, actor: "system_salary", recorder: "관리자", extra: { salary_tx_id: String(paid.tx_id) } });
          }
          await writePaylog(db, mkey, sid, net, jobName, "auto", jobId);
        });
      }
    }
  } catch (e) {
    // 화면 진입을 막지 않도록 조용히 실패
    console.error("auto payouts failed", e);
  }
}

export { newId, encKey, decKey, ADMIN_NAME, DEFAULT_CREDIT_GRADE, DEFAULT_CREDIT_SCORE, fmtMd };
