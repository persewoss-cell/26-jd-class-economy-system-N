// 💼 직업/월급 : 공제 설정, 지급 설정, 수동지급, 중복 회수, 직업 지정/해제, 직업 추가/수정/삭제, 엑셀
import { col } from "../db.js";
import { fail, requireAny, isAdminPin, adminRecorder } from "../auth.js";
import {
  getSalaryCfg, calcNet, alreadyPaidThisMonth, writePaylog, adminTx, treasuryApply, listAccounts, activeStudents, removeSalaryPayment, runAutoPayouts,
} from "../core.js";
import { str, toInt, ior, forr, toDate, monthKey, kstParts } from "../../shared/format.js";

const JOBS = ["tab::💼 직업/월급", "jobs_write"];

async function payrollCfg(db) {
  const d = await col(db, "config").get("salary_payroll");
  if (!d) return { pay_day: 17, auto_enabled: false, repay: null };
  const mkey = monthKey();
  const hold = d.hold_month === mkey;
  const rp = hold && d.repay && d.repay.month === mkey ? ior(d.repay.day, 0) : null;
  // repay: 전체 회수로 멈춘 달이면 { pending: 아직 안 정함, day: 다시 지급일(0=이번 달 안 함) }
  return { pay_day: ior(d.pay_day, 25), auto_enabled: !!d.auto_enabled, repay: hold ? { pending: rp === null, day: rp } : null };
}

function cnt1(v) {
  // 기존 코드: max(0, int(x.get("student_count", 1) or 1))
  return Math.max(0, ior(v, 1));
}

