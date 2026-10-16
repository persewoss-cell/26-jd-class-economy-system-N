// 🧾 로그기록 + (학생) 📊 통계/신용 + (학생) 🎯 목표
import { col } from "../db.js";
import { fail, requireAny, requireStudent } from "../auth.js";
import { getCreditCfg, listStatSubmissions, investSummaryFor } from "../core.js";
import { str, toInt, ior, toDate, fmtKrDatetimeNoYear, fmtMd, kstParts, normStatus, scoreToGrade } from "../../shared/format.js";

const CAT = {
  deposit: "입금", withdraw: "출금", maturity: "적금 만기", revert: "되돌리기", rollback: "되돌리기", payroll: "월급",
  manual: "수동지급", income: "세입", expense: "세출", auto: "자동처리", stat_submission: "통계 제출", schedule: "일정",
  mart_approved: "마트 승인", auction_ledger: "경매 장부", lottery_ledger: "복권 장부", pending: "승인 대기",
  approved: "승인 완료", rejected: "승인 거절", created: "생성", updated: "수정", deleted: "삭제", active: "진행중",
  canceled: "해지", matured: "만기", tab_permission: "탭 권한", admin_permission: "관리자기능 권한", credit_adjust: "신용점수 수동조정",
};

// 되돌리기 불가 기록 (여러 단계가 얽혀 있거나 시스템이 처리한 것)
function txBlock(x) {
  const m = str(x.memo);
  if (str(x.type) === "maturity" || m.includes("적금 만기")) return "적금 만기";
  if (m.includes("당첨금")) return "복권 당첨금";
  if (m.includes("낙찰 실패") || m.includes("입찰금 반환")) return "경매 반환";
  if (str(x.type) === "rollback" || str(x.type) === "revert" || m.includes("되돌리기")) return "예전 되돌리기 기록";
  return "";
}
function treBlock(x) {
  const a = str(x.actor).toLowerCase();
  if (a === "auction" || a === "lottery" || a === "lottery_admin") return a === "auction" ? "경매 장부" : "복권 장부";
  return "";
}

// 함께 일어난 기록끼리 묶기
// - 새 기록: 같은 묶음 번호(grp)·일괄 번호(batch)·연결 id 로 정확히
// - 예전 기록: 3초 안에 일어났고 대상(학생)이나 내역이 서로 이어지면 같은 묶음으로 추정
const nameOf = (v) => {
  const m = /^\s*\d+번\s+(.+)$/.exec(str(v));
  return m ? m[1].trim() : "";
};
const core = (v) => str(v).replace(/^전체\s+/, "").trim();
function related(a, b) {
  const na = nameOf(a.대상);
  const nb = nameOf(b.대상);
  if (na && nb) return na === nb;
  if (nb && str(a.내역).includes(nb)) return true;
  if (na && str(b.내역).includes(na)) return true;
  const ca = core(a.내역);
  const cb = core(b.내역);
  return !!ca && !!cb && (ca === cb || (ca.length >= 2 && cb.includes(ca)) || (cb.length >= 2 && ca.includes(cb)));
}
function groupRows(rows) {
  const parent = rows.map((_, i) => i);
  const strong = rows.map((r) => r._m.keys?.find((k) => k.startsWith("g:") || k.startsWith("b:")) || null);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (i, j, soft) => {
    const a = find(i);
    const b = find(j);
    if (a === b) return;
    if (soft && strong[a] && strong[b] && strong[a] !== strong[b]) return; // 서로 다른 새 묶음은 추정으로 합치지 않음
    parent[b] = a;
    strong[a] = strong[a] || strong[b];
  };
  const byKey = new Map();
  rows.forEach((r, i) => {
    for (const k of r._m.keys || []) {
      if (byKey.has(k)) unite(byKey.get(k), i, false);
      else byKey.set(k, i);
    }
  });
  // 묶음 번호가 없는 기록(예전 기록, 상태만 바뀐 기록)은 3초 안의 '가장 가까운' 관련 기록 하나에만 붙임
  const keyless = rows.map((r) => !(r._m.keys || []).some((k) => k.startsWith("g:") || k.startsWith("b:")));
  for (let i = 0; i < rows.length; i++) {
    if (!keyless[i] || rows[i]._m.c === "audit_log") continue;
    let best = -1;
    let bestD = Infinity;
    for (let j = i - 1; j >= 0 && rows[j]._s - rows[i]._s <= 3000; j--) {
      const d = rows[j]._s - rows[i]._s;
      if (rows[j]._m.c !== "audit_log" && d < bestD && related(rows[i], rows[j])) [best, bestD] = [j, d];
    }
    for (let j = i + 1; j < rows.length && rows[i]._s - rows[j]._s <= 3000; j++) {
      const d = rows[i]._s - rows[j]._s;
      if (rows[j]._m.c !== "audit_log" && d < bestD && related(rows[i], rows[j])) [best, bestD] = [j, d];
    }
    if (best >= 0) unite(best, i, true);
  }
  // 묶음 번호(화면 순서대로)와 되돌리기 가능 여부
  const gno = new Map();
  const info = new Map();
  rows.forEach((r, i) => {
    const root = find(i);
    if (!gno.has(root)) gno.set(root, gno.size);
    const g = info.get(root) || { money: false, block: "" };
    if (r._m.money) g.money = true;
    if (r._m.block && !g.block) g.block = r._m.block;
    info.set(root, g);
  });
  rows.forEach((r, i) => {
    const root = find(i);
    const g = info.get(root);
    r._m.g = gno.get(root);
    r._m.undo = g.money ? (g.block ? `x:${g.block}` : "ok") : "";
  });
}

