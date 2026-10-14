// Vercel 서버리스 함수 하나로 모든 API를 처리 (무료 요금제의 함수 개수 제한 회피)
// 요청: POST /api  { action: "이름", args: {...} }  헤더 Authorization: Bearer <토큰>
import { getDb } from "../server/db.js";
import { buildCtx, ApiError } from "../server/auth.js";
import { runAutoPayouts } from "../server/core.js";
import { ACTIONS } from "../server/actions/index.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const db = await getDb();

    // Vercel 크론(하루 1번) 또는 수동 호출: 자동 처리만 실행
    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      if (url.searchParams.get("action") === "system_tick") {
        await runAutoPayouts(db, { force: true });
        return res.status(200).json({ ok: true });
      }
      return res.status(200).json({ ok: true, service: "class-economy-api" });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
    const body = await readBody(req);
    const action = String(body.action || "");
    const args = body.args || {};
    const fn = ACTIONS[action];
    if (!fn) return res.status(400).json({ ok: false, error: `알 수 없는 요청: ${action}` });

    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const ctx = await buildCtx(db, token, { checkPin: action === "session" });

    // 자동 적금 만기/월급 지급: 로그인·새로고침(세션 확인) 때만 시도 (탭을 누를 때마다 하지 않아 빠름)
    if (action === "session" || action === "login") await runAutoPayouts(db);

    const data = await fn(ctx, args);
    return res.status(200).json({ ok: true, ...(data || {}) });
  } catch (e) {
    if (e instanceof ApiError) return res.status(200).json({ ok: false, error: e.userMessage });
    console.error(e);
    return res.status(200).json({ ok: false, error: `서버 오류: ${e && e.message ? e.message : e}` });
  }
}
