// 🏛️ 국세청(국고) + 📊 통계청 + 💳 신용등급
import { col, newId, encKey } from "../db.js";
import { fail, requireLogin, requireAny, requireAdmin, isAdminPin, adminRecorder, can, hasTab } from "../auth.js";
import {
  treasuryTx, getCreditCfg, listStatSubmissions, manualDeltaMap, calcCredit, activeStudents,
} from "../core.js";
import { str, toInt, ior, toDate, fmtKrDatetime, fmtKrDatetimeNoYear, fmtMd, kstTodayIso, scoreToGrade } from "../../shared/format.js";

const TRE_WRITE = ["tab::🏛️ 국세청(국고)"];
const TRE_VIEW = ["tab::🏛️ 국세청(국고)", "treasury_read", "treasury_write"];
const STATS = ["tab::📊 통계청"];

async function listTreasuryTemplates(db) {
  const docs = await col(db, "treasury_templates").find({});
  const out = [];
  for (const t of docs) {
    const label = str(t.label).trim();
    if (!label) continue;
    out.push({ template_id: String(t._id), label, kind: str(t.kind || "income"), amount: toInt(t.amount), order: ior(t.order, 999999) });
  }
  out.sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out;
}

async function upsertTreTemplate(db, { template_id, label, kind, amount, order }) {
  label = str(label).trim();
  kind = str(kind || "income").trim();
  amount = toInt(amount);
  order = ior(order, 999999);
  if (!label) fail("라벨(내역)이 필요합니다.");
  if (kind !== "income" && kind !== "expense") fail("kind는 income/expense 중 하나여야 합니다.");
  if (amount <= 0) fail("금액은 0보다 커야 합니다.");
  const id = template_id ? String(template_id) : newId();
  await col(db, "treasury_templates").set(id, { label, kind, amount, order, updated_at: new Date() }, true);
}

async function listStatTemplates(db) {
  const docs = await col(db, "stat_templates").find({});
  const out = docs.filter((t) => t.label).map((t) => ({ template_id: String(t._id), label: str(t.label), order: ior(t.order, 999999) }));
  out.sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out;
}

