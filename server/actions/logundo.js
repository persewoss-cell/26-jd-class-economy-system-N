// 🧾 로그기록 묶음 되돌리기 — 함께 일어난 기록(학생 통장·국고·마트 장부·적금·투자 등)을 모두 지우고 원래대로
// 돈이 움직인 기록만 가능. 여러 단계가 얽힌 것(복권 당첨금·경매 반환/장부·적금 만기)은 막음
import { col } from "../db.js";
import { fail, requireAny, isAdminPin } from "../auth.js";
import { removeTx, removeTreasuryEntry, removeSalaryPayment } from "../core.js";
import { str, toInt, toDate } from "../../shared/format.js";

const LOGS = ["tab::🧾 로그기록"];
const NEAR = 15000; // 예전 기록: 통장 기록과 15초 안에 생긴 짝 기록을 찾음

function near(a, b) {
  const x = toDate(a);
  const y = toDate(b);
  return !!x && !!y && Math.abs(x.getTime() - y.getTime()) <= NEAR;
}
function txBlock(x) {
  const m = str(x.memo);
  if (str(x.type) === "maturity" || m.includes("적금 만기")) return "적금 만기 지급은 되돌릴 수 없어요.";
  if (m.includes("당첨금")) return "복권 당첨금 지급은 되돌릴 수 없어요.";
  if (m.includes("낙찰 실패") || m.includes("입찰금 반환")) return "경매 입찰금 반환은 되돌릴 수 없어요.";
  if (str(x.type) === "rollback" || str(x.type) === "revert" || m.includes("되돌리기")) return "예전 되돌리기 기록은 되돌릴 수 없어요.";
  return "";
}
function treBlock(x) {
  const a = str(x.actor).toLowerCase();
  if (a === "auction") return "경매 장부 반영은 되돌릴 수 없어요.";
  if (a === "lottery" || a === "lottery_admin") return "복권 장부·관리자 참여는 되돌릴 수 없어요.";
  return "";
}

// 통장 기록 하나에 딸린 다른 기록 찾기 (새 기록은 같은 묶음 번호, 예전 기록은 시간·학생으로)
async function sideDoc(db, c, tx, q, timeField) {
  if (tx.grp) {
    const d = await db.collection(c).findOne({ ...q, grp: tx.grp });
    if (d) return d;
  }
  const cands = await db.collection(c).find(q).toArray();
  return cands.find((d) => near(d[timeField], tx.created_at)) || null;
}

// 되돌리기 전에 미리 검사 (하나라도 안 되면 아무것도 바꾸지 않음) → 실행할 작업 목록
async function plan(db, tx) {
  const m = str(tx.memo);
  const sid = str(tx.student_id);
  const amt = toInt(tx.amount);
  const b = txBlock(tx);
  if (b) fail(b);
  if (str(tx.type) === "deposit" && m.startsWith("월급 ")) return { kind: "salary" };
  let mm = /^투자 매입\((.*)\)$/.exec(m);
  if (mm) {
    const led = await sideDoc(db, "invest_ledger", tx, { student_id: sid, product_name: mm[1], invest_amount: -amt }, "buy_at");
    if (led && led.redeemed) fail("이미 회수(지급)한 투자는 매입을 되돌릴 수 없어요. 회수부터 되돌려 주세요.");
    return { kind: "invest_buy", led };
  }
  mm = /^투자 회수\((.*)\)$/.exec(m);
  if (mm) {
    const cands = await db.collection("invest_ledger").find({ student_id: sid, product_name: mm[1], redeemed: true }).toArray();
    return { kind: "invest_redeem", led: cands.find((d) => near(d.redeemed_at, tx.created_at)) || null };
  }
  if (/^적금 가입/.test(m)) {
    const sv = await sideDoc(db, "savings", tx, { student_id: sid, principal: -amt }, "created_at");
    if (sv && str(sv.status) !== "running" && str(sv.status) !== "active") fail("이미 해지·만기된 적금은 가입을 되돌릴 수 없어요.");
    return { kind: "savings_join", sv };
  }
  if (/^적금 중도해지/.test(m)) {
    const cands = await db.collection("savings").find({ student_id: sid, status: "canceled" }).toArray();
    return { kind: "savings_cancel", sv: cands.find((d) => near(d.processed_at, tx.created_at)) || null };
  }
  mm = /^마트 구입\((.*)\)$/.exec(m);
  if (mm) {
    const ml = await sideDoc(db, "mart_ledger", tx, { student_id: sid, item: mm[1] }, "approved_at");
    return { kind: "mart", ml };
  }
  mm = /^복권 (\d+)회 \d+게임 구매$/.exec(m);
  if (mm) {
    const r = await db.collection("lottery_rounds").findOne({ round_no: toInt(mm[1]) });
    if (r && str(r.status) !== "open") fail("이미 마감된 복권의 구매는 되돌릴 수 없어요.");
    return { kind: "lottery_buy", round: r };
  }
  mm = /^\[경매 (\d+)회\].*입찰 제출$/.exec(m);
  if (mm) {
    const r = await db.collection("auction_rounds").findOne({ round_no: toInt(mm[1]) });
    if (r && str(r.status) !== "open") fail("이미 마감된 경매의 입찰은 되돌릴 수 없어요.");
    return { kind: "auction_bid", round: r };
  }
  const dr = await db.collection("deposit_requests").findOne({ tx_id: String(tx._id) });
  if (dr) return { kind: "deposit_req", dr };
  return { kind: "plain" };
}

