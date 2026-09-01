import { getD1, getRuntimeEnv } from "../../db";
import { HttpError, applyCookies, createSession, nowIso, parseCookies, randomToken, sha256, uid } from "./runtime";

function oauthCookie(name: string, value: string, request: Request, maxAge = 600): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/api/v1/auth/discord; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function startDiscordOAuth(request: Request): Promise<Response> {
  const env = getRuntimeEnv(); if (!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI) throw new HttpError(503, "DISCORD_NOT_CONFIGURED", "Discord sign-in has not been configured yet");
  const url = new URL(request.url); if (url.searchParams.get("ageConfirmed") !== "true") throw new HttpError(400, "AGE_CONFIRMATION_REQUIRED", "Confirm the age and play-money notice before signing in");
  const state = randomToken(24); const verifier = randomToken(48); const challenge = await sha256(verifier);
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID); authorize.searchParams.set("response_type", "code"); authorize.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI);
  authorize.searchParams.set("scope", env.DISCORD_ALLOWED_GUILD_ID ? "identify guilds" : "identify"); authorize.searchParams.set("state", state); authorize.searchParams.set("code_challenge", challenge); authorize.searchParams.set("code_challenge_method", "S256");
  const headers = new Headers({ location: authorize.toString(), "cache-control": "no-store" });
  headers.append("set-cookie", oauthCookie("ls_oauth_state", state, request)); headers.append("set-cookie", oauthCookie("ls_oauth_verifier", verifier, request)); headers.append("set-cookie", oauthCookie("ls_oauth_age", "1", request));
  return new Response(null, { status: 302, headers });
}

