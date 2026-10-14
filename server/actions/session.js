// 로그인 / 사이드바(비밀번호 변경, 계정 생성·PIN변경·삭제) / 학생 상단 요약
import { col } from "../db.js";
import {
  ADMIN_NAME, isAdminLogin, isAdminPin, pinOk, signToken, authStudent, findStudentByName,
  fail, requireLogin, pinVersion, DEFAULT_CREDIT_SCORE, DEFAULT_CREDIT_GRADE,
} from "../auth.js";
import {
  activeStudents, loadRoleLookup, roleNameFor, investSummaryFor, calcCredit,
} from "../core.js";
import { str, toInt } from "../../shared/format.js";

function userInfo(ctx) {
  if (ctx.isAdmin) return { role: "admin", name: ADMIN_NAME, sid: "", perms: ["admin_all"], invest_enabled: true };
  const s = ctx.student || {};
  return {
    role: "student",
    name: str(s.name),
    sid: ctx.sid,
    no: toInt(s.no),
    perms: [...ctx.perms],
    invest_enabled: s.invest_enabled === undefined || s.invest_enabled === null ? true : !!s.invest_enabled,
  };
}

export default {
  async login(ctx, { name, pin }) {
    const db = ctx.db;
    name = str(name).trim();
    pin = str(pin).trim();
    if (!name) fail("이름을 입력해 주세요.");
    if (isAdminLogin(name, pin)) {
      return { token: signToken({ role: "admin" }), user: { role: "admin", name: ADMIN_NAME, sid: "", perms: ["admin_all"], invest_enabled: true } };
    }
    if (!pinOk(pin)) fail("학생 비밀번호는 4자리여야 해요.");
    const doc = await authStudent(db, name, pin);
    if (!doc) fail("이름 또는 비밀번호가 틀립니다.");
    const token = signToken({ role: "student", sid: String(doc._id), pv: pinVersion(doc.pin) });
    return { token, user: { role: "student", name: str(doc.name), sid: String(doc._id) } };
  },

  async check_admin_pin(ctx, { pin }) {
    return { valid: isAdminPin(pin) };
  },

  async session(ctx) {
    if (!ctx.role) return { user: null };
    return { user: userInfo(ctx) };
  },

  async change_pin_student(ctx, { name, old_pin, new_pin }) {
    name = str(name).trim();
    old_pin = str(old_pin).trim();
    new_pin = str(new_pin).trim();
    if (!name) fail("이름이 필요합니다.");
    if (!pinOk(old_pin)) fail("기존 비밀번호는 4자리여야 합니다.");
    if (!pinOk(new_pin)) fail("새 비밀번호는 4자리여야 합니다.");
    const doc = await authStudent(ctx.db, name, old_pin);
    if (!doc) fail("이름 또는 기존 비밀번호가 틀립니다.");
    await col(ctx.db, "students").update(doc._id, { pin: String(new_pin) });
    return {};
  },

  // 사이드바 [관리자] 계정 생성 / PIN 변경 / 삭제 (관리자 비밀번호로 확인)
  async sidebar_admin(ctx, { admin_pin, op, name, pin }) {
    const db = ctx.db;
    admin_pin = str(admin_pin).trim();
    name = str(name).trim();
    pin = str(pin).trim();
    if (!admin_pin) fail("관리자 비밀번호를 입력해 주세요.");
    if (!isAdminPin(admin_pin)) fail("관리자 비밀번호가 틀립니다.");
    if (op === "create") {
      if (!name) fail("이름을 입력해 주세요.");
      if (!pinOk(pin)) fail("비밀번호는 4자리여야 해요. (예: ab7@)");
      if (await findStudentByName(db, name)) fail("이미 존재하는 계정입니다.");
      let maxNo = 0;
      for (const x of await activeStudents(db)) {
        const n = toInt(x.no);
        if (n > maxNo) maxNo = n;
      }
      const newNo = maxNo + 1;
      await col(db, "students").add({
        no: newNo, name, pin, balance: 0, credit_score: DEFAULT_CREDIT_SCORE, credit_grade: DEFAULT_CREDIT_GRADE,
        is_active: true, role_id: "", io_enabled: true, invest_enabled: true, created_at: new Date(),
      });
      return { new_no: newNo };
    }
    if (op === "pin") {
      if (!name) fail("이름을 입력해 주세요.");
      if (!pinOk(pin)) fail("새 비밀번호는 4자리여야 해요.");
      const doc = await findStudentByName(db, name);
      if (!doc) fail("해당 이름의 계정을 찾지 못했습니다.");
      await col(db, "students").update(doc._id, { pin: String(pin) });
      return {};
    }
    if (op === "delete") {
      if (!name) fail("삭제할 이름(계정)을 입력해 주세요.");
      if (!pinOk(pin)) fail("비밀번호는 4자리여야 해요.");
      const doc = await findStudentByName(db, name);
      if (!doc) fail("해당 이름의 계정을 찾지 못했습니다.");
      await col(db, "students").update(doc._id, { is_active: false });
      return {};
    }
    fail("잘못된 요청입니다.");
  },

  // 학생 모드 탭 위 요약(_render_user_bank_header)
  async user_header(ctx) {
    requireLogin(ctx);
    if (ctx.isAdmin) return { header: null };
    const db = ctx.db;
    const sid = ctx.sid;
    const s = await col(db, "students").get(sid);
    const bal = toInt(s && s.balance);
    const sav = await db.collection("savings").find({ student_id: sid }).toArray();
    let svTotal = 0;
    for (const x of sav) {
      const stt = str(x.status).toLowerCase().trim();
      if (stt === "active" || stt === "running") svTotal += toInt(x.principal);
    }
    const inv = await investSummaryFor(db, sid);
    const lookup = await loadRoleLookup(db);
    const roleName = roleNameFor(s, sid, lookup);
    const credit = await calcCredit(db, sid);
    return {
      header: {
        asset_total: bal + svTotal + toInt(inv.evalTotal),
        balance: bal,
        savings_total: svTotal,
        inv_principal_total: inv.prinTotal,
        inv_principal_text: inv.prinText,
        inv_eval_total: inv.evalTotal,
        inv_eval_text: inv.evalText,
        role_name: roleName || "없음",
        credit_score: credit.score,
        credit_grade: credit.grade,
      },
    };
  },
};
