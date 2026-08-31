import { getD1, getRuntimeEnv } from "../../db";
import type { SessionUser } from "../../packages/contracts/src";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const nowIso = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID()}`;

export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiOk<T>(data: T, requestId: string, init: ResponseInit = {}): Response { return json({ ok: true, data, requestId }, init); }
export function apiError(error: unknown, requestId: string): Response {
  const known = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_ERROR", "The server could not complete the request");
  if (!(error instanceof HttpError)) {
    console.error(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }));
    if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  }
  return json({ ok: false, error: { code: known.code, message: known.message, details: known.details }, requestId }, { status: known.status });
}

export function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get("cookie") ?? "";
  return Object.fromEntries(raw.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes); globalThis.crypto.getRandomValues(value); return base64Url(value);
}

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function sessionSecret(): string {
  const runtime = getRuntimeEnv();
  if (runtime.SESSION_SECRET) {
    if (runtime.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
    return runtime.SESSION_SECRET;
  }
  const origin = runtime.APP_ORIGIN ?? "";
  if (!origin || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return "low-stakes-local-session-secret-do-not-deploy";
  throw new Error("SESSION_SECRET is required outside local development");
}

async function privateHash(value: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256(left), sha256(right)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftDigest.length; index += 1) difference |= leftDigest.charCodeAt(index) ^ rightDigest.charCodeAt(index);
  return difference === 0;
}

export function validateOrigin(request: Request, allowBot = false): void {
  if (allowBot && request.headers.has("authorization")) return;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const configured = getRuntimeEnv().APP_ORIGIN;
  const expected = configured || new URL(request.url).origin;
  if (!origin || origin !== expected) throw new HttpError(403, "INVALID_ORIGIN", "Request origin was rejected");
}

export interface AuthSession {
  sessionId: string;
  csrfTokenHash: string;
  user: SessionUser;
}

export async function getSession(request: Request): Promise<AuthSession | null> {
  const token = parseCookies(request).ls_session;
  if (!token) return null;
  const tokenHash = await privateHash(token);
  const db = getD1();
  const row = await db.prepare(`
    SELECT s.id AS session_id, s.csrf_token_hash, s.expires_at, s.revoked_at,
           u.id, u.display_name, u.avatar_url, u.age_confirmed_at, u.is_development, u.status,
           COALESCE(w.balance, 0) AS balance
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN wallets w ON w.user_id = u.id
    WHERE s.token_hash = ? LIMIT 1
  `).bind(tokenHash).first<Record<string, string | number | null>>();
  if (!row || row.revoked_at || row.status !== "active" || new Date(String(row.expires_at)) <= new Date()) return null;
  const roleRows = await db.prepare(`SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`).bind(row.id).all<{ name: string }>();
  return {
    sessionId: String(row.session_id),
    csrfTokenHash: String(row.csrf_token_hash),
    user: {
      id: String(row.id), displayName: String(row.display_name), avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      balance: Number(row.balance), roles: roleRows.results.map((role) => role.name), ageConfirmed: Boolean(row.age_confirmed_at),
      isDevelopment: Boolean(row.is_development),
    },
  };
}

export async function requireSession(request: Request): Promise<AuthSession> {
  const session = await getSession(request);
  if (!session) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to continue");
  if (!session.user.ageConfirmed) throw new HttpError(403, "AGE_CONFIRMATION_REQUIRED", "Age and play-money confirmation is required");
  return session;
}

export async function requireCsrf(request: Request, session: AuthSession): Promise<void> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const token = request.headers.get("x-csrf-token");
  if (!token || await privateHash(token) !== session.csrfTokenHash) throw new HttpError(403, "CSRF_REJECTED", "Security token is missing or invalid");
}

export async function createSession(request: Request, userId: string): Promise<{ cookies: string[]; csrfToken: string }> {
  const db = getD1(); const token = randomToken(); const csrfToken = randomToken(24); const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
  await db.prepare(`INSERT INTO sessions (id,user_id,token_hash,csrf_token_hash,expires_at,ip_hash,user_agent,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(uid("ses"), userId, await privateHash(token), await privateHash(csrfToken), expiresAt, await privateHash(ip), (request.headers.get("user-agent") ?? "").slice(0, 300), createdAt, createdAt).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return { csrfToken, cookies: [
    `ls_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
    `ls_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=2592000${secure}`,
  ] };
}

export function applyCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers); for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function revokeSession(request: Request, session: AuthSession): Promise<string[]> {
  await getD1().prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(nowIso(), session.sessionId).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [`ls_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, `ls_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure}`];
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const db = getD1(); const now = new Date(); const current = await db.prepare("SELECT count, window_started_at FROM rate_limits WHERE key = ?").bind(key).first<{ count: number; window_started_at: string }>();
  if (!current || now.getTime() - new Date(current.window_started_at).getTime() >= windowSeconds * 1000) {
    await db.prepare("INSERT INTO rate_limits (key,count,window_started_at,expires_at) VALUES (?,1,?,?) ON CONFLICT(key) DO UPDATE SET count=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at")
      .bind(key, now.toISOString(), new Date(now.getTime() + windowSeconds * 1000).toISOString()).run(); return;
  }
  if (current.count >= limit) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please pause briefly.");
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
}

export async function requireIdempotency(request: Request, userId: string, route: string): Promise<{ key: string; replay: Response | null; requestHash: string }> {
  const key = request.headers.get("idempotency-key");
  if (!key || key.length < 8 || key.length > 100) throw new HttpError(400, "IDEMPOTENCY_REQUIRED", "A valid Idempotency-Key header is required");
  const clone = request.clone(); const body = await clone.text(); const requestHash = await sha256(`${request.method}:${route}:${body}`);
  const existing = await getD1().prepare("SELECT request_hash,response_status,response_json FROM idempotency_keys WHERE key = ? AND user_id = ? AND route = ?")
    .bind(key, userId, route).first<{ request_hash: string; response_status: number; response_json: string }>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different request");
    return { key, requestHash, replay: json(JSON.parse(existing.response_json), { status: existing.response_status, headers: { "x-idempotent-replay": "true" } }) };
  }
  return { key, requestHash, replay: null };
}

export async function saveIdempotentResult(input: { key: string; userId: string; route: string; requestHash: string; status: number; response: unknown }): Promise<void> {
  const at = nowIso(); await getD1().prepare("INSERT INTO idempotency_keys (key,user_id,route,request_hash,response_status,response_json,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(input.key, input.userId, input.route, input.requestHash, input.status, JSON.stringify(input.response), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), at).run();
}

export async function requireAdmin(session: AuthSession): Promise<void> {
  if (!session.user.roles.includes("admin")) throw new HttpError(403, "ADMIN_REQUIRED", "Administrator permission is required");
}

export async function requireBot(request: Request): Promise<void> {
  const expected = getRuntimeEnv().DISCORD_BOT_API_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || !await constantTimeEqual(supplied, expected)) throw new HttpError(401, "BOT_AUTH_REQUIRED", "Bot authentication failed");
}
