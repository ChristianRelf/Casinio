import { ZodError, z } from "zod";
import { getD1 } from "../../../../db";
import { developmentSignIn, finishDiscordOAuth, startDiscordOAuth } from "../../../../lib/server/oauth";
import { HttpError, apiError, apiOk, applyCookies, enforceRateLimit, getSession, json, requireAdmin, requireBot, requireCsrf, requireIdempotency, requireSession, revokeSession, saveIdempotentResult, uid, validateOrigin } from "../../../../lib/server/runtime";
import { addChat, adminAdjustWallet, adminSetUserStatus, closeTable, createInvite, createTable, dailyRefill, getEvents, getLedger, getTableState, getUserOverview, joinWithInvite, leaderboard, leaveTable, listTables, markReady, placeBet, reconnectTable, releaseSeat, roundHistory, submitAction, takeSeat, updateTableConfig, validateInvite } from "../../../../lib/server/table-service";
import type { BlackjackAction } from "../../../../packages/game-core/src";

const bodyJson = async (request: { json(): Promise<unknown> }) => {
  try { return await request.json(); } catch { throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON"); }
};

async function idempotentMutation(request: Request, requestId: string, userId: string, route: string, operation: (key: string) => Promise<unknown>) {
  const idem = await requireIdempotency(request, userId, route); if (idem.replay) return idem.replay;
  const data = await operation(idem.key); const payload = { ok: true, data, requestId };
  await saveIdempotentResult({ key: idem.key, userId, route, requestHash: idem.requestHash, status: 200, response: payload }); return json(payload);
}

async function handle(request: Request): Promise<Response> {
  const requestId = uid("req"); const url = new URL(request.url); const route = url.pathname.replace(/^\/api\/v1\/?/, "").replace(/\/$/, "");
  try {
    if (route === "health") return apiOk({ status: "ok", service: "low-stakes-web", time: new Date().toISOString() }, requestId);
    if (route === "readiness") { await getD1().prepare("SELECT 1 AS ready").first(); return apiOk({ status: "ready", database: "connected" }, requestId); }
    if (route === "auth/discord" && request.method === "GET") return startDiscordOAuth(request);
    if (route === "auth/discord/callback" && request.method === "GET") return finishDiscordOAuth(request);
    if (route === "auth/dev" && request.method === "POST") { validateOrigin(request); const input = z.object({ persona: z.enum(["chris", "maya", "arthur"]) }).parse(await bodyJson(request)); return developmentSignIn(request, input.persona); }
    if (route === "auth/session" && request.method === "GET") { const session = await getSession(request); return apiOk(session ? { user: session.user, csrfToken: (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)ls_csrf=([^;]+)/)?.[1] ?? null } : null, requestId); }

    if (route.startsWith("bot/")) {
      await requireBot(request);
      if (route === "bot/tables" && request.method === "POST") {
        const input = z.object({ discordUserId: z.string().min(3), name: z.string().min(2).max(40), minBet: z.number().int().optional(), maxBet: z.number().int().optional(), maxSeats: z.number().int().optional() }).parse(await bodyJson(request.clone()));
        const row = await getD1().prepare(`SELECT u.id,u.display_name,u.avatar_url,w.balance FROM discord_identities d JOIN users u ON u.id=d.user_id JOIN wallets w ON w.user_id=u.id WHERE d.discord_user_id=?`).bind(input.discordUserId).first<Record<string, string | number | null>>();
        if (!row) throw new HttpError(404, "DISCORD_ACCOUNT_NOT_LINKED", "That Discord member must sign in to the web app first");
        return idempotentMutation(request, requestId, String(row.id), route, () => createTable({ id: String(row.id), displayName: String(row.display_name), avatarUrl: row.avatar_url ? String(row.avatar_url) : null, balance: Number(row.balance), roles: [], ageConfirmed: true, isDevelopment: false }, input));
      }
      const botInvite = route.match(/^bot\/invites\/([^/]+)$/);
      if (botInvite && request.method === "GET") return apiOk(await validateInvite(botInvite[1]), requestId);
      const botStatus = route.match(/^bot\/tables\/([^/]+)\/status$/);
      if (botStatus && request.method === "GET") {
        const discordUserId = url.searchParams.get("discordUserId");
        if (!discordUserId) throw new HttpError(400, "DISCORD_USER_REQUIRED", "Discord user ID is required");
        const permitted = await getD1().prepare(`SELECT 1 AS permitted FROM discord_identities d JOIN table_memberships m ON m.user_id=d.user_id WHERE d.discord_user_id=? AND m.table_id=? AND m.connection_status!='left'`).bind(discordUserId, botStatus[1]).first();
        if (!permitted) throw new HttpError(403, "TABLE_ACCESS_DENIED", "Join this private table before requesting its status");
        const row = await getD1().prepare(`SELECT t.id,t.name,t.game_type,t.status,t.visibility,t.dealer_mode,t.max_seats,t.min_bet,t.max_bet,t.current_round_id,t.state_version,t.updated_at,u.display_name AS owner_display_name,(SELECT COUNT(*) FROM seats s WHERE s.table_id=t.id AND s.user_id IS NOT NULL) AS seated_count,(SELECT COUNT(*) FROM table_memberships m WHERE m.table_id=t.id AND m.role='spectator' AND m.connection_status='connected') AS spectator_count FROM tables t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?`).bind(botStatus[1]).first();
        if (!row) throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found"); return apiOk(row, requestId);
      }
      const botClose = route.match(/^bot\/tables\/([^/]+)\/close$/);
      if (botClose && request.method === "POST") {
        const input = z.object({ discordUserId: z.string().min(3) }).parse(await bodyJson(request));
        const table = await getD1().prepare(`SELECT t.owner_user_id,d.discord_user_id FROM tables t LEFT JOIN discord_identities d ON d.user_id=t.owner_user_id WHERE t.id=?`).bind(botClose[1]).first<{ owner_user_id: string; discord_user_id: string | null }>();
        if (!table) throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");
        if (table.discord_user_id !== input.discordUserId) throw new HttpError(403, "OWNER_REQUIRED", "Only the Discord member who owns the table can close it");
        return apiOk(await closeTable(botClose[1], table.owner_user_id), requestId);
      }
      const botLink = route.match(/^bot\/tables\/([^/]+)\/discord-link$/);
      if (botLink && request.method === "POST") {
        const input = z.object({ guildId: z.string().min(3), channelId: z.string().min(3), messageId: z.string().min(3).nullable(), discordUserId: z.string().min(3) }).parse(await bodyJson(request));
        const owner = await getD1().prepare(`SELECT t.status,t.state_version,t.current_round_id,(SELECT COUNT(*) FROM seats s WHERE s.table_id=t.id AND s.user_id IS NOT NULL) AS seated_count FROM tables t JOIN discord_identities d ON d.user_id=t.owner_user_id WHERE t.id=? AND d.discord_user_id=?`).bind(botLink[1], input.discordUserId).first<Record<string, string | number | null>>();
        if (!owner) throw new HttpError(403, "OWNER_REQUIRED", "Only the table owner can attach a Discord channel");
        const at = new Date().toISOString();
        await getD1().prepare(`INSERT INTO discord_table_links (table_id,guild_id,channel_id,message_id,created_by_discord_user_id,last_announced_version,last_status,last_round_id,last_seated_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(table_id) DO UPDATE SET guild_id=excluded.guild_id,channel_id=excluded.channel_id,message_id=excluded.message_id,last_announced_version=excluded.last_announced_version,last_status=excluded.last_status,last_round_id=excluded.last_round_id,last_seated_count=excluded.last_seated_count,updated_at=excluded.updated_at`)
          .bind(botLink[1], input.guildId, input.channelId, input.messageId, input.discordUserId, Number(owner.state_version), String(owner.status), owner.current_round_id, Number(owner.seated_count), at, at).run();
        return apiOk({ linked: true }, requestId);
      }
      if (route === "bot/table-links" && request.method === "GET") {
        const rows = await getD1().prepare(`SELECT l.table_id,l.guild_id,l.channel_id,l.message_id,l.last_announced_version,l.last_status,l.last_round_id,l.last_seated_count,t.name,t.status,t.state_version,t.current_round_id,t.min_bet,t.max_bet,t.max_seats,u.display_name AS owner_display_name,(SELECT COUNT(*) FROM seats s WHERE s.table_id=t.id AND s.user_id IS NOT NULL) AS seated_count FROM discord_table_links l JOIN tables t ON t.id=l.table_id JOIN users u ON u.id=t.owner_user_id WHERE t.status!='closed' ORDER BY l.updated_at`).all();
        return apiOk(rows.results, requestId);
      }
      const botLinkAck = route.match(/^bot\/tables\/([^/]+)\/discord-link\/ack$/);
      if (botLinkAck && request.method === "POST") {
        const input = z.object({ stateVersion: z.number().int().nonnegative(), status: z.string().min(2).max(20), roundId: z.string().nullable(), seatedCount: z.number().int().nonnegative() }).parse(await bodyJson(request));
        await getD1().prepare("UPDATE discord_table_links SET last_announced_version=MAX(last_announced_version,?),last_status=?,last_round_id=?,last_seated_count=?,updated_at=? WHERE table_id=?").bind(input.stateVersion, input.status, input.roundId, input.seatedCount, new Date().toISOString(), botLinkAck[1]).run();
        return apiOk({ acknowledged: true }, requestId);
      }
      const botUser = route.match(/^bot\/users\/([^/]+)\/(balance|stats)$/);
      if (botUser && request.method === "GET") { const row = await getD1().prepare("SELECT user_id FROM discord_identities WHERE discord_user_id=?").bind(botUser[1]).first<{ user_id: string }>(); if (!row) throw new HttpError(404, "USER_NOT_FOUND", "Linked casino account not found"); const overview = await getUserOverview(row.user_id); return apiOk(botUser[2] === "balance" ? overview.wallet : overview.stats, requestId); }
      if (route === "bot/leaderboard" && request.method === "GET") return apiOk(await leaderboard(), requestId);
      throw new HttpError(404, "NOT_FOUND", "Bot endpoint not found");
    }

    const session = await requireSession(request); validateOrigin(request);
    if (request.method !== "GET" && request.method !== "HEAD") await requireCsrf(request, session);

    if (route === "auth/logout" && request.method === "POST") return applyCookies(apiOk({ signedOut: true }, requestId), await revokeSession(request, session));
    if (route === "me" && request.method === "GET") return apiOk({ user: session.user, ...(await getUserOverview(session.user.id)) }, requestId);
    if (route === "me/ledger" && request.method === "GET") return apiOk(await getLedger(session.user.id, Number(url.searchParams.get("limit") ?? 100)), requestId);
    if (route === "me/refill" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, (key) => dailyRefill(session.user.id, key));
    if (route === "leaderboard" && request.method === "GET") return apiOk(await leaderboard(), requestId);

    if (route === "tables" && request.method === "GET") return apiOk(await listTables(session.user.id), requestId);
    if (route === "tables" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async () => createTable(session.user, await bodyJson(request)));
    if (route === "tables/join" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async () => { await enforceRateLimit(`invite:${session.user.id}`, 20, 600); const input = z.object({ code: z.string().min(4).max(20) }).parse(await bodyJson(request)); return joinWithInvite(session.user.id, input.code); });

    const inviteValidation = route.match(/^invites\/([^/]+)$/);
    if (inviteValidation && request.method === "GET") { await enforceRateLimit(`invite:${session.user.id}`, 20, 600); return apiOk(await validateInvite(inviteValidation[1]), requestId); }

    const tableMatch = route.match(/^tables\/([^/]+)$/);
    if (tableMatch && request.method === "GET") return apiOk(await getTableState(tableMatch[1], session.user.id), requestId);
    const tableId = route.match(/^tables\/([^/]+)\/(.+)$/)?.[1]; const actionRoute = route.match(/^tables\/([^/]+)\/(.+)$/)?.[2];
    if (tableId && actionRoute === "public-state" && request.method === "GET") { const data = await getTableState(tableId, session.user.id); return apiOk({ table: data.table, people: data.people, publicState: data.publicState, serverTime: data.serverTime }, requestId); }
    if (tableId && actionRoute === "private-state" && request.method === "GET") { const data = await getTableState(tableId, session.user.id); return apiOk({ membership: data.membership, privateState: data.privateState }, requestId); }
    if (tableId && actionRoute === "stream" && request.method === "GET") {
      let cursor = Number(url.searchParams.get("since") ?? request.headers.get("last-event-id") ?? 0); let cancelled = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode("retry: 800\n\n"));
          try {
            for (let tick = 0; tick < 24 && !cancelled; tick += 1) {
              const events = await getEvents(tableId, session.user.id, cursor);
              for (const item of events) {
                cursor = Math.max(cursor, item.version);
                controller.enqueue(encoder.encode(`id: ${item.version}\nevent: table-event\ndata: ${JSON.stringify(item)}\n\n`));
              }
              if (!events.length && tick % 5 === 0) controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ tableId, version: cursor, timestamp: new Date().toISOString() })}\n\n`));
              if (tick < 23) await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
          } catch (error) {
            if (!cancelled) controller.enqueue(encoder.encode(`event: stream-error\ndata: ${JSON.stringify({ requestId })}\n\n`));
            console.error(JSON.stringify({ level: "warn", requestId, event: "realtime_stream_error", message: error instanceof Error ? error.message : String(error) }));
          } finally { if (!cancelled) controller.close(); }
        },
        cancel() { cancelled = true; },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
    }
    if (tableId && actionRoute === "history" && request.method === "GET") return apiOk(await roundHistory(tableId, session.user.id), requestId);
    if (tableId && actionRoute === "seat" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async () => { const input = z.object({ seatNumber: z.number().int().min(1).max(7) }).parse(await bodyJson(request)); return takeSeat(tableId, session.user.id, input.seatNumber); });
    if (tableId && actionRoute === "release-seat" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, () => releaseSeat(tableId, session.user.id));
    if (tableId && actionRoute === "reconnect" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, () => reconnectTable(tableId, session.user.id));
    if (tableId && actionRoute === "leave" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, () => leaveTable(tableId, session.user.id));
    if (tableId && actionRoute === "bet" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async (key) => { const input = z.object({ amount: z.number().int() }).parse(await bodyJson(request)); return placeBet(tableId, session.user.id, input.amount, key); });
    if (tableId && actionRoute === "ready" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async (key) => { const input = z.object({ ready: z.boolean() }).parse(await bodyJson(request)); return markReady(tableId, session.user.id, input.ready, key); });
    if (tableId && actionRoute === "action" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async (key) => { const input = z.object({ action: z.object({ type: z.enum(["hit", "stand", "double", "split", "surrender", "insurance", "decline_insurance"]), amount: z.number().int().positive().optional() }), expectedVersion: z.number().int().nonnegative() }).parse(await bodyJson(request)); await enforceRateLimit(`action:${session.user.id}`, 30, 10); return submitAction(tableId, session.user.id, input.action as BlackjackAction, input.expectedVersion, key); });
    if (tableId && actionRoute === "chat" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, async () => { await enforceRateLimit(`chat:${session.user.id}`, 12, 10); return addChat(tableId, session.user.id, z.object({ kind: z.enum(["message", "reaction"]).optional(), body: z.string().max(200) }).parse(await bodyJson(request))); });
    if (tableId && actionRoute === "invites" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, () => createInvite(tableId, session.user.id));
    if (tableId && actionRoute === "config" && request.method === "PATCH") return idempotentMutation(request, requestId, session.user.id, route, async () => updateTableConfig(tableId, session.user.id, await bodyJson(request)));
    if (tableId && actionRoute === "close" && request.method === "POST") return idempotentMutation(request, requestId, session.user.id, route, () => closeTable(tableId, session.user.id));

    const adminWallet = route.match(/^admin\/users\/([^/]+)\/wallet$/);
    if (adminWallet && request.method === "POST") { await requireAdmin(session); return idempotentMutation(request, requestId, session.user.id, route, async (key) => adminAdjustWallet(session.user.id, adminWallet[1], z.object({ operation: z.enum(["grant", "remove", "reset"]), amount: z.number().int().optional(), reason: z.string().min(3).max(200) }).parse(await bodyJson(request)), key)); }
    const adminStatus = route.match(/^admin\/users\/([^/]+)\/status$/);
    if (adminStatus && request.method === "POST") { await requireAdmin(session); return idempotentMutation(request, requestId, session.user.id, route, async () => adminSetUserStatus(session.user.id, adminStatus[1], z.object({ status: z.enum(["active", "suspended"]), reason: z.string().min(3).max(200) }).parse(await bodyJson(request)))); }
    if (route === "admin/users" && request.method === "GET") { await requireAdmin(session); const users = await getD1().prepare("SELECT u.id,u.display_name,u.status,u.is_development,u.created_at,w.balance,s.rounds_played FROM users u JOIN wallets w ON w.user_id=u.id JOIN statistics s ON s.user_id=u.id ORDER BY u.created_at DESC LIMIT 100").all(); return apiOk(users.results, requestId); }
    if (route === "admin/audit" && request.method === "GET") { await requireAdmin(session); const logs = await getD1().prepare("SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200").all(); return apiOk(logs.results, requestId); }

    throw new HttpError(404, "NOT_FOUND", "Endpoint not found");
  } catch (error) {
    if (error instanceof ZodError) return apiError(new HttpError(400, "VALIDATION_ERROR", "Request validation failed", error.issues), requestId);
    return apiError(error, requestId);
  }
}

export const GET = handle; export const POST = handle; export const PATCH = handle; export const DELETE = handle; export const OPTIONS = handle;
