// 로그인 토큰 + 권한 계산
// - 관리자 비밀번호는 코드가 아니라 서버 환경변수(ADMIN_PIN)에만 둔다 (학생이 브라우저에서 볼 수 없음)
import crypto from "node:crypto";
import { col } from "./db.js";
import { str, toInt } from "../shared/format.js";

export const ADMIN_NAME = "관리자";
export const DEFAULT_CREDIT_SCORE = 50;
export const DEFAULT_CREDIT_GRADE = 5;

export function adminPin() {
  return String(process.env.ADMIN_PIN || "").trim();
}

export function isAdminPin(pin) {
  const ap = adminPin();
  return !!ap && String(pin || "").trim() === ap;
}

export function isAdminLogin(name, pin) {
  return String(name || "").trim() === ADMIN_NAME && isAdminPin(pin);
}

export function pinOk(pin) {
  return String(pin ?? "").length === 4;
}

function secret() {
  const s = String(process.env.SESSION_SECRET || "").trim();
  if (s) return s;
  // SESSION_SECRET을 따로 안 넣어도 동작하도록(DB주소+관리자PIN 기반 파생 키)
  return crypto
    .createHash("sha256")
    .update(`${process.env.MONGO_URI || ""}::${adminPin()}::class-economy`)
    .digest("hex");
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
    if (expect.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
    const json = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return json;
  } catch {
    return null;
  }
}

// 기존 fs_get_student_doc_by_name / fs_auth_student
export async function findStudentByName(db, name) {
  const nm = String(name || "").trim();
  if (!nm) return null;
  return await db.collection("students").findOne({ name: nm, is_active: true });
}

export async function authStudent(db, name, pin) {
  const doc = await findStudentByName(db, name);
  if (!doc) return null;
  if (str(doc.pin) !== String(pin)) return null;
  return doc;
}

export async function listRoles(db) {
  const docs = await col(db, "roles").find({});
  const roles = docs.map((r) => ({
    role_id: String(r._id),
    role_name: str(r.role_name),
    permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
  }));
  roles.sort((a, b) => (a.role_name < b.role_name ? -1 : a.role_name > b.role_name ? 1 : 0));
  return roles;
}

export async function permsForStudent(db, studentDoc) {
  const perms = new Set();
  if (!studentDoc) return perms;
  const rid = str(studentDoc.role_id);
  if (rid) {
    const roles = await listRoles(db);
    const r = roles.find((x) => x.role_id === rid);
    if (r) r.permissions.forEach((p) => perms.add(p));
  }
  const extra = Array.isArray(studentDoc.extra_permissions) ? studentDoc.extra_permissions : [];
  extra.forEach((p) => {
    const s = str(p).trim();
    if (s) perms.add(s);
  });
  return perms;
}

// checkPin=true: 앱을 새로 열 때(새로고침)만 비밀번호 변경 여부 확인
// (기존 앱도 새로고침 시점에만 저장된 이름/비번으로 다시 인증했음)
export async function buildCtx(db, token, { checkPin = false } = {}) {
  const ctx = { db, role: null, isAdmin: false, sid: "", name: "", student: null, perms: new Set() };
  const t = verifyToken(token);
  if (!t) return ctx;
  if (t.role === "admin") {
    ctx.role = "admin";
    ctx.isAdmin = true;
    ctx.name = ADMIN_NAME;
    ctx.perms = new Set(["admin_all"]);
    return ctx;
  }
  if (t.role === "student" && t.sid) {
    const doc = await db.collection("students").findOne({ _id: String(t.sid) });
    if (!doc || doc.is_active !== true) return ctx;
    // 비밀번호가 바뀌면 기존 로그인은 무효(재로그인 필요)
    if (checkPin && t.pv && t.pv !== pinVersion(doc.pin)) return ctx;
    ctx.role = "student";
    ctx.sid = String(doc._id);
    ctx.name = str(doc.name);
    ctx.student = doc;
    ctx.perms = await permsForStudent(db, doc);
  }
  return ctx;
}

export function pinVersion(pin) {
  return crypto.createHash("sha256").update(`pv:${str(pin)}`).digest("hex").slice(0, 10);
}

export function can(ctx, need) {
  return ctx.isAdmin || ctx.perms.has("admin_all") || ctx.perms.has(need);
}

export function hasTab(ctx, tab) {
  return ctx.isAdmin || ctx.perms.has(`tab::${tab}`);
}

export function hasAdminFeature(ctx, tab) {
  return ctx.isAdmin || ctx.perms.has(`admin::${tab}`);
}

// 기존 _get_recorder_label(True, login_name): 관리자 로그인이면 "관리자", 권한 받은 학생이면 "관리자(이름)"
export function adminRecorder(ctx) {
  if (ctx.isAdmin) return "관리자";
  if (ctx.name) return `관리자(${ctx.name})`;
  return "관리자";
}

export class ApiError extends Error {
  constructor(msg) {
    super(msg);
    this.userMessage = msg;
  }
}

export function fail(msg) {
  throw new ApiError(msg);
}

export function requireLogin(ctx) {
  if (!ctx.role) fail("로그인이 필요합니다.");
}

export function requireAdmin(ctx) {
  if (!ctx.isAdmin) fail("관리자 전용입니다.");
}

export function requireStudent(ctx) {
  if (ctx.role !== "student") fail("학생 로그인이 필요합니다.");
}

// 여러 조건 중 하나라도 맞으면 통과 (관리자는 항상 통과)
export function requireAny(ctx, checks, msg = "권한이 없습니다.") {
  if (ctx.isAdmin) return;
  for (const c of checks) {
    if (c.startsWith("tab::") || c.startsWith("admin::")) {
      if (ctx.perms.has(c)) return;
    } else if (ctx.perms.has(c)) return;
  }
  fail(msg);
}

export { toInt };
