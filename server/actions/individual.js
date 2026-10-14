// 🔎 개별조회 : 학생 한 줄 요약 + 통장내역 + 통장내역 삭제
import { col } from "../db.js";
import { fail, requireAny, isAdminPin } from "../auth.js";
import {
  activeStudents, loadRoleLookup, roleNameFor, loadInvestProductMap, investSummaries, getCreditCfg,
  listStatSubmissions, manualDeltaMap, calcCreditFrom, applyBalance, isSavingsMemo, isInvestMemo,
  getSalaryCfg, calcNet, treasuryApply,
} from "../core.js";
import { str, toInt, kstParts, pad2 } from "../../shared/format.js";

const IND = ["tab::🔎 개별조회"];

export default {
  async individual_students(ctx) {
    requireAny(ctx, IND, "접근 권한이 없습니다.");
    const rows = (await activeStudents(ctx.db))
      .filter((x) => str(x.name).trim())
      .map((x) => ({ student_id: x.student_id, no: toInt(x.no, 999999) || 999999, name: str(x.name).trim(), balance: toInt(x.balance) }));
    rows.sort((a, b) => a.no - b.no || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { rows };
  },

  // 선택 학생들의 접힘 한 줄 요약 데이터
  async individual_summaries(ctx, { sids }) {
    requireAny(ctx, IND, "접근 권한이 없습니다.");
    const db = ctx.db;
    sids = (sids || []).map(String);
    if (!sids.length) return { rows: [] };
    const [studs, lookup, prodMap, ledger, savings, cfg, subs, md] = await Promise.all([
      db.collection("students").find({ _id: { $in: sids } }).toArray(),
      loadRoleLookup(db),
      loadInvestProductMap(db),
      db.collection("invest_ledger").find({ student_id: { $in: sids } }).toArray(),
      db.collection("savings").find({ student_id: { $in: sids } }).toArray(),
      getCreditCfg(db),
      listStatSubmissions(db, 200),
      manualDeltaMap(db, sids),
    ]);
    const inv = investSummaries(ledger, prodMap);
    const byId = Object.fromEntries(studs.map((s) => [String(s._id), s]));
    const savBy = {};
    for (const s of savings) {
      const k = str(s.student_id);
      (savBy[k] = savBy[k] || []).push(s);
    }
    const rows = sids.map((sid) => {
      const s = byId[sid] || {};
      const bal = toInt(s.balance);
      // 적금 탭과 동일: 만기/해지 제외 원금 합계 (학생당 최대 50건 조회와 동일하게)
      const sv = (savBy[sid] || []).slice(0, 50).reduce((acc, x) => {
        const stt = str(x.status || "active").toLowerCase().trim();
        return ["matured", "canceled", "cancelled"].includes(stt) ? acc : acc + toInt(x.principal);
      }, 0);
      const iv = inv[sid] || { evalText: "없음", evalTotal: 0 };
      const c = calcCreditFrom(cfg, subs, sid, md[sid] || 0);
      return {
        student_id: sid,
        no: toInt(s.no),
        name: str(s.name),
        asset_total: bal + sv + toInt(iv.evalTotal),
        balance: bal,
        savings_total: sv,
        inv_text: iv.evalText,
        role_name: roleNameFor(s, sid, lookup),
        credit_score: c.score,
        credit_grade: c.grade,
      };
    });
    return { rows };
  },

  // api_admin_delete_txs (하드 삭제)
  async tx_delete(ctx, { admin_pin, sid, tx_ids }) {
    requireAny(ctx, IND, "접근 권한이 없습니다.");
    const db = ctx.db;
    tx_ids = (tx_ids || []).map(String);
    if (!tx_ids.length) fail("체크된 항목이 없어요.");
    if (str(admin_pin).trim() === "" || !isAdminPin(admin_pin)) fail("관리자 비밀번호(PIN)가 올바르지 않습니다.");
    sid = String(sid || "");
    if (!sid) fail("삭제할 항목이 없습니다.");
    const txDocs = [];
    for (const tid of tx_ids) {
      const tx = await col(db, "transactions").get(tid);
      if (!tx || str(tx.student_id) !== sid) continue;
      txDocs.push(tx);
    }
    if (!txDocs.length) fail("유효한 거래를 찾지 못했습니다.");
    const blocked = [];
    const valid = [];
    for (const tx of txDocs) {
      const t = str(tx.type);
      const memo = str(tx.memo);
      if (t === "rollback" || memo.includes("되돌리기")) blocked.push(tx);
      else if (isSavingsMemo(memo) || t === "maturity") blocked.push(tx);
      else if (isInvestMemo(memo)) blocked.push(tx);
      else valid.push(tx);
    }
    if (!valid.length) {
      let msg = "선택한 항목이 모두 삭제 불가합니다.";
      if (blocked.length) msg += " (적금/투자/되돌리기 관련 내역은 삭제할 수 없어요)";
      fail(msg);
    }
    const jobDed = {};
    try {
      const cfg = await getSalaryCfg(db);
      for (const j of await col(db, "job_salary").find({})) {
        const jn = str(j.job);
        const gross = toInt(j.salary);
        if (jn && !(jn in jobDed)) jobDed[jn] = Math.max(0, gross - calcNet(gross, cfg));
      }
    } catch {
      /* ignore */
    }
    const stu = await col(db, "students").get(sid);
    const studentName = str(stu && stu.name);
    const kp = kstParts(new Date());
    const delTag = `${pad2(kp.month)}.${pad2(kp.day)}.`;
    let deleted = 0;
    let treReversed = 0;
    const errors = [];
    for (const tx of valid) {
      const amount = toInt(tx.amount);
      const memo = str(tx.memo).trim();
      const t = str(tx.type);
      try {
        const r = await db.collection("transactions").deleteOne({ _id: String(tx._id) });
        if (!r.deletedCount) throw new Error("이미 삭제됨");
        await applyBalance(db, sid, -amount);
        deleted += 1;
      } catch (e) {
        errors.push(`[삭제실패] tx=${tx._id} memo=${memo} err=${e.message || e}`);
        continue;
      }
      const isCorr = memo.includes("(자동중복정정") || memo.includes("(전체회수");
      if (t === "deposit" && amount > 0 && memo.startsWith("월급 ") && !isCorr) {
        const jobName = memo.replace("월급 ", "").trim();
        const ded = toInt(jobDed[jobName]);
        if (ded > 0) {
          try {
            await treasuryApply(db, {
              memo: `월급 공제 세입 환급(항목삭제 ${delTag}) ${jobName}` + (studentName ? ` - ${studentName}` : ""),
              signed: -ded, actor: "admin_delete_tx", recorder: "관리자",
            });
            treReversed += 1;
          } catch (e) {
            errors.push(`[국고환급실패] tx=${tx._id} job=${jobName} err=${e.message || e}`);
          }
        }
      }
    }
    const message = blocked.length ? `삭제 제외 ${blocked.length}건(적금/투자/되돌리기 관련 내역)은 건너뛰었습니다.` : null;
    return { deleted, treasury_reversed: treReversed, errors, message };
  },
};