async function recent(db, name, field, limit) {
  return await db.collection(name).find({}).sort({ [field]: -1 }).limit(limit).toArray();
}

async function buildLogs(db, perSource, maxRows) {
  // 모든 출처를 동시에 요청 (하나씩 기다리지 않음)
  const jobs = {
    _students: db.collection("students").find({}).toArray(),
    transactions: recent(db, "transactions", "created_at", perSource),
    treasury_ledger: recent(db, "treasury_ledger", "created_at", perSource),
    mart_ledger: recent(db, "mart_ledger", "approved_at", perSource),
    payroll_log: recent(db, "payroll_log", "paid_at", perSource),
    stat_submissions: recent(db, "stat_submissions", "created_at", perSource),
    auction_admin_ledger: recent(db, "auction_admin_ledger", "created_at", perSource),
    lottery_admin_ledger: recent(db, "lottery_admin_ledger", "created_at", perSource),
    schedule_items: recent(db, "schedule_items", "created_at", perSource),
    deposit_requests: recent(db, "deposit_requests", "created_at", perSource),
    savings: recent(db, "savings", "start_date", perSource),
    students: recent(db, "students", "updated_at", perSource),
    mart_requests: recent(db, "mart_requests", "created_at", perSource),
    credit_adjustments: recent(db, "credit_adjustments", "created_at", perSource),
    audit_log: recent(db, "audit_log", "created_at", perSource),
  };
  const vals = await Promise.all(Object.values(jobs));
  const P = Object.fromEntries(Object.keys(jobs).map((k, i) => [k, vals[i]]));
  const smap = {};
  for (const d of await P._students) smap[String(d._id)] = { name: str(d.name), no: toInt(d.no) };
  const t = (v) => (toDate(v) ? fmtKrDatetimeNoYear(v) : "");
  const ts = (v) => toDate(v)?.getTime() || 0;
  const who = (sid) => {
    const s = smap[sid] || {};
    return `${toInt(s.no)}번 ${s.name || sid}`;
  };
  const rows = [];
  // meta: { c: 컬렉션, id, keys: 묶음 열쇠들, money: 돈이 움직인 기록, block: 되돌리기 불가 이유 }
  let curMeta = null;
  const push = (r, sortV) => rows.push({ ...r, _s: sortV, _m: curMeta || {} });
  const meta = (c, x, keys = [], extra = {}) => {
    curMeta = { c, id: String(x._id), keys: keys.filter(Boolean), ...extra };
  };
  const G = (x) => (x.grp ? `g:${x.grp}` : null);
  const B = (x) => (x.batch_id ? `b:${x.batch_id}` : null);

  for (const x of await P.transactions) {
    const amt = toInt(x.amount);
    meta("transactions", x, [G(x), B(x), `t:${x._id}`], { money: true, block: txBlock(x) });
    push({ 시간: t(x.created_at), 탭: "💰입금/출금", 내역: str(x.memo), 입금: amt > 0 ? amt : 0, 출금: amt < 0 ? -amt : 0, 기록자: str(x.recorder) || "-", 대상: who(str(x.student_id)), 분류: str(x.type), 변경후잔액: toInt(x.balance_after) }, ts(x.created_at));
  }
  for (const x of await P.treasury_ledger) {
    const actor = str(x.actor) || "국고";
    meta("treasury_ledger", x, [G(x), B(x), x.salary_tx_id ? `t:${x.salary_tx_id}` : null], { money: true, block: treBlock(x) });
    push({ 시간: t(x.created_at), 탭: "🏛️ 국세청(국고)", 내역: str(x.memo), 입금: toInt(x.income), 출금: toInt(x.expense), 기록자: str(x.recorder) || "-", 대상: actor.toLowerCase() === "system_salary" ? "시스템(월급)" : actor, 분류: str(x.type), 변경후잔액: toInt(x.balance_after) }, ts(x.created_at));
  }
  for (const x of await P.mart_ledger) {
    meta("mart_ledger", x, [G(x)]);
    push({ 시간: t(x.approved_at), 탭: "🛒마트", 내역: `마트 구매 승인: ${str(x.item)}`, 입금: 0, 출금: toInt(x.price), 기록자: str(x.approved_by) || "관리자", 대상: `${toInt(x.student_no)}번 ${str(x.student_name)}`, 분류: "mart_approved", 변경후잔액: "" }, ts(x.approved_at));
  }
  for (const x of await P.payroll_log) {
    meta("payroll_log", x, [G(x)]);
    push({ 시간: t(x.paid_at), 탭: "💼 직업/월급", 내역: `월급 지급 (${str(x.job) || "-"})`, 입금: toInt(x.amount), 출금: 0, 기록자: "관리자", 대상: who(str(x.student_id)), 분류: str(x.method) || "payroll", 변경후잔액: "" }, ts(x.paid_at));
  }
  for (const x of await P.stat_submissions) {
    meta("stat_submissions", x);
    push({ 시간: t(x.created_at), 탭: "📊 통계청", 내역: `제출물 생성/수정: ${str(x.label)}`, 입금: 0, 출금: 0, 기록자: "관리자", 대상: "전체", 분류: "stat_submission", 변경후잔액: "" }, ts(x.created_at));
  }
  for (const x of await P.auction_admin_ledger) {
    meta("auction_admin_ledger", x, [], { block: "경매 장부 반영" });
    push({ 시간: t(x.created_at), 탭: "🏷️ 경매", 내역: `경매 ${toInt(x.round_no)}회 장부 반영`, 입금: toInt(x.total_amount), 출금: 0, 기록자: "관리자", 대상: "국고", 분류: "auction_ledger", 변경후잔액: "" }, ts(x.created_at));
  }
  for (const x of await P.lottery_admin_ledger) {
    meta("lottery_admin_ledger", x, [], { block: "복권 장부 반영" });
    push({ 시간: t(x.created_at), 탭: "🍀 복권", 내역: `복권 ${toInt(x.round_no)}회 장부 반영`, 입금: toInt(x.national_amount), 출금: 0, 기록자: "관리자", 대상: "국고", 분류: "lottery_ledger", 변경후잔액: "" }, ts(x.created_at));
  }
  for (const x of await P.schedule_items) {
    meta("schedule_items", x);
    push({ 시간: t(x.created_at), 탭: "🗓️ 일정", 내역: `일정 등록/수정: ${str(x.title)}`, 입금: 0, 출금: 0, 기록자: str(x.recorder) || "관리자", 대상: "전체", 분류: "schedule", 변경후잔액: "" }, ts(x.created_at));
  }
  for (const x of await P.deposit_requests) {
    const status = str(x.status || "pending").trim().toLowerCase();
    const label = `${toInt(x.no)}번 ${str(x.name)}`.trim();
    const memo = str(x.memo);
    const amount = toInt(x.amount);
    meta("deposit_requests", x, [G(x)]);
    push({ 시간: t(x.created_at), 탭: "✅ 입금 승인", 내역: `입금 신청: ${memo}`, 입금: amount, 출금: 0, 기록자: label || "-", 대상: label || "-", 분류: "pending", 변경후잔액: "" }, ts(x.created_at));
    if (toDate(x.processed_at)) {
      meta("deposit_requests", x, [x.tx_id ? `t:${x.tx_id}` : null]);
      push({ 시간: t(x.processed_at), 탭: "✅ 입금 승인", 내역: `입금 신청 처리(${status}): ${memo}`, 입금: status === "approved" ? amount : 0, 출금: 0, 기록자: "관리자", 대상: label || "-", 분류: status, 변경후잔액: "" }, ts(x.processed_at));
    }
  }
  for (const x of await P.savings) {
    const sid = str(x.student_id);
    const status = str(x.status || "active").trim().toLowerCase();
    const weeks = toInt(x.weeks);
    const principal = toInt(x.principal);
    const start = x.start_date || x.start_utc || x.created_at;
    const mat = x.maturity_date || x.maturity_utc;
    meta("savings", x, [G(x)]);
    push({ 시간: t(start), 탭: "🏦 은행(적금)", 내역: `적금 가입(${weeks}주)`, 입금: 0, 출금: principal, 기록자: who(sid), 대상: who(sid), 분류: "created", 변경후잔액: "" }, ts(start));
    meta("savings", x, [], status === "matured" ? { block: "적금 만기" } : {});
    if (toDate(mat) && status === "matured") {
      push({ 시간: t(mat), 탭: "🏦 은행(적금)", 내역: `적금 만기 처리(${weeks}주)`, 입금: principal + toInt(x.interest), 출금: 0, 기록자: "시스템", 대상: who(sid), 분류: "matured", 변경후잔액: "" }, ts(mat));
    } else if (status === "canceled") {
      const c = x.processed_at || x.updated_at || x.canceled_at;
      push({ 시간: t(c), 탭: "🏦 은행(적금)", 내역: `적금 중도해지(${weeks}주)`, 입금: principal, 출금: 0, 기록자: "사용자", 대상: who(sid), 분류: "canceled", 변경후잔액: "" }, ts(c) || ts(start));
    }
  }
  for (const x of await P.mart_requests) {
    const status = str(x.status || "pending").trim().toLowerCase();
    const lab = `${toInt(x.student_no)}번 ${str(x.student_name)}`;
    meta("mart_requests", x, [G(x)]);
    push({ 시간: t(x.created_at), 탭: "🛒마트", 내역: `구매 요청: ${str(x.item)}`, 입금: 0, 출금: toInt(x.price), 기록자: lab, 대상: lab, 분류: "pending", 변경후잔액: "" }, ts(x.created_at));
    if (status === "rejected") {
      meta("mart_requests", x);
      push({ 시간: t(x.rejected_at), 탭: "🛒마트", 내역: `구매 요청 거절: ${str(x.item)}`, 입금: 0, 출금: 0, 기록자: "관리자", 대상: lab, 분류: "rejected", 변경후잔액: "" }, ts(x.rejected_at) || ts(x.created_at));
    }
  }
  for (const x of await P.credit_adjustments) {
    meta("credit_adjustments", x, [G(x)]);
    const d = toInt(x.delta);
    push({ 시간: t(x.created_at), 탭: "💳 신용등급", 내역: `신용점수 수동 조정 (${d >= 0 ? "+" : ""}${d}점, 조정후 ${toInt(x.score_after)}점/${toInt(x.grade_after)}등급)`, 입금: 0, 출금: 0, 기록자: str(x.recorder) || "관리자", 대상: who(str(x.student_id)), 분류: "credit_adjust", 변경후잔액: "" }, ts(x.created_at));
  }
  for (const x of await P.audit_log) {
    meta("audit_log", x, [G(x)]);
    push({ 시간: t(x.created_at), 탭: str(x.tab) || "🛠️ 관리", 내역: str(x.memo), 입금: 0, 출금: 0, 기록자: str(x.recorder) || "관리자", 대상: str(x.target) || "-", 분류: "변경", 변경후잔액: "" }, ts(x.created_at));
  }
  curMeta = null;
  rows.sort((a, b) => b._s - a._s);
  groupRows(rows);
  // 같은 묶음은 붙여서 보이게 (묶음 순서는 가장 최근 기록 기준)
  rows.forEach((r, i) => (r._i = i));
  rows.sort((a, b) => a._m.g - b._m.g || a._i - b._i);
  return rows.slice(0, maxRows).map(({ _s, _m, _i, ...r }) => ({
    ...r,
    분류: CAT[str(r.분류).trim().toLowerCase()] ?? str(r.분류),
    _g: _m.g,
    _undo: _m.undo || "",
    _ref: _m.c && (_m.c === "transactions" || _m.c === "treasury_ledger") ? `${_m.c === "transactions" ? "t" : "r"}:${_m.id}` : "",
  }));
}