async function listJobRows(db) {
  const docs = await db.collection("job_salary").find({}).sort({ order: 1 }).toArray();
  const rows = docs.map((x) => ({
    _id: String(x._id),
    order: ior(x.order, 999999),
    job: str(x.job),
    salary: toInt(x.salary),
    student_count: ior(x.student_count ?? x.student_cnt ?? 1, 1),
    raw_count: x.student_count,
    assigned_ids: (x.assigned_ids || []).map((v) => str(v)),
  }));
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

function normAssigned(assigned, cnt) {
  let a = [...assigned];
  if (cnt === 0) return [];
  if (a.length < cnt) a = a.concat(Array(cnt - a.length).fill(""));
  if (a.length > cnt) a = a.slice(0, cnt);
  return a;
}

const CORR = ["자동중복정정", "전체회수"];

function parseCorr(memo, mkey) {
  for (const label of CORR) {
    const tag = `(${label} `;
    if (memo.includes(tag)) {
      return [true, memo.split(tag)[0].trim(), memo.includes(`(${label} ${mkey}`)];
    }
  }
  return [false, memo, false];
}

function isCorrMemo(memo) {
  return CORR.some((l) => memo.includes(`(${l}`));
}

async function scanMonth(db, mode) {
  const now = new Date();
  const kp = kstParts(now);
  const startUtc = new Date(Date.UTC(kp.year, kp.month - 1, 1, 0, 0, 0) - 9 * 3600 * 1000);
  const accs = await listAccounts(db);
  const idToName = Object.fromEntries(accs.map((a) => [a.student_id, a.name]));
  const mkey = monthKey(now);
  const docs = await db.collection("transactions").find({ created_at: { $gte: startUtc, $lt: now } }).toArray();
  const rows = [];
  const corrected = {};
  for (const tx of docs) {
    const memo = str(tx.memo).trim();
    const t = str(tx.type);
    const sid = str(tx.student_id).trim();
    const amount = toInt(tx.amount);
    if (!memo.startsWith("월급 ")) continue;
    if (!sid) continue;
    if (t === "withdraw") {
      const [isCorr, base, thisMonth] = parseCorr(memo, mkey);
      if (isCorr) {
        if (thisMonth) {
          const fa = Math.abs(amount);
          if (fa > 0) {
            const k = `${sid}|${base}|${fa}`;
            corrected[k] = (corrected[k] || 0) + 1;
          }
        }
        continue;
      }
    }
    if (t !== "deposit") continue;
    if (amount <= 0) continue;
    if (isCorrMemo(memo)) continue;
    rows.push({ tx_id: String(tx._id), student_id: sid, name: idToName[sid] || "", memo, amount, ts: toDate(tx.created_at)?.getTime() || 0 });
  }
  const byKey = {};
  for (const r of rows) {
    const k = `${r.student_id}|${r.memo}|${r.amount}`;
    (byKey[k] = byKey[k] || []).push(r);
  }
  const targets = [];
  const groups = [];
  for (const [k, arr] of Object.entries(byKey)) {
    arr.sort((a, b) => a.ts - b.ts);
    const fix = toInt(corrected[k]);
    if (mode === "dup") {
      if (arr.length <= 1) continue;
      const raw = Math.max(0, arr.length - 1);
      const remain = Math.max(0, raw - fix);
      if (remain <= 0) continue;
      const st = 1 + Math.min(fix, raw);
      targets.push(...arr.slice(st, st + remain));
      groups.push({ student_id: arr[0].student_id, name: arr[0].name, memo: arr[0].memo, amount: arr[0].amount, count: arr.length });
    } else {
      const remain = Math.max(0, arr.length - fix);
      if (remain <= 0) continue;
      targets.push(...arr.slice(arr.length - remain));
      groups.push({ student_id: arr[0].student_id, name: arr[0].name, memo: arr[0].memo, amount: arr[0].amount, count: arr.length });
    }
  }
  return { targets, groups, sum_amount: targets.reduce((s, x) => s + toInt(x.amount), 0) };
}

// 월급 회수 = 기록을 지우고 원래대로 (학생 통장 기록 + 국고 공제 세입 기록, 새 '회수' 기록은 남기지 않음)
async function removeSalaries(db, targets, { dropPaylog }) {
  const accs = await listAccounts(db);
  const idToName = Object.fromEntries(accs.map((a) => [a.student_id, a.name]));
  let fixed = 0;
  let tre = 0;
  const errs = [];
  for (const t of targets) {
    const tx = await db.collection("transactions").findOne({ _id: String(t.tx_id) });
    if (!tx) continue;
    try {
      const r = await removeSalaryPayment(db, tx, idToName[str(tx.student_id)] || "", { dropPaylog });
      if (r.removed) fixed += 1;
      if (r.treasury) tre += 1;
    } catch (e) {
      errs.push(`[회수실패] ${str(t.name)} ${str(t.memo)}: ${e.message || e}`);
    }
  }
  return { fixed, treasury_fixed: tre, errors: errs };
}

async function manualTargets(db, cfg) {
  const jobs = await db.collection("job_salary").find({}).sort({ order: 1 }).toArray();
  const out = [];
  for (const x of jobs) {
    const net = calcNet(toInt(x.salary), cfg);
    if (net <= 0) continue;
    for (let sid of x.assigned_ids || []) {
      sid = str(sid).trim();
      if (sid) out.push({ sid, amt: net, job: str(x.job), gross: toInt(x.salary), job_id: String(x._id) });
    }
  }
  return out;
}

export default {
  async jobs_load(ctx) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    const cfg = await getSalaryCfg(db);
    const pcfg = await payrollCfg(db);
    const rows = await listJobRows(db);
    const studs = (await activeStudents(db)).map((x) => ({ student_id: x.student_id, no: x.no === undefined || x.no === null ? 999999 : ior(x.no, 999999), name: str(x.name) }));
    studs.sort((a, b) => a.no - b.no || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const mkey = monthKey();
    const targets = await manualTargets(db, cfg);
    let alreadyAny = false;
    for (const t of targets) {
      if (await alreadyPaidThisMonth(db, mkey, t.sid, t.job_id, t.job)) { alreadyAny = true; break; }
    }
    const dup = await scanMonth(db, "dup");
    const paidThisMonth = !!(await db.collection("payroll_log").findOne({ month: mkey }));
    return {
      cfg, payroll: pcfg, rows, students: studs, already_any: alreadyAny,
      dup: { groups: dup.groups, count: dup.targets.length, sum: dup.sum_amount }, paid_this_month: paidThisMonth,
    };
  },

  async salary_cfg_save(ctx, { tax_percent, desk_rent, electric_fee, health_fee }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    await col(ctx.db, "config").set("salary_deductions", {
      tax_percent: forr(tax_percent, 10.0), desk_rent: ior(desk_rent, 50), electric_fee: ior(electric_fee, 10), health_fee: ior(health_fee, 10), updated_at: new Date(),
    }, true);
    return {};
  },

  async payroll_cfg_save(ctx, { pay_day, auto_enabled }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    await col(ctx.db, "config").set("salary_payroll", { pay_day: ior(pay_day, 25), auto_enabled: !!auto_enabled, updated_at: new Date() }, true);
    return {};
  },

  async payroll_manual(ctx, { admin_pin, confirm_repay }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    const cfg = await getSalaryCfg(db);
    const mkey = monthKey();
    const targets = await manualTargets(db, cfg);
    if (confirm_repay) {
      if (str(admin_pin).trim() === "" || !isAdminPin(admin_pin)) fail("관리자 비밀번호(PIN)가 올바르지 않습니다.");
    }
    const accs = await listAccounts(db);
    const idToName = Object.fromEntries(accs.map((a) => [a.student_id, a.name]));
    const recorder = adminRecorder(ctx);
    let paid = 0;
    let err = 0;
    for (const t of targets) {
      const nm = idToName[t.sid] || "";
      let ok = true;
      try {
        await adminTx(db, { sid: t.sid, memo: `월급 ${t.job}`, deposit: t.amt, recorder });
      } catch {
        ok = false;
      }
      const ded = Math.max(0, t.gross - t.amt);
      if (ded > 0) {
        await treasuryApply(db, { memo: `월급 공제 세입(${mkey}) ${t.job}` + (nm ? ` - ${nm}` : ""), signed: ded, actor: "system_salary", recorder });
      }
      if (ok) {
        await writePaylog(db, mkey, t.sid, t.amt, t.job, "manual", t.job_id);
        paid += 1;
      } else err += 1;
    }
    return { paid, err };
  },

  async payroll_fix(ctx, { mode, admin_pin }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    if (str(admin_pin).trim() === "" || !isAdminPin(admin_pin)) fail("관리자 비밀번호(PIN)가 올바르지 않습니다.");
    const mkey = monthKey();
    if (mode === "all") {
      const paid = !!(await db.collection("payroll_log").findOne({ month: mkey }));
      if (!paid) fail("이번달 월급 지급이 되지 않아서 처리할 수 없습니다.");
      const scan = await scanMonth(db, "all");
      if (!scan.targets.length) return { none: true };
      // 이번 달 지급 기록까지 지워서 '한 달 한 번' 지급을 다시 할 수 있는 상태로
      const r = await removeSalaries(db, scan.targets, { dropPaylog: true });
      await db.collection("payroll_log").deleteMany({ month: mkey });
      await db.collection("payroll_auto_run").deleteMany({ month: mkey });
      const pc = await payrollCfg(db);
      const kp = kstParts(new Date());
      if (pc.auto_enabled && kp.day >= pc.pay_day) {
        // 지급일이 지난 뒤 전부 회수 → 바로 다시 나가지 않게 멈추고, 다시 지급할 날을 물어봄
        await col(db, "config").set("salary_payroll", { hold_month: mkey, repay: null, updated_at: new Date() }, true);
        r.need_repay = true;
      } else {
        await col(db, "config").set("salary_payroll", { hold_month: null, repay: null, updated_at: new Date() }, true);
      }
      return r;
    }
    const scan = await scanMonth(db, "dup");
    if (!scan.targets.length) return { none: true };
    return await removeSalaries(db, scan.targets, { dropPaylog: false });
  },

  // 전체 회수 후 '이번 달 다시 지급할 날' 정하기 (skip=true 면 이번 달은 자동지급 안 함)
  async payroll_repay_set(ctx, { day, skip }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    const mkey = monthKey();
    const today = kstParts(new Date()).day;
    const d = skip ? 0 : Math.max(today, Math.min(31, ior(day, today)));
    await col(db, "config").set("salary_payroll", { hold_month: mkey, repay: { month: mkey, day: d }, updated_at: new Date() }, true);
    if (d && d <= today) await runAutoPayouts(db, { force: true });
    return { day: d };
  },

  async payroll_all_preview(ctx) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const scan = await scanMonth(ctx.db, "all");
    return { count: scan.targets.length, sum: scan.sum_amount };
  },

  async job_assign(ctx, { job_id, sids, op }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    if (!job_id) fail("먼저 직업을 선택하세요.");
    sids = (sids || []).map(String).filter(Boolean);
    if (!sids.length) fail("대상 학생을 선택하세요.");
    const x = await col(db, "job_salary").get(job_id);
    if (!x) fail("직업을 찾지 못했어요.");
    const cnt = cnt1(x.student_count);
    const assigned = normAssigned((x.assigned_ids || []).map(str), cnt);
    if (op === "hire") {
      let changed = false;
      let full = 0;
      for (const sid of sids) {
        if (assigned.includes(sid)) continue;
        const k = assigned.indexOf("");
        if (k === -1) { full += 1; continue; }
        assigned[k] = sid;
        changed = true;
      }
      if (changed) {
        await col(db, "job_salary").update(job_id, { assigned_ids: assigned });
        return { changed: true, full };
      }
      return { changed: false };
    }
    const next = assigned.map((s) => (sids.includes(s) ? "" : s));
    if (JSON.stringify(next) !== JSON.stringify(assigned)) {
      await col(db, "job_salary").update(job_id, { assigned_ids: next });
      return { changed: true };
    }
    return { changed: false };
  },

  async job_clear_all(ctx) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const rows = await listJobRows(ctx.db);
    for (const r of rows) {
      const c = Math.max(0, toInt(r.raw_count, 0));
      await col(ctx.db, "job_salary").update(r._id, { assigned_ids: c > 0 ? Array(c).fill("") : [] });
    }
    return {};
  },

  async job_save(ctx, { job_id, job, salary, student_count }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    job = str(job).trim();
    if (!job) fail("직업을 입력해 주세요.");
    salary = toInt(salary);
    const sc = Math.max(1, toInt(student_count, 1));
    if (job_id) {
      const x = await col(db, "job_salary").get(job_id);
      let cur = (x && x.assigned_ids ? x.assigned_ids : []).map(str);
      if (cur.length < sc) cur = cur.concat(Array(sc - cur.length).fill(""));
      if (cur.length > sc) cur = cur.slice(0, sc);
      await col(db, "job_salary").update(job_id, { job, salary, student_count: sc, assigned_ids: cur, updated_at: new Date() });
      return { result: "updated" };
    }
    const rows = await listJobRows(db);
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 1;
    await col(db, "job_salary").add({ order: nextOrder, job, salary, student_count: sc, assigned_ids: Array(sc).fill(""), created_at: new Date(), updated_at: new Date() });
    return { result: "added" };
  },

  async job_delete(ctx, { job_id }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    await col(ctx.db, "job_salary").del(job_id);
    return {};
  },

  async jobs_bulk_save(ctx, { rows, wipe }) {
    requireAny(ctx, JOBS, "접근 권한이 없습니다.");
    const db = ctx.db;
    if (!rows || !rows.length) fail("먼저 올바른 엑셀을 업로드해서 미리보기를 만든 뒤 저장하세요.");
    if (wipe) await db.collection("job_salary").deleteMany({});
    for (const r of rows) {
      const n = toInt(r["배정 수"]);
      await col(db, "job_salary").add({ order: toInt(r["순"]), job: str(r["직업"]), salary: toInt(r["월급"]), student_count: n, assigned_ids: Array(Math.max(0, n)).fill(""), created_at: new Date() });
    }
    return {};
  },
};