async function stuRows(db) {
  const rows = [];
  for (const x of await activeStudents(db)) {
    const nm = str(x.name).trim();
    if (!nm) continue;
    rows.push({ student_id: x.student_id, no: x.no === undefined || x.no === null ? 999999 : ior(x.no, 999999), name: nm });
  }
  rows.sort((a, b) => a.no - b.no || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

function subForClient(s) {
  return { submission_id: s.submission_id, label: s.label, date_display: s.date_display || fmtMd(s.created_at), statuses: s.statuses };
}

export default {
  // ---------------- 국세청 ----------------
  async treasury_load(ctx) {
    requireAny(ctx, TRE_VIEW, "접근 권한이 없습니다.");
    const db = ctx.db;
    let st = await col(db, "treasury").get("state");
    if (!st) {
      await col(db, "treasury").set("state", { balance: 0, updated_at: new Date() }, true);
      st = { balance: 0 };
    }
    const led = await db.collection("treasury_ledger").find({}).sort({ created_at: -1 }).limit(300).toArray();
    const rows = led.map((x) => ({
      내역: str(x.memo),
      세입: toInt(x.income),
      세출: toInt(x.expense),
      총액: toInt(x.balance_after),
      "날짜-시간": x.created_at ? fmtKrDatetime(x.created_at) : "",
      기록자: str(x.recorder),
    }));
    return { balance: toInt(st.balance), rows, templates: await listTreasuryTemplates(db), writable: ctx.isAdmin || hasTab(ctx, "🏛️ 국세청(국고)") };
  },

  async treasury_add(ctx, { memo, income, expense }) {
    requireAny(ctx, TRE_WRITE, "관리자 전용입니다.");
    await treasuryTx(ctx.db, { memo, income, expense, actor: "treasury", recorder: adminRecorder(ctx) });
    return {};
  },

  async tre_tpl_save(ctx, args) {
    requireAny(ctx, TRE_WRITE, "관리자 전용입니다.");
    await upsertTreTemplate(ctx.db, args);
    return {};
  },

  async tre_tpl_delete(ctx, { template_id }) {
    requireAny(ctx, TRE_WRITE, "관리자 전용입니다.");
    if (!template_id) fail("template_id가 없습니다.");
    await col(ctx.db, "treasury_templates").del(template_id);
    return {};
  },

  async tre_tpl_bulk(ctx, { rows, overwrite }) {
    requireAny(ctx, TRE_WRITE, "관리자 전용입니다.");
    const db = ctx.db;
    if (!rows || !rows.length) fail("먼저 올바른 엑셀을 업로드하세요.");
    if (overwrite) await db.collection("treasury_templates").deleteMany({});
    const map = { 세입: "income", 세출: "expense" };
    for (const r of rows) {
      try {
        await upsertTreTemplate(db, { template_id: "", label: str(r["라벨(내역)"]).trim(), kind: map[str(r["종류"]).trim()] || "income", amount: toInt(r["금액"]), order: ior(r["순서"], 999999) });
      } catch (e) {
        fail(`국고 템플릿 엑셀 저장 실패: ${e.userMessage || e.message}`);
      }
    }
    return {};
  },

  // ---------------- 통계청 ----------------
  async stats_load(ctx) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    const db = ctx.db;
    const subs = await listStatSubmissions(db, 50);
    return { students: await stuRows(db), subs: subs.map(subForClient), templates: await listStatTemplates(db) };
  },

  async stat_add(ctx, { label }) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    const db = ctx.db;
    label = str(label).trim();
    if (!label) fail("내역을 입력해 주세요.");
    const studs = await stuRows(db);
    const statuses = {};
    studs.forEach((s) => (statuses[encKey(s.student_id)] = "X"));
    const today = kstTodayIso();
    await col(db, "stat_submissions").add({
      label,
      date_iso: today,
      date_display: fmtMd(new Date(`${today}T00:00:00+09:00`)),
      statuses,
      created_at: new Date(),
    });
    return {};
  },

  async stat_save(ctx, { edited }) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    const db = ctx.db;
    const subs = await listStatSubmissions(db, 50);
    const ids = subs.map((s) => s.submission_id);
    if (!ids.length) fail("저장할 제출물이 없습니다.");
    const studs = await stuRows(db);
    for (const sub of ids) {
      const cur = (edited || {})[sub] || {};
      const merged = {};
      for (const s of studs) {
        const v = str(cur[s.student_id] || "X");
        merged[encKey(s.student_id)] = ["X", "O", "△"].includes(v) ? v : "X";
      }
      await db.collection("stat_submissions").updateOne({ _id: sub }, { $set: { statuses: merged } }, { upsert: true });
    }
    return { count: ids.length };
  },

  async stat_delete(ctx, { ids, admin_pin, reset }) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    const db = ctx.db;
    let targets = (ids || []).map(String).filter(Boolean);
    if (reset) {
      if (str(admin_pin).trim() === "" || !isAdminPin(admin_pin)) fail("관리자 비밀번호가 올바르지 않습니다.");
      targets = (await listStatSubmissions(db, 50)).map((s) => s.submission_id);
    } else if (!targets.length) fail("삭제할 항목을 하나 이상 체크해 주세요.");
    let n = 0;
    for (const id of targets) {
      await col(db, "stat_submissions").del(id);
      n += 1;
    }
    return { n };
  },

  async stat_tpl_save(ctx, { template_id, label, order }) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    const db = ctx.db;
    label = str(label).trim();
    order = ior(order, 1);
    if (!label) fail("내역(label)이 필요합니다.");
    if (order <= 0) fail("순서는 1 이상이어야 합니다.");
    const rows = (await col(db, "stat_templates").find({})).map((t) => ({ template_id: String(t._id), label: str(t.label), order: ior(t.order, 999999) }));
    const isUpdate = !!(template_id && rows.some((r) => r.template_id === template_id));
    const target = isUpdate ? template_id : newId();
    const others = rows.filter((r) => r.template_id !== target);
    others.sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const idx = Math.min(Math.max(1, order) - 1, others.length);
    others.splice(idx, 0, { template_id: target, label });
    let i = 1;
    for (const r of others) {
      const payload = { label: str(r.label), order: i };
      if (r.template_id === target && !isUpdate) payload.created_at = new Date();
      await col(db, "stat_templates").set(r.template_id, payload, true);
      i += 1;
    }
    return {};
  },

  async stat_tpl_delete(ctx, { template_id }) {
    requireAny(ctx, STATS, "접근 권한이 없습니다.");
    if (!template_id) fail("template_id가 필요합니다.");
    await col(ctx.db, "stat_templates").del(template_id);
    return {};
  },

  // ---------------- 신용등급 ----------------
  async credit_load(ctx) {
    requireLogin(ctx);
    const db = ctx.db;
    const access = ctx.isAdmin || hasTab(ctx, "💳 신용등급");
    if (!access && !can(ctx, "credit_write")) fail("접근 권한이 없습니다.");
    const cfg = await getCreditCfg(db);
    const out = { cfg, access };
    if (!access) return out;
    const studs = await stuRows(db);
    const subs = await listStatSubmissions(db, 60);
    const md = await manualDeltaMap(db);
    out.students = studs;
    out.subs = subs.map(subForClient);
    out.manual = Object.fromEntries(studs.map((s) => [s.student_id, toInt(md[s.student_id])]));
    if (ctx.isAdmin) {
      const adj = await db.collection("credit_adjustments").find({}).sort({ created_at: -1 }).limit(300).toArray();
      out.adjustments = adj.map((r) => ({
        일시: r.created_at ? fmtKrDatetimeNoYear(r.created_at) : "",
        대상: `${toInt(r.student_no)}번 ${str(r.student_name)}`,
        점수기록: `${toInt(r.delta) >= 0 ? "+" : ""}${toInt(r.delta)}점 (결과: ${toInt(r.score_after)}점/${toInt(r.grade_after)}등급)`,
        기록자: str(r.recorder) || "관리자",
      }));
    }
    return out;
  },

  async credit_cfg_save(ctx, { base, o, x, tri }) {
    requireLogin(ctx);
    if (!(ctx.isAdmin || hasTab(ctx, "💳 신용등급") || can(ctx, "credit_write"))) fail("접근 권한이 없습니다.");
    const pick = (v, d) => (v === null || v === undefined || v === "" ? d : toInt(v, d));
    await col(ctx.db, "config").set("credit_scoring", { base: pick(base, 50), o: pick(o, 1), x: pick(x, -3), tri: pick(tri, 0), updated_at: new Date() }, true);
    return {};
  },

  async credit_adjust(ctx, { student_id, sign, pts }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const s = await col(db, "students").get(student_id);
    if (!s) fail("학생을 찾지 못했어요.");
    pts = Math.max(1, Math.min(100, toInt(pts, 1)));
    const signed = sign === "-" ? -pts : pts;
    const before = await calcCredit(db, student_id);
    let after = before.score + signed;
    if (after > 100) after = 100;
    if (after < 0) after = 0;
    const g = scoreToGrade(after);
    await col(db, "credit_adjustments").add({
      student_id: String(student_id), student_no: toInt(s.no), student_name: str(s.name), delta: signed,
      score_before: before.score, score_after: after, grade_after: g, recorder: "관리자", created_at: new Date(),
    });
    await col(db, "students").set(String(student_id), { credit_score: after, credit_grade: g, updated_at: new Date() }, true);
    return { signed };
  },
};
