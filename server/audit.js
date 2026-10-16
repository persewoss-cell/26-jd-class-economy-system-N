// 🧾 변경 기록(로그) — 돈이 움직이지 않는 관리 작업(주가·직업·계정·권한·템플릿·설정 변경)을 남김
// 각 동작이 성공한 뒤 api/index.js 에서 한 번에 기록 (동작 코드 안을 건드리지 않음)
// pre: 동작 전에 지워질 정보(이름 등)를 미리 읽어 둠 / msg: 남길 내용 { tab, memo, target }
import { col } from "./db.js";
import { adminRecorder } from "./auth.js";
import { str, toInt, toFloat } from "../shared/format.js";

const f2 = (v) => (toFloat(v, 0) || 0).toFixed(2);
async function stu(db, sid) {
  const s = await db.collection("students").findOne({ _id: String(sid) }, { projection: { no: 1, name: 1 } });
  return s ? `${toInt(s.no)}번 ${str(s.name)}` : "(삭제된 학생)";
}
async function stus(db, sids) {
  const list = [];
  for (const sid of (sids || []).map(String)) list.push(await stu(db, sid));
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} 외 ${list.length - 3}명` : list.join(", ");
}
const doc = (db, c, id) => (id ? db.collection(c).findOne({ _id: String(id) }) : null);
const prodName = async (db, pid) => str((await doc(db, "invest_products", pid))?.name) || "종목";
const T = { inv: "📈 투자", job: "💼 직업/월급", acc: "👥 계정 정보", perm: "⭐ 권한부여", bank: "💰입금/출금", tre: "🏛️ 국세청(국고)", stat: "📊 통계청", mart: "🛒마트", credit: "💳 신용등급", lot: "🍀 복권", auc: "🏷️ 경매" };
const TPL_KIND = { bank: [T.bank, "입출금 템플릿"], treasury: [T.tre, "국고 템플릿"], stats: [T.stat, "통계표 템플릿"], mart: [T.mart, "마트 템플릿"], jobs: [T.job, "직업"] };

export const AUDIT = {
  // ---------- 투자 ----------
  invest_price_update: {
    pre: async (db, a) => ({ p: await doc(db, "invest_products", a.product_id) }),
    msg: async (db, a, r, pre) => ({ tab: T.inv, target: str(pre.p?.name), memo: `주가 변동 반영: ${str(a.reason)} (실제주가 ${f2(pre.p?.real_price)} → ${f2(a.real_price)})` }),
  },
  invest_hist_update: {
    pre: async (db, a) => ({ h: await doc(db, "invest_price_history", a.id) }),
    msg: async (db, a, r, pre) => ({ tab: T.inv, target: await prodName(db, pre.h?.product_id), memo: `주가 기록 수정: '${str(pre.h?.reason)}' ${f2(pre.h?.real_price_after)} → '${str(a.reason)}' ${f2(a.real_price)}${r.repriced ? ` (진행 중 투자 ${r.repriced}건 매입주가 정정)` : ""}` }),
  },
  invest_hist_delete: {
    pre: async (db, a) => ({ h: await doc(db, "invest_price_history", a.id) }),
    msg: async (db, a, r, pre) => ({ tab: T.inv, target: await prodName(db, pre.h?.product_id), memo: `주가 기록 삭제: '${str(pre.h?.reason)}' (실제주가 ${f2(pre.h?.real_price_after)})${r.repriced ? ` (진행 중 투자 ${r.repriced}건 매입주가 정정)` : ""}` }),
  },
  invest_product_save: { msg: async (db, a) => ({ tab: T.inv, target: str(a.name), memo: `종목 ${a.product_id ? "수정" : "추가"}: ${str(a.name)} (범위 ${f2(a.min_price)}~${f2(a.max_price)}, 실제주가 ${f2(a.real_price)}, 주가 1당 손익 ${f2(a.point_profit_pct)}%)` }) },
  invest_product_delete: {
    pre: async (db, a) => ({ n: await prodName(db, a.product_id) }),
    msg: async (db, a, r, pre) => ({ tab: T.inv, target: pre.n, memo: `종목 삭제: ${pre.n}` }),
  },
  // ---------- 직업/월급 ----------
  job_assign: {
    pre: async (db, a) => ({ j: str((await doc(db, "job_salary", a.job_id))?.job) }),
    msg: async (db, a, r, pre) => (r.changed ? { tab: T.job, target: await stus(db, a.sids), memo: `직업 ${a.op === "fire" ? "해제" : "고용"}: ${pre.j}` } : null),
  },
  job_save: { msg: async (db, a) => ({ tab: T.job, target: "전체", memo: `직업 ${a.job_id ? "수정" : "추가"}: ${str(a.job)} (월급 ${toInt(a.salary)}, 학생 수 ${toInt(a.student_count)})` }) },
  job_delete: {
    pre: async (db, a) => ({ j: str((await doc(db, "job_salary", a.job_id))?.job) }),
    msg: async (db, a, r, pre) => ({ tab: T.job, target: "전체", memo: `직업 삭제: ${pre.j}` }),
  },
  jobs_bulk_save: { msg: async (db, a) => ({ tab: T.job, target: "전체", memo: `직업 엑셀 일괄 반영 (${(a.rows || []).length}행${a.wipe ? ", 기존 직업 지우고 덮어쓰기" : ""})` }) },
  salary_cfg_save: { msg: async (db, a) => ({ tab: T.job, target: "전체", memo: `월급 공제 설정 변경 (세금 ${toFloat(a.tax_percent, 0)}%, 책상 임대료 ${toInt(a.desk_rent)}, 전기세 ${toInt(a.electric_fee)}, 건강보험 ${toInt(a.health_fee)})` }) },
  payroll_cfg_save: { msg: async (db, a) => ({ tab: T.job, target: "전체", memo: `월급 지급 설정 변경 (지급일 ${toInt(a.pay_day) || 25}일, 자동지급 ${a.auto_enabled ? "켬" : "끔"})` }) },
  payroll_fix: { msg: async (db, a, r) => (r.none ? null : { tab: T.job, target: "전체", memo: `${a.mode === "all" ? "이번 달 월급 전체 회수" : "월급 중복 지급 회수"} (${toInt(r.fixed)}건, 기록 삭제)` }) },
  payroll_repay_set: { msg: async (db, a) => ({ tab: T.job, target: "전체", memo: a.skip ? "회수 후 이번 달 월급 다시 지급 안 함" : `회수 후 다시 지급일 지정: ${toInt(a.day)}일` }) },
  // ---------- 계정/권한 ----------
  sidebar_admin: { msg: async (db, a, r) => ({ tab: T.acc, target: str(a.name), memo: a.op === "create" ? `계정 생성 (번호 ${toInt(r.new_no)})` : a.op === "pin" ? "비밀번호 변경(관리자)" : "계정 삭제" }) },
  change_pin_student: { msg: async () => ({ tab: T.acc, memo: "비밀번호 변경(본인)" }), self: true },
  acc_bulk: { msg: async (db, a, r) => ({ tab: T.acc, target: "전체", memo: `계정 엑셀 일괄 반영 (새로 ${toInt(r.created)}명, 수정 ${toInt(r.updated)}명, 건너뜀 ${toInt(r.skipped)}건)` }) },
  acc_delete: {
    pre: async (db, a) => ({ n: await stus(db, a.sids) }),
    msg: async (db, a, r, pre) => ({ tab: T.acc, target: pre.n, memo: "계정 삭제" }),
  },
  acc_save_edits: { msg: async (db, a) => ({ tab: T.acc, target: await stus(db, (a.rows || []).map((x) => x.sid)), memo: `계정 정보 수정 (번호·이름·비밀번호, ${(a.rows || []).length}명)` }) },
  perm_apply: { msg: async (db, a) => ({ tab: T.perm, target: await stus(db, a.sids), memo: `권한 ${a.op === "grant" ? "부여" : "회수"}: ${a.kind === "admin" ? `${str(a.tab)}(관리자)` : str(a.tab)}` }) },
  perm_bulk: { msg: async (db, a, r) => ({ tab: T.perm, target: "전체", memo: `권한 엑셀 일괄 부여 (${toInt(r.applied)}명${a.overwrite ? ", 기존 권한 지우고 덮어쓰기" : ""})` }) },
  // ---------- 템플릿 ----------
  template_save: { msg: async (db, a) => ({ tab: T.bank, memo: `입출금 템플릿 ${a.template_id ? "수정" : "추가"}: ${a.category ? `[${str(a.category)}] ` : ""}${str(a.base_label)} (${a.kind === "withdraw" ? "출금" : "입금"} ${toInt(a.amount)})` }) },
  template_delete: {
    pre: async (db, a) => ({ t: str((await doc(db, "templates", a.template_id))?.label) }),
    msg: async (db, a, r, pre) => ({ tab: T.bank, memo: `입출금 템플릿 삭제: ${pre.t}` }),
  },
  templates_bulk_save: { msg: async (db, a) => ({ tab: T.bank, memo: `입출금 템플릿 엑셀 일괄 반영 (${(a.rows || []).length}행${a.delete_old ? ", 덮어쓰기" : ""})` }) },
  tre_tpl_save: { msg: async (db, a) => ({ tab: T.tre, memo: `국고 템플릿 ${a.template_id ? "수정" : "추가"}: ${str(a.label)} (${a.kind === "expense" ? "세출" : "세입"} ${toInt(a.amount)})` }) },
  tre_tpl_delete: {
    pre: async (db, a) => ({ t: str((await doc(db, "treasury_templates", a.template_id))?.label) }),
    msg: async (db, a, r, pre) => ({ tab: T.tre, memo: `국고 템플릿 삭제: ${pre.t}` }),
  },
  tre_tpl_bulk: { msg: async (db, a) => ({ tab: T.tre, memo: `국고 템플릿 엑셀 일괄 반영 (${(a.rows || []).length}행${a.overwrite ? ", 덮어쓰기" : ""})` }) },
  stat_tpl_save: { msg: async (db, a) => ({ tab: T.stat, memo: `통계표 템플릿 ${a.template_id ? "수정" : "추가"}: ${str(a.label)}` }) },
  stat_tpl_delete: {
    pre: async (db, a) => ({ t: str((await doc(db, "stat_templates", a.template_id))?.label) }),
    msg: async (db, a, r, pre) => ({ tab: T.stat, memo: `통계표 템플릿 삭제: ${pre.t}` }),
  },
  stat_tpl_bulk: { msg: async (db, a, r) => ({ tab: T.stat, memo: `통계표 템플릿 엑셀 일괄 반영 (추가 ${toInt(r.added)}건${a.overwrite ? ", 덮어쓰기" : ""})` }) },
  mart_tpl_save: { msg: async (db, a) => ({ tab: T.mart, memo: `마트 템플릿 ${a.template_id ? "수정" : "추가"}: ${str(a.item)} (${toInt(a.price)}드림)` }) },
  mart_tpl_delete: {
    pre: async (db, a) => ({ t: str((await doc(db, "mart_templates", a.template_id))?.item) }),
    msg: async (db, a, r, pre) => ({ tab: T.mart, memo: `마트 템플릿 삭제: ${pre.t}` }),
  },
  mart_tpl_bulk: { msg: async (db, a, r) => ({ tab: T.mart, memo: `마트 템플릿 엑셀 일괄 반영 (${toInt(r.n)}건${a.overwrite ? ", 덮어쓰기" : ""})` }) },
  tpl_reorder: { msg: async (db, a) => (TPL_KIND[a.kind] ? { tab: TPL_KIND[a.kind][0], memo: `${TPL_KIND[a.kind][1]} 순서 변경` } : null) },
  // ---------- 설정 ----------
  mart_limit_save: { msg: async (db, a) => ({ tab: T.mart, target: "전체", memo: `마트 주간 구입 가능 개수 변경: ${toInt(a.weekly_limit)}개` }) },
  credit_cfg_save: { msg: async (db, a) => ({ tab: T.credit, target: "전체", memo: `신용점수 설정 변경 (기본 ${toInt(a.base)}점, O ${toInt(a.o)} / X ${toInt(a.x)} / △ ${toInt(a.tri)})` }) },
  lottery_open: { msg: async (db, a, r) => ({ tab: T.lot, target: "전체", memo: `복권 ${toInt(r.round_no)}회 개시 (가격 ${toInt(a.ticket_price)}, 세금 ${toInt(a.tax_rate)}%, 1등 ${toInt(a.first_pct)}% / 2등 ${toInt(a.second_pct)}%, 3등 ${toInt(a.third_prize)})` }) },
  lottery_close: { msg: async () => ({ tab: T.lot, target: "전체", memo: "복권 마감" }) },
  auction_open: { msg: async (db, a, r) => ({ tab: T.auc, target: "전체", memo: `경매 개시${r.round_no ? ` ${toInt(r.round_no)}회` : ""}: ${str(a.bid_name)} (${str(a.affiliation)})` }) },
  auction_close: { msg: async () => ({ tab: T.auc, target: "전체", memo: "경매 마감" }) },
};

export async function auditPre(ctx, action, args) {
  const a = AUDIT[action];
  if (!a || !a.pre) return null;
  try {
    return await a.pre(ctx.db, args || {});
  } catch {
    return null;
  }
}

// 기록 실패가 원래 동작을 막지 않도록 조용히 처리
export async function auditWrite(ctx, action, args, result, pre) {
  const a = AUDIT[action];
  if (!a) return;
  try {
    const m = await a.msg(ctx.db, args || {}, result || {}, pre || {});
    if (!m) return;
    const who = ctx.isAdmin ? "관리자" : a.self ? str(ctx.name) : adminRecorder(ctx);
    const target = a.self ? (ctx.student ? `${toInt(ctx.student.no)}번 ${str(ctx.student.name)}` : str(ctx.name)) : str(m.target);
    await col(ctx.db, "audit_log").add({ action, tab: m.tab, memo: m.memo, target, recorder: who, created_at: new Date() });
  } catch (e) {
    console.error("audit failed", action, e && e.message);
  }
}