async function apply(db, tx, p, names) {
  const sid = str(tx.student_id);
  if (p.kind === "salary") return (await removeSalaryPayment(db, tx, names[sid] || "", { dropPaylog: true })).removed;
  if (!(await removeTx(db, tx))) return false;
  if (p.kind === "invest_buy" && p.led) await db.collection("invest_ledger").deleteOne({ _id: p.led._id });
  if (p.kind === "invest_redeem" && p.led) {
    await db.collection("invest_ledger").updateOne({ _id: p.led._id }, {
      $set: { redeemed: false, redeemed_at: null },
      $unset: { sell_date_label: "", sell_price: "", sell_real_price: "", diff: "", real_diff: "", profit: "", redeem_amount: "", redeemed_label: "", redeemed_amount: "" },
    });
  }
  if (p.kind === "savings_join" && p.sv) await db.collection("savings").deleteOne({ _id: p.sv._id });
  if (p.kind === "savings_cancel" && p.sv) await col(db, "savings").update(String(p.sv._id), { status: "running", payout_amount: null, processed_at: null });
  if (p.kind === "mart" && p.ml) {
    await db.collection("mart_ledger").deleteOne({ _id: p.ml._id });
    if (p.ml.request_id) await col(db, "mart_requests").update(String(p.ml.request_id), { status: "pending", approved_at: null, approved_by: null });
  }
  if (p.kind === "lottery_buy" && p.round) {
    const ents = await db.collection("lottery_entries").find({ round_id: String(p.round._id), student_id: sid }).toArray();
    const mine = ents.filter((e) => (tx.grp && e.grp === tx.grp) || (!e.grp && near(e.submitted_at, tx.created_at)));
    if (mine.length) await db.collection("lottery_entries").deleteMany({ _id: { $in: mine.map((e) => e._id) } });
  }
  if (p.kind === "auction_bid" && p.round) await db.collection("auction_bids").deleteOne({ _id: `${p.round._id}_${sid}` });
  if (p.kind === "deposit_req") await col(db, "deposit_requests").update(String(p.dr._id), { status: "pending", processed_at: null, tx_id: null });
  return true;
}

export default {
  // refs: 화면 묶음의 통장(t:id)·국고(r:id) 기록. 새 기록은 같은 묶음 번호 전체로 넓혀서 빠짐없이 되돌림
  async log_undo(ctx, { refs, admin_pin }) {
    requireAny(ctx, LOGS, "이 탭은 관리자 전용입니다.");
    if (!isAdminPin(admin_pin)) fail("관리자 비밀번호가 틀립니다.");
    const db = ctx.db;
    const tIds = [];
    const rIds = [];
    for (const r of refs || []) {
      const s = str(r);
      if (s.startsWith("t:")) tIds.push(s.slice(2));
      else if (s.startsWith("r:")) rIds.push(s.slice(2));
    }
    let txs = tIds.length ? await db.collection("transactions").find({ _id: { $in: tIds } }).toArray() : [];
    let leds = rIds.length ? await db.collection("treasury_ledger").find({ _id: { $in: rIds } }).toArray() : [];
    // 같은 묶음 번호·일괄 번호를 가진 기록은 화면에 다 안 보여도 모두 포함
    const grps = [...new Set([...txs, ...leds].map((x) => x.grp).filter(Boolean))];
    const bats = [...new Set([...txs, ...leds].map((x) => x.batch_id).filter(Boolean))];
    if (grps.length || bats.length) {
      const q = { $or: [...(grps.length ? [{ grp: { $in: grps } }] : []), ...(bats.length ? [{ batch_id: { $in: bats } }] : [])] };
      const more = await db.collection("transactions").find(q).toArray();
      const moreL = await db.collection("treasury_ledger").find(q).toArray();
      const seen = new Set(txs.map((x) => String(x._id)));
      txs = txs.concat(more.filter((x) => !seen.has(String(x._id))));
      const seenL = new Set(leds.map((x) => String(x._id)));
      leds = leds.concat(moreL.filter((x) => !seenL.has(String(x._id))));
    }
    if (!txs.length && !leds.length) fail("이미 되돌렸거나 되돌릴 수 없는 기록이에요.");
    for (const l of leds) {
      const b = treBlock(l);
      if (b) fail(b);
    }
    // 1) 전부 검사 → 2) 실행
    const plans = [];
    for (const tx of txs) plans.push([tx, await plan(db, tx)]);
    const studs = await db.collection("students").find({ _id: { $in: [...new Set(txs.map((x) => str(x.student_id)))] } }, { projection: { name: 1 } }).toArray();
    const names = Object.fromEntries(studs.map((x) => [String(x._id), str(x.name)]));
    let n = 0;
    for (const [tx, p] of plans) if (await apply(db, tx, p, names)) n += 1;
    let t = 0;
    for (const l of leds) if (await removeTreasuryEntry(db, l)) t += 1;
    if (!n && !t) fail("이미 되돌린 기록이에요.");
    return { students: n, treasury: t };
  },
};
