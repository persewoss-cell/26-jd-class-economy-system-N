// ⭐ 권한부여 + 👥 계정 정보
import { col } from "../db.js";
import { fail, requireAny, requireAdmin, pinOk, DEFAULT_CREDIT_SCORE, DEFAULT_CREDIT_GRADE } from "../auth.js";
import { activeStudents } from "../core.js";
import { str, toInt } from "../../shared/format.js";

export const ALL_TABS = [
  "🏦 내 통장", "🔎 개별조회", "💼 직업/월급", "🏛️ 국세청(국고)", "📊 통계청", "💳 신용등급", "🏦 은행(적금)",
  "📈 투자", "⭐ 권한부여", "👥 계정 정보", "🛒마트", "🏷️ 경매", "🍀 복권", "🧾 로그기록",
];

const TAB_BUNDLE = {
  "🏛️ 국세청(국고)": ["treasury_read", "treasury_write"],
  "📊 통계청": ["stats_write"],
  "💳 신용등급": ["credit_write"],
  "💼 직업/월급": ["jobs_write"],
  "🏦 은행(적금)": ["bank_read", "bank_write"],
  "🗓️ 일정": ["schedule_read", "schedule_write"],
};

const EXCLUDED = ["👥 계정 정보", "🏦 내 통장", "🏦 은행(적금)", "📈 투자", "🛒마트", "🏷️ 경매", "🍀 복권"];
export const ALLOWED_TAB_OPTIONS = ALL_TABS.filter((t) => !EXCLUDED.includes(t));
export const ADMIN_OPTION_LABELS = ["💰입금/출금(관리자)", "🏦 은행(적금)(관리자)", "📈 투자(관리자)", "🛒마트(관리자)"];

function keysFor(kind, tab) {
  const base = [kind === "admin" ? `admin::${tab}` : `tab::${tab}`, ...(TAB_BUNDLE[tab] || [])];
  return [...new Set(base.map(String).filter(Boolean))];
}

async function updateExtra(db, sid, { add = [], remove = [], clearAll = false } = {}) {
  const s = await col(db, "students").get(sid);
  let cur = Array.isArray(s && s.extra_permissions) ? s.extra_permissions.map(String).filter((v) => v.trim()) : [];
  let set = new Set(clearAll ? [] : cur);
  add.forEach((k) => set.add(String(k)));
  remove.forEach((k) => set.delete(String(k)));
  await col(db, "students").update(sid, { extra_permissions: [...set].sort() });
}

function normLabel(v) {
  return [...str(v)].filter((ch) => /[\p{L}\p{N}]/u.test(ch) || ch === "(" || ch === ")").join("").trim().toLowerCase();
}

const PERM = ["tab::⭐ 권한부여"];