export default {
  async logs_load(ctx, { max_rows }) {
    requireAny(ctx, ["tab::🧾 로그기록"], "이 탭은 관리자 전용입니다.");
    const n = Math.max(100, Math.min(10000, toInt(max_rows, 200) || 200));
    return { rows: await buildLogs(ctx.db, 800, n) };
  },

  async user_stats_credit(ctx) {
    requireStudent(ctx);
    const db = ctx.db;
    const s = ctx.student;
    const subs = await listStatSubmissions(db, 50);
    const cfg = await getCreditCfg(db);
    // 기존 학생 화면 계산식 그대로(누적, 0~100 제한 없음 / cfg 값이 0이면 기본값 사용)
    const base = ior(cfg.base, 50);
    const delta = (v) => {
      const n = normStatus(v);
      if (n === "O") return ior(cfg.o, 1);
      if (n === "△") return toInt(cfg.tri, 0) || 0;
      return ior(cfg.x, -3);
    };
    const scoreAt = {};
    let cur = base;
    for (let i = subs.length - 1; i >= 0; i--) {
      cur += delta(subs[i].statuses[ctx.sid] ?? "X");
      scoreAt[subs[i].submission_id] = cur;
    }
    return {
      me: { no: s.no === undefined || s.no === null ? "" : str(s.no), name: str(s.name).trim() },
      subs: subs.map((x) => ({
        submission_id: x.submission_id,
        label: x.label,
        date_display: x.date_display || fmtMd(x.created_at),
        status: normStatus(x.statuses[ctx.sid] ?? "X"),
        score: scoreAt[x.submission_id] ?? base,
        grade: scoreToGrade(scoreAt[x.submission_id] ?? base),
      })),
    };
  },

  async goal_load(ctx) {
    requireStudent(ctx);
    const db = ctx.db;
    const g = await col(db, "goals").get(ctx.sid);
    const s = await col(db, "students").get(ctx.sid);
    // (요청 반영) 진행 중 적금도 목표 달성률에 포함
    const sav = await db.collection("savings").find({ student_id: ctx.sid, status: "running" }).toArray();
    const inv = await investSummaryFor(db, ctx.sid);
    return {
      goal_amount: g ? toInt(g.target_amount) : 0,
      goal_date: g ? str(g.goal_date) : "",
      balance: toInt(s && s.balance),
      savings: sav.map((x) => {
        const m = toDate(x.maturity_date || x.maturity_utc);
        const p = m ? kstParts(m) : null;
        return { principal: toInt(x.principal), interest: toInt(x.interest), maturity_kst: p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : "" };
      }),
      inv_eval_total: toInt(inv.evalTotal),
    };
  },

  async goal_save(ctx, { goal_amount, goal_date }) {
    requireStudent(ctx);
    goal_amount = toInt(goal_amount);
    goal_date = str(goal_date).trim();
    if (goal_amount <= 0) fail("목표 금액은 1 이상이어야 합니다.");
    await col(ctx.db, "goals").set(ctx.sid, { student_id: ctx.sid, target_amount: goal_amount, goal_date, created_at: new Date(), updated_at: new Date() }, true);
    return {};
  },
};
