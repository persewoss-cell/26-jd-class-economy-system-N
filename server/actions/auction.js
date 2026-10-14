// 🏷️ 경매
import { col } from "../db.js";
import { fail, requireAdmin, requireStudent } from "../auth.js";
import { applyBalance, insertTx, treasuryApply } from "../core.js";
import { str, toInt, toDate, fmtAuctionDt, pad2 } from "../../shared/format.js";

async function getState(db) {
  const d = await col(db, "config").get("auction_state");
  if (!d) return { current_round_no: 0, current_round_id: "", status: "idle" };
  return { current_round_no: toInt(d.current_round_no), current_round_id: str(d.current_round_id), status: str(d.status || "idle") };
}

async function openRound(db) {
  const st = await getState(db);
  if (st.current_round_id) {
    const r = await col(db, "auction_rounds").get(st.current_round_id);
    if (r && str(r.status).trim() === "open") return { ...r, round_id: String(r._id) };
  }
  const docs = await db.collection("auction_rounds").find({ status: "open" }).sort({ round_no: -1 }).limit(1).toArray();
  if (docs.length) return { ...docs[0], round_id: String(docs[0]._id) };
  return null;
}

async function listBids(db, rid) {
  rid = str(rid).trim();
  if (!rid) return [];
  const docs = await db.collection("auction_bids").find({ round_id: rid }).toArray();
  const rows = docs.map((r) => {
    const dt = toDate(r.submitted_at);
    return {
      bid_id: String(r._id),
      round_no: toInt(r.round_no),
      student_id: str(r.student_id),
      student_no: toInt(r.student_no),
      student_name: str(r.student_name),
      amount: toInt(r.amount),
      ts: dt ? dt.getTime() : Number.MAX_SAFE_INTEGER,
      submitted_at_text: fmtAuctionDt(dt),
    };
  });
  rows.sort((a, b) => b.amount - a.amount || a.ts - b.ts);
  return rows;
}

function bidView(rows) {
  return rows.map((r) => ({ "입찰 가격": r.amount, 입찰일시: r.submitted_at_text, 번호: r.student_no, 이름: r.student_name }));
}

async function closedRounds(db, limit = 30) {
  const docs = await db.collection("auction_rounds").find({ status: "closed" }).sort({ round_no: -1 }).limit(limit).toArray();
  return docs.map((r) => ({ ...r, round_id: String(r._id) }));
}

async function applyLedger(db, rid, refund) {
  rid = str(rid).trim();
  if (!rid) fail("round_id가 없습니다.");
  const r = await col(db, "auction_rounds").get(rid);
  if (!r) fail("경매 회차를 찾지 못했습니다.");
  if (str(r.status) !== "closed") fail("마감된 경매만 장부 반영할 수 있습니다.");
  if (r.ledger_applied) fail("이미 장부 반영된 경매입니다.");
  // 두 번 반영되지 않도록 선점
  const claimed = await col(db, "auction_rounds").updateIf(rid, { ledger_applied: { $ne: true }, ledger_applying: { $ne: true } }, { ledger_applying: true });
  if (!claimed) fail("이미 장부 반영된 경매입니다.");
  const bids = await listBids(db, rid);
  const participants = bids.length;
  const total = bids.reduce((s, b) => s + b.amount, 0);
  const no = toInt(r.round_no);
  let fee = 0;
  let winnerAmount = 0;
  let treTotal;
  let treMemo;
  if (refund && bids.length) {
    const w = bids[0];
    winnerAmount = w.amount;
    for (const b of bids.slice(1)) {
      const amt = b.amount;
      const sid = str(b.student_id).trim();
      if (amt <= 0 || !sid) continue;
      const f = Math.floor(amt / 10);
      const pay = amt - f;
      fee += f;
      if (pay <= 0) continue;
      const exists = await col(db, "students").get(sid);
      if (!exists) continue;
      const doc = await applyBalance(db, sid, pay);
      await insertTx(db, { sid, type: "deposit", amount: pay, balanceAfter: toInt(doc && doc.balance), memo: `[경매 ${pad2(no)}회] 낙찰 실패 입찰금 반환(수수료 10% 차감)`, recorder: "관리자" });
    }
    treTotal = Math.max(winnerAmount, 0);
    treMemo = `경매 ${no}회 세입(낙찰자만 반영: ${w.student_name} ${winnerAmount})`;
  } else {
    treTotal = total;
    if (bids.length) winnerAmount = bids[0].amount;
    treMemo = `경매 ${no}회 세입`;
  }
  if (treTotal > 0) await treasuryApply(db, { memo: treMemo, signed: treTotal, actor: "auction", recorder: "관리자" });
  if (refund && fee > 0) {
    await treasuryApply(db, { memo: "낙찰금 수수료 총액", signed: fee, actor: "auction", recorder: "관리자" });
    treTotal += fee;
  }
  await col(db, "auction_admin_ledger").add({
    round_id: rid, round_no: no, bid_date: fmtAuctionDt(r.opened_at), bid_name: str(r.bid_name), participants,
    total_bid_amount: total, total_amount: treTotal, refund_non_winners: !!refund, fee_amount: fee, winner_amount: winnerAmount, created_at: new Date(),
  });
  await col(db, "auction_rounds").set(rid, { ledger_applied: true, ledger_applied_at: new Date(), ledger_applying: false }, true);
  return { total: treTotal, participants, fee_total: fee };
}