export async function finishDiscordOAuth(request: Request): Promise<Response> {
  const env = getRuntimeEnv(); const url = new URL(request.url); const cookies = parseCookies(request); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!state || !code || state !== cookies.ls_oauth_state || !cookies.ls_oauth_verifier || cookies.ls_oauth_age !== "1") throw new HttpError(400, "OAUTH_STATE_INVALID", "Discord sign-in could not be verified. Please try again.");
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) throw new HttpError(503, "DISCORD_NOT_CONFIGURED", "Discord sign-in has not been configured yet");
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.DISCORD_REDIRECT_URI, client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, code_verifier: cookies.ls_oauth_verifier }) });
  if (!tokenResponse.ok) throw new HttpError(401, "OAUTH_EXCHANGE_FAILED", "Discord declined the sign-in request");
  const token = await tokenResponse.json() as { access_token: string; expires_in: number; scope: string; token_type: string };
  const profileResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { authorization: `${token.token_type} ${token.access_token}` } });
  if (!profileResponse.ok) throw new HttpError(401, "DISCORD_PROFILE_FAILED", "Discord account details could not be loaded");
  const profile = await profileResponse.json() as { id: string; username: string; global_name: string | null; avatar: string | null };
  const allowlist = (env.DISCORD_USER_ALLOWLIST ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (allowlist.length && !allowlist.includes(profile.id)) throw new HttpError(403, "DISCORD_NOT_ALLOWED", "This Discord account is not on the approved list");
  if (env.DISCORD_ALLOWED_GUILD_ID) {
    const guildResponse = await fetch("https://discord.com/api/v10/users/@me/guilds", { headers: { authorization: `${token.token_type} ${token.access_token}` } });
    if (!guildResponse.ok) throw new HttpError(403, "GUILD_CHECK_FAILED", "Discord server membership could not be verified");
    const guilds = await guildResponse.json() as Array<{ id: string }>;
    if (!guilds.some((guild) => guild.id === env.DISCORD_ALLOWED_GUILD_ID)) throw new HttpError(403, "GUILD_MEMBERSHIP_REQUIRED", "Join the approved Discord server before signing in");
  }
  const db = getD1(); const existing = await db.prepare("SELECT user_id FROM discord_identities WHERE discord_user_id=?").bind(profile.id).first<{ user_id: string }>();
  const userId = existing?.user_id ?? uid("usr"); const at = nowIso(); const displayName = (profile.global_name || profile.username).slice(0, 40); const avatarUrl = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.webp?size=128` : null;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO users (id,display_name,avatar_url,age_confirmed_at,status,is_development,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,'active',0,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).bind(userId, displayName, avatarUrl, at, at, at, at),
    db.prepare(`INSERT INTO discord_identities (user_id,discord_user_id,username,global_name,avatar_hash,scopes,token_expires_at,last_authenticated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,global_name=excluded.global_name,avatar_hash=excluded.avatar_hash,scopes=excluded.scopes,token_expires_at=excluded.token_expires_at,last_authenticated_at=excluded.last_authenticated_at`).bind(userId, profile.id, profile.username, profile.global_name, profile.avatar, token.scope, new Date(Date.now() + token.expires_in * 1000).toISOString(), at),
  ];
  if (!existing) {
    const startingBalance = Number(env.STARTING_BALANCE ?? 10_000);
    statements.push(db.prepare("INSERT INTO wallets (user_id,balance,version,updated_at) VALUES (?,?,0,?)").bind(userId, startingBalance, at));
    statements.push(db.prepare("INSERT INTO wallet_ledger (id,user_id,amount,reason,balance_before,balance_after,idempotency_key,created_at) VALUES (?,?,?,'STARTING_BALANCE',0,?,?,?)").bind(uid("led"), userId, startingBalance, startingBalance, `signup:${userId}`, at));
    statements.push(db.prepare("INSERT INTO statistics (user_id,updated_at) VALUES (?,?)").bind(userId, at));
  }
  await db.batch(statements);
  const session = await createSession(request, userId); const clear = [oauthCookie("ls_oauth_state", "", request, 0), oauthCookie("ls_oauth_verifier", "", request, 0), oauthCookie("ls_oauth_age", "", request, 0)];
  const response = new Response(null, { status: 302, headers: { location: "/lobby", "cache-control": "no-store" } }); return applyCookies(response, [...session.cookies, ...clear]);
}

const devUsers: Record<string, { name: string; admin?: boolean }> = {
  chris: { name: "Chris", admin: true }, maya: { name: "Maya" }, arthur: { name: "Arthur" },
};

export function developmentSignInEnabled(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) || getRuntimeEnv().DEV_AUTH_BYPASS === "true";
}

export async function developmentSignIn(request: Request, persona: string, ageConfirmed: boolean): Promise<Response> {
  if (!developmentSignInEnabled(request)) throw new HttpError(404, "NOT_FOUND", "Not found");
  if (!ageConfirmed) throw new HttpError(400, "AGE_CONFIRMATION_REQUIRED", "Confirm the age and play-money notice before using development access");
  const chosen = devUsers[persona]; if (!chosen) throw new HttpError(400, "UNKNOWN_DEV_USER", "Unknown development user");
  const db = getD1(); const userId = `dev_${persona}`; const at = nowIso(); const starting = Number(getRuntimeEnv().STARTING_BALANCE ?? 10_000);
  const existing = await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first(); const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO users (id,display_name,age_confirmed_at,status,is_development,last_seen_at,created_at,updated_at) VALUES (?,?,?,'active',1,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,age_confirmed_at=excluded.age_confirmed_at,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).bind(userId, chosen.name, at, at, at, at),
  ];
  if (!existing) {
    statements.push(db.prepare("INSERT INTO wallets (user_id,balance,version,updated_at) VALUES (?,?,0,?)").bind(userId, starting, at));
    statements.push(db.prepare("INSERT INTO wallet_ledger (id,user_id,amount,reason,balance_before,balance_after,idempotency_key,created_at) VALUES (?,?,?,'DEV_SEED',0,?,?,?)").bind(uid("led"), userId, starting, starting, `dev-seed:${userId}`, at));
    statements.push(db.prepare("INSERT INTO statistics (user_id,updated_at) VALUES (?,?)").bind(userId, at));
  }
  if (chosen.admin) {
    statements.push(db.prepare("INSERT INTO roles (id,name,permissions_json) VALUES ('role_admin','admin','[\"admin:*\"]') ON CONFLICT(name) DO NOTHING"));
    statements.push(db.prepare("INSERT INTO user_roles (user_id,role_id,granted_at,granted_by) VALUES (?,'role_admin',?,'development-seed') ON CONFLICT(user_id,role_id) DO NOTHING").bind(userId, at));
  }
  await db.batch(statements); const session = await createSession(request, userId); return applyCookies(new Response(null, { status: 204 }), session.cookies);
}