export default {
  async perm_load(ctx) {
    requireAny(ctx, PERM, "권한이 없는 사용자입니다.");
    const studs = await activeStudents(ctx.db);
    const list = studs.map((x) => ({
      sid: x.student_id,
      no: toInt(x.no),
      name: str(x.name),
      extra: Array.isArray(x.extra_permissions) ? x.extra_permissions.map(String).filter((v) => v.trim()) : [],
    }));
    list.sort((a, b) => (a.no || 9999) - (b.no || 9999) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { students: list, allowed_tabs: ALLOWED_TAB_OPTIONS, admin_options: ADMIN_OPTION_LABELS };
  },

  async perm_apply(ctx, { kind, tab, sids, op }) {
    requireAny(ctx, PERM, "권한이 없는 사용자입니다.");
    sids = (sids || []).map(String);
    if (!sids.length) fail("먼저 학생을 선택해 주세요.");
    const keys = keysFor(kind, tab);
    let n = 0;
    for (const sid of sids) {
      if (op === "grant") await updateExtra(ctx.db, sid, { add: keys });
      else await updateExtra(ctx.db, sid, { remove: keys });
      n += 1;
    }
    return { n };
  },

  async perm_revoke_all(ctx) {
    requireAny(ctx, PERM, "권한이 없는 사용자입니다.");
    const studs = await activeStudents(ctx.db);
    for (const s of studs) await col(ctx.db, "students").update(s.student_id, { extra_permissions: [] });
    return { n: studs.length };
  },

  async perm_bulk(ctx, { rows, overwrite }) {
    requireAny(ctx, PERM, "권한이 없는 사용자입니다.");
    const db = ctx.db;
    const tabAlias = {};
    ALLOWED_TAB_OPTIONS.forEach((t) => (tabAlias[normLabel(t)] = t));
    Object.assign(tabAlias, {
      [normLabel("개별조회")]: "🔎 개별조회",
      [normLabel("직업/월급")]: "💼 직업/월급",
      [normLabel("국세청(국고)")]: "🏛️ 국세청(국고)",
      [normLabel("통계청")]: "📊 통계청",
      [normLabel("신용등급")]: "💳 신용등급",
      [normLabel("일정")]: "🗓️ 일정",
    });
    const adminAlias = {
      [normLabel("💰입금/출금(관리자)")]: "🏦 내 통장",
      [normLabel("입금/출금(관리자)")]: "🏦 내 통장",
      [normLabel("🏦 은행(적금)(관리자)")]: "🏦 은행(적금)",
      [normLabel("은행(적금)(관리자)")]: "🏦 은행(적금)",
      [normLabel("📈 투자(관리자)")]: "📈 투자",
      [normLabel("투자(관리자)")]: "📈 투자",
      [normLabel("🛒마트(관리자)")]: "🛒마트",
      [normLabel("마트(관리자)")]: "🛒마트",
    };
    const active = await activeStudents(db);
    const byNoName = {};
    active.forEach((r) => (byNoName[`${toInt(r.no)}|${str(r.name).trim()}`] = r.student_id));
    if (overwrite) for (const r of active) await updateExtra(db, r.student_id, { clearAll: true });
    let applied = 0;
    const skipped = [];
    for (const row of rows || []) {
      const noRaw = row["번호"];
      const no = Number(noRaw);
      if (noRaw === null || noRaw === undefined || noRaw === "" || !Number.isFinite(no)) {
        skipped.push("번호 누락/형식 오류");
        continue;
      }
      const nm = str(row["이름"]).trim();
      const sid = byNoName[`${Math.trunc(no)}|${nm}`];
      if (!sid) {
        skipped.push(`대상 없음: ${Math.trunc(no)} ${nm}`);
        continue;
      }
      const tabRaw = str(row["추가 탭(tab::)"]).trim();
      const adminRaw = str(row["관리자 기능(admin::)"]).trim();
      const add = [];
      if (tabRaw) {
        const t = tabAlias[normLabel(tabRaw)];
        if (t) add.push(...keysFor("tab", t));
        else skipped.push(`추가 탭 인식 실패: ${tabRaw}`);
      }
      if (adminRaw) {
        const t = adminAlias[normLabel(adminRaw)];
        if (t) add.push(...keysFor("admin", t));
        else skipped.push(`관리자 기능 인식 실패: ${adminRaw}`);
      }
      if (!add.length) continue;
      await updateExtra(db, sid, { add });
      applied += 1;
    }
    return { applied, skipped };
  },

  // ---------------- 👥 계정 정보 ----------------
  async acc_load(ctx) {
    requireAdmin(ctx);
    const studs = await activeStudents(ctx.db);
    const rows = studs.map((x) => ({ sid: x.student_id, no: x.no === undefined || x.no === null ? 999999 : toInt(x.no, 999999), name: str(x.name), pin: str(x.pin) }));
    rows.sort((a, b) => a.no - b.no || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { rows };
  },

  async acc_bulk(ctx, { rows }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const byNo = {};
    const byName = {};
    for (const x of await activeStudents(db)) {
      if (typeof x.no === "number" && Number.isFinite(x.no)) byNo[Math.trunc(x.no)] = x.student_id;
      const nm = str(x.name).trim();
      if (nm) byName[nm] = x.student_id;
    }
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const truthy = (v) => {
      if (v === undefined || v === null || v === "") return true; // 컬럼 없으면 기본 True
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      return String(v).length > 0; // 파이썬 bool("문자")와 동일
    };
    for (const r of rows || []) {
      const no = Number(r["번호"]);
      if (r["번호"] === null || r["번호"] === undefined || r["번호"] === "" || !Number.isFinite(no)) {
        skipped += 1;
        continue;
      }
      const name = str(r["이름"]).trim();
      const pin = str(r["비밀번호"]).trim();
      if (!name || !pinOk(pin)) {
        skipped += 1;
        continue;
      }
      const payload = {
        no: Math.trunc(no), name, pin, is_active: true,
        io_enabled: truthy(r["입출금활성화"]), invest_enabled: truthy(r["투자활성화"]),
      };
      const n = Math.trunc(no);
      if (byNo[n]) {
        await col(db, "students").update(byNo[n], payload);
        updated += 1;
      } else if (byName[name]) {
        await col(db, "students").update(byName[name], payload);
        updated += 1;
      } else {
        await col(db, "students").add({ ...payload, balance: 0, credit_score: DEFAULT_CREDIT_SCORE, credit_grade: DEFAULT_CREDIT_GRADE, role_id: "", created_at: new Date() });
        created += 1;
      }
    }
    return { created, updated, skipped };
  },

  async acc_delete(ctx, { sids }) {
    requireAdmin(ctx);
    for (const sid of (sids || []).map(String)) await col(ctx.db, "students").update(sid, { is_active: false });
    return {};
  },

  // (요청 반영) 표에서 고친 번호/이름/비밀번호 저장
  async acc_save_edits(ctx, { rows }) {
    requireAdmin(ctx);
    const db = ctx.db;
    const errs = [];
    let changed = 0;
    for (const r of rows || []) {
      const sid = String(r.sid || "");
      if (!sid) continue;
      const name = str(r.name).trim();
      const pin = str(r.pin).trim();
      const no = Number(r.no);
      if (!name) { errs.push(`이름이 비어 있는 행이 있습니다.`); continue; }
      if (!pinOk(pin)) { errs.push(`${name}: 비밀번호는 4자리여야 합니다.`); continue; }
      if (!Number.isFinite(no)) { errs.push(`${name}: 번호가 올바르지 않습니다.`); continue; }
      const dup = await db.collection("students").findOne({ name, is_active: true, _id: { $ne: sid } });
      if (dup) { errs.push(`${name}: 같은 이름의 계정이 이미 있습니다.`); continue; }
      await col(db, "students").update(sid, { no: Math.trunc(no), name, pin });
      changed += 1;
    }
    return { changed, errors: errs };
  },
};