export default {
  async auction_admin_load(ctx, { pick_round_id }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const open = await openRound(db);
    const out = { open: open ? { round_no: toInt(open.round_no), bid_name: str(open.bid_name), affiliation: str(open.affiliation) } : null };
    if (!open) {
      const cl = (await closedRounds(db, 1))[0];
      if (cl) {
        out.latest = { round_id: cl.round_id, round_no: toInt(cl.round_no), bid_name: str(cl.bid_name), ledger_applied: !!cl.ledger_applied };
        if (!cl.ledger_applied) out.latest.bids = bidView(await listBids(db, cl.round_id));
      }
    }
    const closed = await closedRounds(db, 50);
    out.closed = closed.map((r) => ({ round_id: r.round_id, round_no: toInt(r.round_no), bid_name: str(r.bid_name), ledger_applied: !!r.ledger_applied }));
    if (pick_round_id) out.picked_bids = bidView(await listBids(db, pick_round_id));
    const led = await db.collection("auction_admin_ledger").find({}).sort({ created_at: -1 }).limit(100).toArray();
    out.ledger = led.map((x) => {
      const refund = !!x.refund_non_winners;
      const tba = toInt(x.total_bid_amount ?? x.total_amount ?? 0);
      const ta = toInt(x.total_amount);
      return {
        입찰번호: toInt(x.round_no), 입찰기일: str(x.bid_date), "입찰 내역": str(x.bid_name), "입찰 참가수": toInt(x.participants),
        "입찰금 총액": refund ? toInt(x.winner_amount) : tba, "낙찰금 수수료 총액": toInt(x.fee_amount), "국고 반영 총액": ta === 0 ? "-" : ta,
      };
    });
    return out;
  },

  async auction_open(ctx, { bid_name, affiliation }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const pending = await db.collection("auction_rounds").findOne({ status: "closed", ledger_applied: false });
    if (pending) fail("현재 진행되는 경매가 완료되지 않았습니다. (직전 경매의 장부/국고 반영을 먼저 완료해 주세요)");
    bid_name = str(bid_name).trim();
    affiliation = str(affiliation).trim();
    if (!bid_name) fail("입찰 내역(입찰 이름)을 입력해 주세요.");
    if (!affiliation) fail("소속을 입력해 주세요.");
    const st = await getState(db);
    if (st.status === "open" && st.current_round_id) {
      const cur = await col(db, "auction_rounds").get(st.current_round_id);
      if (cur && str(cur.status) === "open") fail("이미 진행 중인 경매가 있습니다. 먼저 마감해 주세요.");
    }
    const next = st.current_round_no + 1;
    const rid = await col(db, "auction_rounds").add({
      round_no: next, round_code: pad2(next), bid_name, affiliation, status: "open", opened_at: new Date(), closed_at: null, ledger_applied: false, created_at: new Date(),
    });
    await col(db, "config").set("auction_state", { current_round_no: next, current_round_id: rid, status: "open", updated_at: new Date() }, true);
    return { round_no: next };
  },

  async auction_close(ctx) {
    requireAdmin(ctx);
    const db = ctx.db;
    const open = await openRound(db);
    if (!open) fail("진행 중인 경매가 없습니다.");
    await col(db, "auction_rounds").set(open.round_id, { status: "closed", closed_at: new Date() }, true);
    await col(db, "config").set("auction_state", { current_round_id: "", status: "closed", updated_at: new Date() }, true);
    return {};
  },

  async auction_apply(ctx, { round_id, refund }) {
    requireAdmin(ctx);
    return await applyLedger(ctx.db, round_id, !!refund);
  },

  async auction_user_load(ctx) {
    requireStudent(ctx);
    const db = ctx.db;
    const open = await openRound(db);
    if (!open) return { open: null };
    const s = ctx.student;
    const prev = await col(db, "auction_bids").get(`${open.round_id}_${ctx.sid}`);
    return {
      open: {
        round_no: toInt(open.round_no), bid_name: str(open.bid_name), affiliation: str(open.affiliation), opened_text: fmtAuctionDt(open.opened_at),
      },
      me: { no: toInt(s.no), name: str(s.name) },
      prev: prev ? { amount: toInt(prev.amount), submitted_text: fmtAuctionDt(prev.submitted_at) } : null,
    };
  },

  async auction_bid(ctx, { amount }) {
    requireStudent(ctx);
    const db = ctx.db;
    amount = toInt(amount);
    if (amount < 0) fail("입찰 가격은 0 이상이어야 합니다.");
    const open = await openRound(db);
    if (!open) fail("진행 중인 경매가 없습니다.");
    const s = ctx.student;
    const bidId = `${open.round_id}_${ctx.sid}`;
    const ok = await col(db, "auction_bids").create(bidId, {
      round_id: open.round_id, round_no: toInt(open.round_no), student_id: ctx.sid, student_no: toInt(s.no), student_name: str(s.name),
      affiliation: str(open.affiliation), bid_name: str(open.bid_name), amount, submitted_at: new Date(), status: "submitting",
    });
    if (!ok) fail("이미 이번 경매에 입찰표를 제출했습니다.");
    const r = await col(db, "auction_rounds").get(open.round_id);
    if (!r || str(r.status) !== "open") {
      await col(db, "auction_bids").del(bidId);
      fail("경매가 마감되어 제출할 수 없습니다.");
    }
    const doc = await applyBalance(db, ctx.sid, -amount, { minBalance: amount });
    if (!doc) {
      await col(db, "auction_bids").del(bidId);
      fail("잔액이 부족하여 제출할 수 없습니다.");
    }
    await insertTx(db, { sid: ctx.sid, type: "withdraw", amount: -amount, balanceAfter: toInt(doc.balance), memo: `[경매 ${pad2(toInt(open.round_no))}회] ${str(open.bid_name)} 입찰 제출`, recorder: str(s.name) });
    await col(db, "auction_bids").update(bidId, { status: "submitted" });
    return {};
  },
};
