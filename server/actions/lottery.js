// 🍀 복권
import { col, newId } from "../db.js";
import { curGroup } from "../group.js";
import { fail, requireAdmin, requireStudent, ADMIN_NAME } from "../auth.js";
import { adminTx, applyBalance, insertTx, treasuryApply } from "../core.js";
import { str, toInt, ior, toDate, fmtLotteryDt, fmtMd, pyRound, pad2 } from "../../shared/format.js";

function normNums(nums) {
  const out = [];
  for (const n of nums || []) {
    const x = Number(n);
    if (!Number.isFinite(x)) continue;
    const i = Math.trunc(x);
    if (i >= 1 && i <= 20 && !out.includes(i)) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

// 0도 올바른 값(예: 3등 당첨금 0)으로 인정 — 비어 있을 때만 기본값
function iz(v, d) {
  return v === null || v === undefined || v === "" ? d : toInt(v, d);
}

async function getState(db) {
  const d = await col(db, "config").get("lottery_state");
  if (!d) return { current_round_no: 0, current_round_id: "", status: "idle" };
  return { current_round_no: toInt(d.current_round_no), current_round_id: str(d.current_round_id), status: str(d.status || "idle") };
}

async function openRound(db) {
  const st = await getState(db);
  if (st.current_round_id) {
    const r = await col(db, "lottery_rounds").get(st.current_round_id);
    if (r && str(r.status).trim() === "open") return { ...r, round_id: String(r._id) };
  }
  const docs = await db.collection("lottery_rounds").find({ status: "open" }).sort({ round_no: -1 }).limit(1).toArray();
  if (docs.length) return { ...docs[0], round_id: String(docs[0]._id) };
  return null;
}

async function listEntries(db, rid) {
  rid = str(rid).trim();
  if (!rid) return [];
  const docs = await db.collection("lottery_entries").find({ round_id: rid }).toArray();
  const rows = docs.map((x) => {
    const nums = normNums(x.numbers);
    const dt = toDate(x.submitted_at);
    return {
      entry_id: String(x._id),
      student_id: str(x.student_id),
      student_no: toInt(x.student_no),
      student_name: str(x.student_name),
      numbers: nums,
      numbers_text: nums.map(pad2).join(", "),
      ts: dt ? dt.getTime() : null,
      submitted_at: dt,
      submitted_at_text: fmtLotteryDt(dt),
      is_admin: !!x.is_admin,
      treasury_applied: !!x.treasury_applied,
    };
  });
  rows.sort((a, b) => (a.ts === null) - (b.ts === null) || (a.ts || 0) - (b.ts || 0) || (a.entry_id < b.entry_id ? -1 : 1));
  return rows;
}

function participantCount(entries) {
  const keys = new Set();
  for (const e of entries) {
    const sid = str(e.student_id).trim();
    if (sid) { keys.add(`sid:${sid}`); continue; }
    const sno = toInt(e.student_no);
    const nm = str(e.student_name).trim();
    if (sno > 0) keys.add(`sno:${sno}`);
    else if (nm) keys.add(`name:${nm}`);
  }
  return keys.size;
}

function entryView(entries) {
  return entries.map((r) => ({ "참여 일시": r.submitted_at_text, 번호: r.student_no, 이름: r.student_name, "복권 참여 번호": r.numbers_text }));
}

function summaryView(entries, price) {
  return [{ 참여자수: participantCount(entries), "참여 복권수": entries.length, "총 액수": entries.length * price }];
}

function financials(r) {
  const winners = r.winners || [];
  const sales = toInt(r.total_sales);
  const payout = winners.reduce((s, w) => s + toInt(w.prize), 0);
  const adminWin = winners.filter((w) => w.is_admin || (!str(w.student_id).trim() && str(w.student_name).trim() === ADMIN_NAME)).reduce((s, w) => s + toInt(w.prize), 0);
  const tax = ior(r.tax_rate, 40);
  const fp = iz(r.first_pct, 80);
  const sp = iz(r.second_pct, 20);
  const third = iz(r.third_prize, 20);
  const c3 = winners.filter((w) => toInt(w.rank) === 3).length;
  const pool = Math.max(sales - third * c3, 0);
  const c1 = winners.filter((w) => toInt(w.rank) === 1).length;
  const c2 = winners.filter((w) => toInt(w.rank) === 2).length;
  const t1 = c1 > 0 ? pyRound(pool * (fp / 100) * (tax / 100)) : 0;
  const t2 = c2 > 0 ? pyRound(pool * (sp / 100) * (tax / 100)) : 0;
  return { payout_total: payout, tax_total: t1 + t2, national_amount: sales - payout, admin_winning_total: adminWin };
}

async function payPrizes(db, rid) {
  const r = await col(db, "lottery_rounds").get(rid);
  if (!r) fail("복권 회차를 찾지 못했습니다.");
  if (str(r.status) !== "drawn") fail("당첨번호 제출 후에 당첨금 지급이 가능합니다.");
  if (r.payout_done) fail("이미 당첨금 지급이 완료된 회차입니다.");
  const claimed = await col(db, "lottery_rounds").updateIf(rid, { payout_done: { $ne: true }, payout_paying: { $ne: true } }, { payout_paying: true });
  if (!claimed) fail("이미 당첨금 지급이 완료된 회차입니다.");
  let paid = 0;
  const winners = r.winners || [];
  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    const sid = str(w.student_id);
    const prize = toInt(w.prize);
    const rank = toInt(w.rank);
    if (!sid || prize <= 0) continue;
    // 중간에 실패했다가 다시 지급할 때 이미 받은 사람은 건너뜀
    if (w.paid) {
      paid += prize;
      continue;
    }
    try {
      await adminTx(db, { sid, memo: `복권 ${toInt(r.round_no)}회 ${rank}등 당첨금`, deposit: prize, recorder: "관리자" });
      await db.collection("lottery_rounds").updateOne({ _id: rid }, { $set: { [`winners.${i}.paid`]: true } });
    } catch (e) {
      await col(db, "lottery_rounds").update(rid, { payout_paying: false });
      fail(`당첨금 지급 실패: ${e.userMessage || e.message}`);
    }
    paid += prize;
  }
  await col(db, "lottery_rounds").set(rid, { payout_done: true, payout_done_at: new Date(), payout_total: paid, payout_paying: false }, true);
  return paid;
}

async function applyLedger(db, rid) {
  const r = await col(db, "lottery_rounds").get(rid);
  if (!r) fail("복권 회차를 찾지 못했습니다.");
  if (r.ledger_applied) fail("이미 장부 반영된 회차입니다.");
  const claimed = await col(db, "lottery_rounds").updateIf(rid, { ledger_applied: { $ne: true }, ledger_applying: { $ne: true } }, { ledger_applying: true });
  if (!claimed) fail("이미 장부 반영된 회차입니다.");
  const no = toInt(r.round_no);
  let participants = toInt(r.participants);
  const tickets = toInt(r.ticket_count) || participants;
  const sales = toInt(r.total_sales);
  const f = financials(r);
  if (participants <= 0) participants = participantCount(await listEntries(db, rid));
  if (f.national_amount > 0) await treasuryApply(db, { memo: `복권 ${no}회 국고 반영`, signed: f.national_amount, actor: "lottery", recorder: "관리자" });
  if (f.admin_winning_total > 0) await treasuryApply(db, { memo: `복권 ${no}회 관리자 당첨금 총액`, signed: f.admin_winning_total, actor: "lottery_admin", recorder: "관리자" });
  await col(db, "lottery_admin_ledger").add({
    round_id: rid, round_no: no, participants, ticket_count: tickets, total_sales: sales, payout_total: f.payout_total, tax_total: f.tax_total,
    national_amount: f.national_amount, admin_winning_total: f.admin_winning_total, drawn_at: r.drawn_at || null, created_at: new Date(),
  });
  await col(db, "lottery_rounds").set(rid, { ledger_applied: true, ledger_applied_at: new Date(), ledger_applying: false }, true);
}

async function finalize(db, rid) {
  const r = await col(db, "lottery_rounds").get(rid);
  if (!r) fail("복권 회차를 찾지 못했습니다.");
  if (!r.payout_done) await payPrizes(db, rid);
  if (!r.ledger_applied) await applyLedger(db, rid);
}

export default {
  async lottery_admin_load(ctx, { pick_round_id, visible_round_id }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const open = await openRound(db);
    const out = { open: open ? { round_id: open.round_id, round_no: toInt(open.round_no), ticket_price: toInt(open.ticket_price) } : null };
    if (open) {
      const ents = await listEntries(db, open.round_id);
      const price = toInt(open.ticket_price);
      let aw = 0;
      let an = 0;
      let st = 0;
      for (const e of ents) {
        if (e.is_admin) { if (e.treasury_applied) aw += 1; else an += 1; } else st += 1;
      }
      out.counts = { admin_with: aw, admin_without: an, student: st, price };
    }
    let cur = open;
    if (!cur) {
      const d = await db.collection("lottery_rounds").find({}).sort({ round_no: -1 }).limit(1).toArray();
      if (d.length) cur = { ...d[0], round_id: String(d[0]._id) };
    }
    if (cur) {
      const ents = await listEntries(db, cur.round_id);
      const closed = ["closed", "drawn"].includes(str(cur.status));
      const show = ents.length > 0 && closed && !cur.payout_done;
      out.current = { round_id: cur.round_id, round_no: toInt(cur.round_no), status: str(cur.status), payout_done: !!cur.payout_done, ledger_applied: !!cur.ledger_applied };
      if (show) {
        out.current.summary = summaryView(ents, toInt(cur.ticket_price));
        out.current.entries = entryView(ents);
      }
      if (visible_round_id && String(visible_round_id) === cur.round_id && str(cur.status) === "drawn") {
        out.current.winning_numbers = normNums(cur.winning_numbers);
        out.current.winners = (cur.winners || []).map((w) => ({ rank: toInt(w.rank), student_no: toInt(w.student_no), student_name: str(w.student_name), numbers: normNums(w.numbers), prize: toInt(w.prize) }));
      }
    }
    const allRounds = await db.collection("lottery_rounds").find({}).sort({ round_no: -1 }).limit(80).toArray();
    out.closed = allRounds.filter((r) => ["closed", "drawn"].includes(str(r.status))).map((r) => ({
      round_id: String(r._id), round_no: toInt(r.round_no), status: str(r.status), payout_done: !!r.payout_done, ledger_applied: !!r.ledger_applied,
    }));
    if (pick_round_id) {
      const pr = await col(db, "lottery_rounds").get(pick_round_id);
      if (pr) {
        const ents = await listEntries(db, pick_round_id);
        out.picked = ents.length ? { summary: summaryView(ents, toInt(pr.ticket_price)), entries: entryView(ents) } : { summary: null, entries: [] };
        out.picked.status = str(pr.status);
        out.picked.payout_done = !!pr.payout_done;
        out.picked.ledger_applied = !!pr.ledger_applied;
      }
    }
    const led = await db.collection("lottery_admin_ledger").find({}).sort({ round_no: -1 }).limit(200).toArray();
    const ledger = [];
    for (const x of led) {
      let p = toInt(x.payout_total);
      let t = toInt(x.tax_total);
      let n = toInt(x.national_amount);
      let a = toInt(x.admin_winning_total);
      const rid = str(x.round_id).trim();
      if (rid) {
        const r = await col(db, "lottery_rounds").get(rid);
        if (r) {
          const f = financials(r);
          p = f.payout_total || p;
          t = f.tax_total || t;
          n = f.national_amount || n;
          a = f.admin_winning_total || a;
          if (p !== toInt(x.payout_total) || t !== toInt(x.tax_total) || n !== toInt(x.national_amount) || a !== toInt(x.admin_winning_total)) {
            await col(db, "lottery_admin_ledger").set(String(x._id), { payout_total: p, tax_total: t, national_amount: n, admin_winning_total: a, updated_at: new Date() }, true);
          }
        }
      }
      ledger.push({
        회차: toInt(x.round_no), 복권추첨일: fmtMd(x.drawn_at || x.created_at), "참여자 수": toInt(x.participants), "참여 복권 수": toInt(x.ticket_count),
        "총 액수": toInt(x.total_sales), "당첨금 지급 총액": p <= 0 ? "-" : p, 세금: t <= 0 ? "-" : t, "국고 반영액": n,
      });
    }
    out.ledger = ledger;
    return out;
  },

  async lottery_open(ctx, { ticket_price, tax_rate, first_pct, second_pct, third_prize }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const pending = await db.collection("lottery_rounds").findOne({ status: { $in: ["closed", "drawn"] }, ledger_applied: false });
    if (pending) fail("현재 진행되는 복권이 완료되지 않았습니다. (직전 복권의 장부/국고 반영을 먼저 완료해 주세요)");
    const price = ior(ticket_price, 20);
    const tax = ior(tax_rate, 40);
    const fp = iz(first_pct, 80);
    const sp = iz(second_pct, 20);
    const third = iz(third_prize, 20);
    if (price <= 1) fail("복권 가격은 1보다 커야 합니다.");
    if (!(tax >= 1 && tax <= 100)) fail("세금(%)은 1~100 사이여야 합니다.");
    if (fp < 0 || sp < 0 || fp + sp !== 100) fail("1등/2등 당첨 백분율의 합은 100이어야 합니다.");
    if (third < 0) fail("3등 당첨금은 0 이상이어야 합니다.");
    const st = await getState(db);
    if (st.current_round_id) {
      const cur = await col(db, "lottery_rounds").get(st.current_round_id);
      if (cur && str(cur.status) === "open") fail("이미 개시된 복권이 있습니다. 먼저 마감해 주세요.");
    }
    const next = st.current_round_no + 1;
    const rid = await col(db, "lottery_rounds").add({
      round_no: next, status: "open", ticket_price: price, tax_rate: tax, first_pct: fp, second_pct: sp, third_prize: third,
      winning_numbers: [], winners: [], payout_done: false, ledger_applied: false, opened_at: new Date(), closed_at: null, drawn_at: null, created_at: new Date(),
    });
    await col(db, "config").set("lottery_state", { current_round_no: next, current_round_id: rid, status: "open", updated_at: new Date() }, true);
    return { round_no: next };
  },

  async lottery_close(ctx) {
    requireAdmin(ctx);
    const db = ctx.db;
    const st = await getState(db);
    if (!st.current_round_id) fail("개시된 복권이 없습니다.");
    const r = await col(db, "lottery_rounds").get(st.current_round_id);
    if (!r) fail("복권 회차를 찾지 못했습니다.");
    if (str(r.status) !== "open") fail("진행 중인 복권만 마감할 수 있습니다.");
    await col(db, "lottery_rounds").update(st.current_round_id, { status: "closed", closed_at: new Date() });
    await col(db, "config").set("lottery_state", { status: "closed", updated_at: new Date() }, true);
    return {};
  },

  async lottery_admin_join(ctx, { count, apply_treasury }) {
    requireAdmin(ctx);
    const db = ctx.db;
    count = toInt(count);
    if (count <= 0) fail("복권 참여 수는 1 이상이어야 합니다.");
    const open = await openRound(db);
    if (!open) fail("개시된 복권이 없습니다.");
    const price = ior(open.ticket_price, 20);
    const r = await col(db, "lottery_rounds").get(open.round_id);
    if (!r || str(r.status) !== "open") fail("마감된 복권은 구매할 수 없습니다.");
    const total = Math.max(price, 0) * count;
    if (apply_treasury && total > 0) await treasuryApply(db, { memo: `복권 ${toInt(open.round_no)}회 관리자 참여금`, signed: -total, actor: "lottery_admin", recorder: "관리자" });
    const docs = [];
    for (let i = 0; i < count; i++) {
      const pool = Array.from({ length: 20 }, (_, k) => k + 1);
      for (let j = pool.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [pool[j], pool[k]] = [pool[k], pool[j]];
      }
      docs.push({
        _id: newId(), round_id: open.round_id, round_no: toInt(open.round_no), student_id: "", student_no: 0, student_name: ADMIN_NAME,
        numbers: pool.slice(0, 4).sort((a, b) => a - b), submitted_at: new Date(), ticket_price: price, is_admin: true, treasury_applied: !!apply_treasury,
      });
    }
    await db.collection("lottery_entries").insertMany(docs);
    return { count };
  },

  async lottery_draw(ctx, { round_id, numbers }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const rid = str(round_id).trim();
    if (!rid) fail("대상 복권 회차가 없습니다.");
    const win = normNums(numbers);
    if (win.length !== 4) fail("당첨번호는 1~20 숫자 중 중복 없이 4개여야 합니다.");
    const rnd = await col(db, "lottery_rounds").get(rid);
    if (!rnd) fail("복권 회차를 찾지 못했습니다.");
    if (!["closed", "drawn"].includes(str(rnd.status))) fail("마감된 복권만 추첨할 수 있습니다.");
    if (rnd.payout_done || rnd.payout_paying || rnd.ledger_applied) fail("당첨금 지급이 시작된 회차는 당첨번호를 바꿀 수 없어요.");
    const ents = await listEntries(db, rid);
    const price = ior(rnd.ticket_price, 20);
    const tax = ior(rnd.tax_rate, 40);
    const fp = iz(rnd.first_pct, 80);
    const sp = iz(rnd.second_pct, 20);
    const third = iz(rnd.third_prize, 20);
    const sales = price * ents.length;
    const w1 = [];
    const w2 = [];
    const w3 = [];
    for (const e of ents) {
      const m = e.numbers.filter((n) => win.includes(n)).length;
      const row = { student_id: e.student_id, student_no: e.student_no, student_name: e.student_name, is_admin: e.is_admin, numbers: e.numbers, match_count: m, submitted_at: e.submitted_at, submitted_at_text: e.submitted_at_text };
      if (m === 2) w3.push(row);
      else if (m === 3) w2.push(row);
      else if (m === 4) w1.push(row);
    }
    const pool = Math.max(sales - w3.length * third, 0);
    const g1 = pyRound(pool * (fp / 100));
    const g2 = pyRound(pool * (sp / 100));
    const n1 = pyRound(g1 * (1 - tax / 100));
    const n2 = pyRound(g2 * (1 - tax / 100));
    const e1 = w1.length ? pyRound(n1 / w1.length) : 0;
    const e2 = w2.length ? pyRound(n2 / w2.length) : 0;
    const winners = [
      ...w1.map((x) => ({ ...x, rank: 1, prize: e1 })),
      ...w2.map((x) => ({ ...x, rank: 2, prize: e2 })),
      ...w3.map((x) => ({ ...x, rank: 3, prize: third })),
    ];
    winners.sort((a, b) => (toInt(a.rank) || 9) - (toInt(b.rank) || 9) || a.student_no - b.student_no);
    const payout = winners.reduce((s, x) => s + toInt(x.prize), 0);
    const t1 = w1.length ? pyRound(pool * (fp / 100) * (tax / 100)) : 0;
    const t2 = w2.length ? pyRound(pool * (sp / 100) * (tax / 100)) : 0;
    await col(db, "lottery_rounds").set(rid, {
      status: "drawn", winning_numbers: win, winners, total_sales: sales, participants: participantCount(ents), ticket_count: ents.length,
      payout_total: payout, tax_total: t1 + t2, drawn_at: new Date(),
    }, true);
    return {};
  },

  async lottery_finalize(ctx, { round_id }) {
    requireAdmin(ctx);
    await finalize(ctx.db, str(round_id));
    return {};
  },

  async lottery_user_load(ctx) {
    requireStudent(ctx);
    const db = ctx.db;
    const open = await openRound(db);
    if (!open) return { open: null };
    const docs = await db.collection("lottery_entries").find({ student_id: ctx.sid, round_id: open.round_id }).toArray();
    const hist = docs
      .map((x) => ({ ts: toDate(x.submitted_at)?.getTime() ?? -Infinity, row: { 회차: toInt(x.round_no), 번호: toInt(x.student_no), 이름: str(x.student_name), "복권 참여 번호": normNums(x.numbers).map(pad2).join(", ") } }))
      .sort((a, b) => b.ts - a.ts)
      .map((x) => x.row);
    return { open: { round_id: open.round_id, round_no: toInt(open.round_no), ticket_price: toInt(open.ticket_price) }, history: hist };
  },

  async lottery_buy(ctx, { games }) {
    requireStudent(ctx);
    const db = ctx.db;
    const norm = [];
    for (const g of games || []) {
      const n = normNums(g);
      if (n.length !== 4) fail("각 게임은 1~20 숫자 중 중복 없이 4개여야 합니다.");
      norm.push(n);
    }
    if (!norm.length) fail("구매할 게임이 없습니다.");
    const open = await openRound(db);
    if (!open) fail("개시된 복권이 없습니다.");
    const price = ior(open.ticket_price, 20);
    if (price <= 0) fail("복권 가격 설정이 올바르지 않습니다.");
    const r = await col(db, "lottery_rounds").get(open.round_id);
    if (!r || str(r.status) !== "open") fail("마감된 복권은 구매할 수 없습니다.");
    const total = price * norm.length;
    const doc = await applyBalance(db, ctx.sid, -total, { minBalance: total });
    if (!doc) fail("잔액이 부족하여 복권을 구매할 수 없습니다.");
    const s = ctx.student;
    const no = toInt(open.round_no);
    await insertTx(db, { sid: ctx.sid, type: "withdraw", amount: -total, balanceAfter: toInt(doc.balance), memo: `복권 ${no}회 ${norm.length}게임 구매`, recorder: str(s.name) });
    await db.collection("lottery_entries").insertMany(norm.map((n) => ({
      _id: newId(), round_id: open.round_id, round_no: no, student_id: ctx.sid, student_no: toInt(s.no), student_name: str(s.name), numbers: n, submitted_at: new Date(), ticket_price: price, grp: curGroup(),
    })));
    return { count: norm.length };
  },
};
