// 템플릿 순서 바꾸기 (드롭다운의 ▲▼) — 보이는 순서대로 1, 2, 3… 다시 매김
import { fail, requireAny } from "../auth.js";
import { str } from "../../shared/format.js";

const KINDS = {
  bank: { coll: "templates", perm: ["admin::🏦 내 통장"] },
  treasury: { coll: "treasury_templates", perm: ["tab::🏛️ 국세청(국고)", "treasury_read", "treasury_write"] },
  stats: { coll: "stat_templates", perm: ["tab::📊 통계청", "stats_write"] },
  mart: { coll: "mart_templates", perm: ["admin::🛒마트"] },
  jobs: { coll: "job_salary", perm: ["tab::💼 직업/월급", "jobs_write"] },
};

export default {
  async tpl_reorder(ctx, { kind, ids }) {
    const k = KINDS[str(kind)];
    if (!k) fail("잘못된 요청입니다.");
    requireAny(ctx, k.perm, "접근 권한이 없습니다.");
    ids = (ids || []).map(String).filter(Boolean);
    if (!ids.length || new Set(ids).size !== ids.length) fail("순서 정보가 올바르지 않습니다.");
    const c = ctx.db.collection(k.coll);
    const found = await c.countDocuments({ _id: { $in: ids } });
    if (found !== ids.length) fail("목록이 바뀌었어요. 화면을 새로고침한 뒤 다시 시도해 주세요.");
    await c.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i + 1, updated_at: new Date() } } } })));
    return {};
  },
};
