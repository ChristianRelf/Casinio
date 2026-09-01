import { z } from "zod";
import { getD1, getRuntimeEnv } from "../../db";
import { applyTimeout, blackjackAdapter, cancelRound, createBlackjackRoundResult, handValue, serializePrivateState, serializePublicState, type BlackjackAction, type BlackjackRules, type BlackjackState, type WalletAdjustment } from "../../packages/game-core/src";
import type { RealtimeEnvelope, SessionUser, TableSummary } from "../../packages/contracts/src";
import { HttpError, nowIso, sha256, uid } from "./runtime";

const createTableSchema = z.object({
  name: z.string().trim().min(2).max(40),
  maxSeats: z.number().int().min(1).max(7).default(7),
  minBet: z.number().int().min(1).max(100_000).default(25),
  maxBet: z.number().int().min(1).max(1_000_000).default(500),
  deckCount: z.number().int().min(1).max(8).default(6),
  blackjackPayout: z.number().min(1).max(2).default(1.5),
  dealerHitsSoft17: z.boolean().default(false),
  allowSurrender: z.boolean().default(true),
  maxSplits: z.number().int().min(0).max(4).default(3),
  hitSplitAces: z.boolean().default(false),
  doubleAfterSplit: z.boolean().default(true),
  turnSeconds: z.number().int().min(10).max(90).default(25),
  visibility: z.enum(["private", "friends", "public"]).default("private"),
});

const PRESENCE_TOUCH_INTERVAL_MS = 10_000;
const PRESENCE_STALE_AFTER_MS = 30_000;

type TableRow = {
  id: string; game_type: string; owner_user_id: string; name: string; status: string; visibility: string; dealer_mode: string;
  dealer_user_id: string | null; max_seats: number; min_bet: number; max_bet: number; rules_json: string; game_state_json: string | null;
  current_round_id: string | null; state_version: number; created_at: string; updated_at: string;
};

function cleanText(value: string, max: number): string {
  return value.replace(/[<>\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function publicInviteCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(6); globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function loadTable(tableId: string): Promise<TableRow> {
  const row = await getD1().prepare("SELECT * FROM tables WHERE id = ? LIMIT 1").bind(tableId).first<TableRow>();
  if (!row) throw new HttpError(404, "TABLE_NOT_FOUND", "That table does not exist");
  return row;
}

async function requireMembership(tableId: string, userId: string, allowSpectator = true) {
  const member = await getD1().prepare("SELECT * FROM table_memberships WHERE table_id = ? AND user_id = ? AND connection_status != 'left'").bind(tableId, userId).first<Record<string, unknown>>();
  if (!member || (!allowSpectator && member.role === "spectator")) throw new HttpError(403, "TABLE_ACCESS_DENIED", "Join this table before continuing");
  return member;
}

async function refreshPresence(tableId: string, userId: string, now = new Date()) {
  const at = now.toISOString();
  const touchBefore = new Date(now.getTime() - PRESENCE_TOUCH_INTERVAL_MS).toISOString();
  const staleBefore = new Date(now.getTime() - PRESENCE_STALE_AFTER_MS).toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("UPDATE table_memberships SET connection_status='connected',last_seen_at=? WHERE table_id=? AND user_id=? AND connection_status!='left' AND leave_after_round=0 AND (connection_status!='connected' OR last_seen_at<?)").bind(at, tableId, userId, touchBefore),
    db.prepare("UPDATE table_memberships SET connection_status='disconnected' WHERE table_id=? AND connection_status='connected' AND user_id!=? AND last_seen_at<?").bind(tableId, userId, staleBefore),
  ]);
  return at;
}

async function expireStalePresence(now = new Date()) {
  const staleBefore = new Date(now.getTime() - PRESENCE_STALE_AFTER_MS).toISOString();
  await getD1().prepare("UPDATE table_memberships SET connection_status='disconnected' WHERE connection_status='connected' AND last_seen_at<?").bind(staleBefore).run();
}

async function walletStatements(adjustments: WalletAdjustment[], tableId: string | null, roundId: string | null, idempotencyKey: string) {
  const db = getD1(); const grouped = new Map<string, WalletAdjustment[]>();
  for (const adjustment of adjustments) grouped.set(adjustment.userId, [...(grouped.get(adjustment.userId) ?? []), adjustment]);
  const statements: D1PreparedStatement[] = [];
  for (const [userId, userAdjustments] of grouped) {
    const wallet = await db.prepare("SELECT balance,version FROM wallets WHERE user_id = ?").bind(userId).first<{ balance: number; version: number }>();
    if (!wallet) throw new HttpError(409, "WALLET_NOT_FOUND", "Player wallet is unavailable");
    let balance = wallet.balance;
    statements.push(db.prepare("INSERT INTO wallet_mutation_locks (user_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(userId, wallet.version, idempotencyKey, nowIso()));
    for (let index = 0; index < userAdjustments.length; index += 1) {
      const adjustment = userAdjustments[index]; const before = balance; balance = Math.round((balance + adjustment.amount + Number.EPSILON) * 100) / 100;
      if (balance < 0) throw new HttpError(409, "INSUFFICIENT_BALANCE", "There is not enough play money for that action");
      statements.push(db.prepare(`INSERT INTO wallet_ledger (id,user_id,table_id,round_id,amount,reason,balance_before,balance_after,idempotency_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uid("led"), userId, tableId, roundId, adjustment.amount, adjustment.reason, before, balance, `${idempotencyKey}:${userId}:${index}`, JSON.stringify({ handId: adjustment.handId ?? null }), nowIso()));
    }
    statements.push(db.prepare("UPDATE wallets SET balance = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?").bind(balance, nowIso(), userId, wallet.version));
  }
  return statements;
}

function eventStatements(tableId: string, state: BlackjackState, events: ReturnType<typeof createBlackjackRoundResult>["events"]) {
  const db = getD1();
  return events.map((gameEvent) => {
    const envelope: RealtimeEnvelope = { id: gameEvent.id, version: state.stateVersion, tableId, roundId: state.roundId, type: gameEvent.type, timestamp: gameEvent.at, publicPayload: gameEvent.payload };
    return db.prepare("INSERT INTO game_events (id,table_id,round_id,state_version,event_type,public_payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(gameEvent.id, tableId, state.roundId, state.stateVersion, gameEvent.type, JSON.stringify(envelope), gameEvent.at);
  });
}

function settlementStatements(tableId: string, state: BlackjackState, at: string) {
  const db = getD1(); const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE table_memberships SET ready=0,pending_bet=NULL WHERE table_id=?").bind(tableId),
    db.prepare("UPDATE seats SET user_id=NULL,occupied_at=NULL WHERE table_id=? AND user_id IN (SELECT user_id FROM table_memberships WHERE table_id=? AND leave_after_round=1)").bind(tableId, tableId),
    db.prepare("UPDATE table_memberships SET role=CASE WHEN role='owner' THEN 'owner' ELSE 'spectator' END,connection_status='left',leave_after_round=0,left_at=? WHERE table_id=? AND leave_after_round=1").bind(at, tableId),
  ];
  let shoePosition = 0;
  const addCards = (handId: string, cards: BlackjackState["dealer"]["cards"], revealAll: boolean) => {
    cards.forEach((card, index) => {
      statements.push(db.prepare("INSERT INTO cards (id,round_id,hand_id,shoe_position,rank,suit,deck_index,dealt_at,revealed_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(uid("crd"), state.roundId, handId, shoePosition++, card.rank, card.suit, card.deck, state.startedAt, revealAll || index === 0 ? at : null));
    });
  };
  for (const player of state.players) {
    const won = player.hands.filter((hand) => hand.status === "won").length;
    const lost = player.hands.filter((hand) => hand.status === "lost").length;
    const pushed = player.hands.filter((hand) => hand.status === "push").length;
    const blackjacks = player.hands.filter((hand) => hand.cards.length === 2 && !hand.isSplitHand && hand.status === "won" && handValue(hand.cards).blackjack).length;
    const biggest = Math.max(0, ...player.hands.map((hand) => hand.resultAmount ?? 0));
    const wagered = player.hands.reduce((sum, hand) => sum + hand.wager, 0) + player.insuranceBet;
    if (state.phase !== "cancelled") statements.push(db.prepare(`UPDATE statistics SET rounds_played=rounds_played+1,hands_won=hands_won+?,hands_lost=hands_lost+?,hands_pushed=hands_pushed+?,blackjacks=blackjacks+?,biggest_win=MAX(biggest_win,?),total_wagered=total_wagered+?,updated_at=? WHERE user_id=?`)
      .bind(won, lost, pushed, blackjacks, biggest, wagered, at, player.userId));
    statements.push(db.prepare("UPDATE round_participants SET ending_balance=(SELECT balance FROM wallets WHERE user_id=?),outcome=? WHERE round_id=? AND user_id=?")
      .bind(player.userId, state.phase === "cancelled" ? "cancelled" : won > lost ? "win" : lost > won ? "loss" : "push", state.roundId, player.userId));
    player.hands.forEach((hand, index) => {
      statements.push(db.prepare("INSERT INTO hands (id,round_id,user_id,seat_number,hand_index,wager,status,total,is_dealer,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)")
        .bind(hand.id, state.roundId, player.userId, player.seat, index, hand.wager, hand.status, handValue(hand.cards).total, at));
      addCards(hand.id, hand.cards, true);
    });
  }
  const dealerHandId = uid("dealerhand");
  statements.push(db.prepare("INSERT INTO hands (id,round_id,user_id,seat_number,hand_index,wager,status,total,is_dealer,created_at) VALUES (?,?,NULL,NULL,0,0,?,?,1,?)")
    .bind(dealerHandId, state.roundId, state.dealer.status, handValue(state.dealer.cards).total, at));
  addCards(dealerHandId, state.dealer.cards, state.dealer.holeRevealed);
  return statements;
}

export async function createTable(user: SessionUser, raw: unknown) {
  const input = createTableSchema.parse(raw); if (input.maxBet < input.minBet) throw new HttpError(400, "INVALID_LIMITS", "Maximum bet must be at least the minimum bet");
  const db = getD1(); const tableId = uid("tbl"); const at = nowIso(); const invite = publicInviteCode();
  const rules: Partial<BlackjackRules> = {
    deckCount: input.deckCount,
    minBet: input.minBet,
    maxBet: input.maxBet,
    blackjackPayout: input.blackjackPayout,
    dealerHitsSoft17: input.dealerHitsSoft17,
    allowSurrender: input.allowSurrender,
    maxSplits: input.maxSplits,
    hitSplitAces: input.hitSplitAces,
    doubleAfterSplit: input.doubleAfterSplit,
    turnSeconds: input.turnSeconds,
  };
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO tables (id,game_type,owner_user_id,name,status,visibility,dealer_mode,max_seats,min_bet,max_bet,rules_json,state_version,created_at,updated_at) VALUES (?,'blackjack',?,?,'open',?,'automated',?,?,?,?,0,?,?)`)
      .bind(tableId, user.id, cleanText(input.name, 40), input.visibility, input.maxSeats, input.minBet, input.maxBet, JSON.stringify(rules), at, at),
    db.prepare("INSERT INTO table_memberships (table_id,user_id,role,connection_status,ready,joined_at,last_seen_at) VALUES (?,?,'owner','connected',0,?,?)").bind(tableId, user.id, at, at),
    db.prepare("INSERT INTO invite_codes (id,table_id,code_hash,code_prefix,created_by,max_uses,use_count,expires_at,created_at) VALUES (?,?,?,?,?,50,0,?,?)")
      .bind(uid("inv"), tableId, await sha256(invite), invite.slice(0, 2), user.id, new Date(Date.now() + 7 * 86400_000).toISOString(), at),
  ];
  for (let seat = 1; seat <= input.maxSeats; seat += 1) statements.push(db.prepare("INSERT INTO seats (table_id,seat_number) VALUES (?,?)").bind(tableId, seat));
  await db.batch(statements);
  return { tableId, inviteCode: invite, joinUrl: `/join/${invite}` };
}

export async function listTables(userId: string): Promise<TableSummary[]> {
  await expireStalePresence();
  const rows = await getD1().prepare(`
    SELECT t.id,t.name,t.game_type,t.status,t.visibility,t.max_seats,t.min_bet,t.max_bet,t.updated_at,u.display_name AS owner_display_name,
      SUM(CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END) AS seated_count,
      (SELECT COUNT(*) FROM table_memberships tm2 WHERE tm2.table_id=t.id AND tm2.role='spectator' AND tm2.connection_status='connected') AS spectator_count
    FROM tables t JOIN users u ON u.id=t.owner_user_id
    LEFT JOIN table_memberships tm ON tm.table_id=t.id AND tm.user_id=? AND tm.connection_status!='left'
    LEFT JOIN seats s ON s.table_id=t.id
    WHERE t.status!='closed' AND (t.visibility='public' OR tm.user_id IS NOT NULL)
    GROUP BY t.id ORDER BY t.updated_at DESC LIMIT 50
  `).bind(userId).all<Record<string, string | number>>();
  return rows.results.map((row) => ({ id: String(row.id), name: String(row.name), gameType: String(row.game_type), status: String(row.status), visibility: String(row.visibility), maxSeats: Number(row.max_seats), seatedCount: Number(row.seated_count), spectatorCount: Number(row.spectator_count), minBet: Number(row.min_bet), maxBet: Number(row.max_bet), ownerDisplayName: String(row.owner_display_name), updatedAt: String(row.updated_at) }));
}

export async function validateInvite(codeRaw: string) {
  const code = codeRaw.toUpperCase().trim(); const codeHash = await sha256(code);
  const row = await getD1().prepare(`SELECT i.table_id,i.expires_at,i.revoked_at,i.max_uses,i.use_count,t.name,t.status,t.game_type FROM invite_codes i JOIN tables t ON t.id=i.table_id WHERE i.code_hash=? LIMIT 1`).bind(codeHash).first<Record<string, string | number | null>>();
  if (!row || row.revoked_at || row.status === "closed" || (row.expires_at && new Date(String(row.expires_at)) <= new Date()) || (row.max_uses != null && Number(row.use_count) >= Number(row.max_uses))) throw new HttpError(404, "INVITE_INVALID", "This invite is invalid, expired, or has been revoked");
  return { tableId: String(row.table_id), tableName: String(row.name), gameType: String(row.game_type), status: String(row.status) };
}

export async function joinWithInvite(userId: string, code: string) {
  const invite = await validateInvite(code); const db = getD1(); const at = nowIso(); const hash = await sha256(code.toUpperCase().trim());
  const existing = await db.prepare("SELECT 1 AS joined FROM table_memberships WHERE table_id=? AND user_id=?").bind(invite.tableId, userId).first();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO table_memberships (table_id,user_id,role,connection_status,ready,leave_after_round,joined_at,last_seen_at) VALUES (?,?,'spectator','connected',0,0,?,?) ON CONFLICT(table_id,user_id) DO UPDATE SET connection_status='connected',role=CASE WHEN table_memberships.role IN ('owner','player') THEN table_memberships.role ELSE 'spectator' END,leave_after_round=0,left_at=NULL,last_seen_at=excluded.last_seen_at`).bind(invite.tableId, userId, at, at),
  ];
  if (!existing) statements.push(db.prepare("UPDATE invite_codes SET use_count=use_count+1 WHERE code_hash=?").bind(hash));
  await db.batch(statements);
  return invite;
}

export async function createInvite(tableId: string, userId: string) {
  const table = await loadTable(tableId); if (table.owner_user_id !== userId) throw new HttpError(403, "OWNER_REQUIRED", "Only the table owner can create invites");
  const code = publicInviteCode(); await getD1().prepare("INSERT INTO invite_codes (id,table_id,code_hash,code_prefix,created_by,max_uses,use_count,expires_at,created_at) VALUES (?,?,?,?,?,50,0,?,?)")
    .bind(uid("inv"), tableId, await sha256(code), code.slice(0, 2), userId, new Date(Date.now() + 7 * 86400_000).toISOString(), nowIso()).run();
  return { code, joinUrl: `/join/${code}`, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
}

export async function takeSeat(tableId: string, userId: string, seatNumber: number) {
  const table = await loadTable(tableId); await requireMembership(tableId, userId);
  const state = table.game_state_json ? JSON.parse(table.game_state_json) as BlackjackState : null;
  if (table.status === "in_round" && state?.phase !== "settled") throw new HttpError(409, "ROUND_IN_PROGRESS", "Take a seat between rounds");
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > table.max_seats) throw new HttpError(400, "INVALID_SEAT", "That seat does not exist");
  const db = getD1(); const occupied = await db.prepare("SELECT user_id FROM seats WHERE table_id=? AND seat_number=?").bind(tableId, seatNumber).first<{ user_id: string | null }>();
  if (!occupied || (occupied.user_id && occupied.user_id !== userId)) throw new HttpError(409, "SEAT_TAKEN", "Someone is already sitting there");
  const at = nowIso(); await db.batch([
    db.prepare("UPDATE seats SET user_id=NULL,occupied_at=NULL WHERE table_id=? AND user_id=?").bind(tableId, userId),
    db.prepare("UPDATE seats SET user_id=?,occupied_at=? WHERE table_id=? AND seat_number=? AND user_id IS NULL").bind(userId, at, tableId, seatNumber),
    db.prepare("UPDATE table_memberships SET role=CASE WHEN role='owner' THEN 'owner' ELSE 'player' END,connection_status='connected',leave_after_round=0,left_at=NULL,last_seen_at=? WHERE table_id=? AND user_id=?").bind(at, tableId, userId),
  ]);
  return { seatNumber };
}

export async function releaseSeat(tableId: string, userId: string) {
  const table = await loadTable(tableId); await requireMembership(tableId, userId);
  if (table.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "Your seat is held until this round finishes");
  await getD1().batch([
    getD1().prepare("UPDATE seats SET user_id=NULL,occupied_at=NULL WHERE table_id=? AND user_id=?").bind(tableId, userId),
    getD1().prepare("UPDATE table_memberships SET role=CASE WHEN role='owner' THEN 'owner' ELSE 'spectator' END,ready=0,leave_after_round=0,pending_bet=NULL WHERE table_id=? AND user_id=?").bind(tableId, userId),
  ]); return { released: true };
}

export async function leaveTable(tableId: string, userId: string) {
  const table = await loadTable(tableId); await requireMembership(tableId, userId);
  const at = nowIso(); const db = getD1();
  if (table.status === "in_round") {
    await db.prepare("UPDATE table_memberships SET connection_status='disconnected',leave_after_round=1,last_seen_at=? WHERE table_id=? AND user_id=?").bind(at, tableId, userId).run();
    return { left: false, seatHeldUntilRoundEnd: true };
  }
  await db.batch([
    db.prepare("UPDATE seats SET user_id=NULL,occupied_at=NULL WHERE table_id=? AND user_id=?").bind(tableId, userId),
    db.prepare("UPDATE table_memberships SET role=CASE WHEN role='owner' THEN 'owner' ELSE 'spectator' END,connection_status='left',ready=0,leave_after_round=0,pending_bet=NULL,left_at=? WHERE table_id=? AND user_id=?").bind(at, tableId, userId),
  ]); return { left: true, seatHeldUntilRoundEnd: false };
}

export async function reconnectTable(tableId: string, userId: string) {
  await requireMembership(tableId, userId);
  const at = nowIso();
  await getD1().prepare("UPDATE table_memberships SET connection_status='connected',leave_after_round=0,left_at=NULL,last_seen_at=? WHERE table_id=? AND user_id=? AND connection_status!='left'").bind(at, tableId, userId).run();
  return { reconnected: true };
}

export async function placeBet(tableId: string, userId: string, amount: number, idempotencyKey: string) {
  const table = await loadTable(tableId); const member = await requireMembership(tableId, userId, false);
  if (table.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "Bets are locked for this round");
  if (!Number.isInteger(amount) || amount < table.min_bet || amount > table.max_bet) throw new HttpError(400, "BET_OUTSIDE_LIMITS", `Bet must be between $${table.min_bet} and $${table.max_bet}`);
  const seat = await getD1().prepare("SELECT seat_number FROM seats WHERE table_id=? AND user_id=?").bind(tableId, userId).first(); if (!seat) throw new HttpError(409, "SEAT_REQUIRED", "Take a seat before betting");
  const oldBet = Number(member.pending_bet ?? 0); const delta = oldBet - amount;
  const reason = oldBet === 0 ? "BET_PLACED" : delta < 0 ? "BET_INCREASED" : "BET_REDUCED";
  const db = getD1();
  const wallet = await db.prepare("SELECT balance,version FROM wallets WHERE user_id=?").bind(userId).first<{ balance: number; version: number }>();
  if (!wallet || wallet.balance + delta < 0) throw new HttpError(409, "INSUFFICIENT_BALANCE", "There is not enough play money for that bet");
  // Choosing the already-selected chip value is a harmless retry from the UI,
  // not a balance mutation. Avoid writing a zero-value ledger entry or
  // advancing the wallet version for it.
  if (oldBet === amount) return { amount, balance: wallet.balance };
  const after = wallet.balance + delta; const at = nowIso();
  await db.batch([
    db.prepare("INSERT INTO wallet_mutation_locks (user_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(userId, wallet.version, idempotencyKey, at),
    db.prepare("UPDATE wallets SET balance=?,version=version+1,updated_at=? WHERE user_id=? AND version=?").bind(after, at, userId, wallet.version),
    db.prepare("INSERT INTO wallet_ledger (id,user_id,table_id,round_id,amount,reason,balance_before,balance_after,idempotency_key,metadata_json,created_at) VALUES (?,?,?,NULL,?,?,?,?,?,?,?)").bind(uid("led"), userId, tableId, delta, reason, wallet.balance, after, idempotencyKey, JSON.stringify({ previousBet: oldBet, newBet: amount }), at),
    db.prepare("UPDATE table_memberships SET pending_bet=?,ready=0,last_seen_at=? WHERE table_id=? AND user_id=?").bind(amount, at, tableId, userId),
  ]);
  return { amount, balance: after };
}

async function maybeStartRound(tableId: string, idempotencyKey: string) {
  const table = await loadTable(tableId); if (table.status === "in_round") return null;
  const seated = await getD1().prepare(`SELECT s.seat_number,u.id AS user_id,u.display_name,tm.pending_bet,tm.ready FROM seats s JOIN users u ON u.id=s.user_id JOIN table_memberships tm ON tm.table_id=s.table_id AND tm.user_id=s.user_id WHERE s.table_id=? ORDER BY s.seat_number`).bind(tableId).all<Record<string, string | number>>();
  if (!seated.results.length || seated.results.some((row) => !row.ready || !row.pending_bet)) return null;
  const rules = JSON.parse(table.rules_json) as Partial<BlackjackRules>; const roundId = uid("rnd");
  const result = createBlackjackRoundResult({ roundId, participants: seated.results.map((row) => ({ userId: String(row.user_id), seat: Number(row.seat_number), displayName: String(row.display_name), bet: Number(row.pending_bet) })), rules });
  const state = result.state;
  // Engine versions are local to a new state object; table versions must never
  // reset between rounds because clients and transition locks use them as a
  // single monotonic stream.
  state.stateVersion = table.state_version + 1;
  const isFinal = state.phase === "settled" || state.phase === "cancelled";
  const sequenceRow = await getD1().prepare("SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM game_rounds WHERE table_id=?").bind(tableId).first<{ sequence: number }>();
  const db = getD1(); const at = nowIso(); const publicState = serializePublicState(state); const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO state_transition_locks (table_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(tableId, table.state_version, idempotencyKey, at),
    db.prepare("INSERT INTO game_rounds (id,table_id,sequence,game_type,status,rules_json,authoritative_state_json,started_at,settled_at) VALUES (?,?,?,'blackjack',?,?,?,?,?)")
      .bind(roundId, tableId, sequenceRow?.sequence ?? 1, isFinal ? state.phase : "active", JSON.stringify(state.rules), JSON.stringify(state), state.startedAt, state.settledAt),
    db.prepare("UPDATE tables SET status=?,game_state_json=?,current_round_id=?,state_version=?,last_event_at=?,updated_at=? WHERE id=? AND state_version=?")
      .bind(isFinal ? "open" : "in_round", JSON.stringify(state), roundId, state.stateVersion, at, at, tableId, table.state_version),
    db.prepare("UPDATE table_memberships SET ready=0 WHERE table_id=?").bind(tableId),
  ];
  statements.push(...await walletStatements(result.walletAdjustments, tableId, roundId, `${idempotencyKey}:initial-settlement`));
  statements.push(...eventStatements(tableId, state, result.events));
  statements.push(db.prepare("INSERT INTO game_events (id,table_id,round_id,state_version,event_type,public_payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(uid("gev"), tableId, roundId, state.stateVersion, "state.snapshot", JSON.stringify(publicState), at));
  for (const row of seated.results) {
    const wallet = await db.prepare("SELECT balance FROM wallets WHERE user_id=?").bind(row.user_id).first<{ balance: number }>();
    statements.push(db.prepare("INSERT INTO round_participants (round_id,user_id,seat_number,starting_balance) VALUES (?,?,?,?)").bind(roundId, row.user_id, row.seat_number, (wallet?.balance ?? 0) + Number(row.pending_bet)));
    statements.push(db.prepare("INSERT INTO bets (id,round_id,user_id,type,amount,status,created_at) VALUES (?,?,?,'main',?,'committed',?)").bind(uid("bet"), roundId, row.user_id, row.pending_bet, at));
  }
  if (isFinal) statements.push(...settlementStatements(tableId, state, at));
  try { await db.batch(statements); }
  catch (error) {
    if (String(error).includes("UNIQUE") || String(error).includes("constraint")) throw new HttpError(409, "STALE_STATE", "Another player changed the table first. The latest state has been restored.");
    throw error;
  }
  return { roundId, stateVersion: state.stateVersion, phase: state.phase };
}

export async function markReady(tableId: string, userId: string, ready: boolean, idempotencyKey: string) {
  const table = await loadTable(tableId); const member = await requireMembership(tableId, userId, false);
  if (table.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "The current round is already underway");
  if (ready && !member.pending_bet) throw new HttpError(409, "BET_REQUIRED", "Place a bet before marking ready");
  await getD1().prepare("UPDATE table_memberships SET ready=?,last_seen_at=? WHERE table_id=? AND user_id=?").bind(ready ? 1 : 0, nowIso(), tableId, userId).run();
  let started = null;
  if (ready) {
    try { started = await maybeStartRound(tableId, idempotencyKey); }
    catch (error) {
      // Two last-ready requests may both observe the complete ready set. One
      // transaction starts the round; the losing transition should converge on
      // that authoritative result instead of showing a false error to a player.
      if (!(error instanceof HttpError) || error.code !== "STALE_STATE") throw error;
      const latest = await loadTable(tableId);
      if (latest.status !== "in_round" || !latest.current_round_id) throw error;
      started = { roundId: latest.current_round_id, stateVersion: latest.state_version, phase: latest.game_state_json ? (JSON.parse(latest.game_state_json) as BlackjackState).phase : "player_turns" };
    }
  }
  return { ready, roundStarted: Boolean(started), ...started };
}

async function persistEngineResult(
  table: TableRow,
  result: ReturnType<typeof applyTimeout>,
  idempotencyKey: string,
  actionRecord?: { userId: string; action: BlackjackAction; expectedVersion: number },
  transitionLockVersion = table.state_version,
) {
  const db = getD1(); const state = result.state; const at = nowIso();
  const statements: D1PreparedStatement[] = [db.prepare("INSERT INTO state_transition_locks (table_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(table.id, transitionLockVersion, idempotencyKey, at)];
  statements.push(...await walletStatements(result.walletAdjustments, table.id, state.roundId, idempotencyKey));
  statements.push(db.prepare("UPDATE tables SET status=?,game_state_json=?,state_version=?,last_event_at=?,updated_at=? WHERE id=? AND state_version=?")
    .bind(state.phase === "settled" || state.phase === "cancelled" ? "open" : "in_round", JSON.stringify(state), state.stateVersion, at, at, table.id, table.state_version));
  statements.push(db.prepare("UPDATE game_rounds SET authoritative_state_json=?,status=?,settled_at=? WHERE id=?")
    .bind(JSON.stringify(state), state.phase === "settled" ? "settled" : state.phase === "cancelled" ? "cancelled" : "active", state.settledAt, state.roundId));
  statements.push(...eventStatements(table.id, state, result.events));
  statements.push(db.prepare("INSERT INTO game_events (id,table_id,round_id,state_version,event_type,public_payload_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(uid("gev"), table.id, state.roundId, state.stateVersion, "state.snapshot", JSON.stringify(serializePublicState(state)), at));
  if (actionRecord) statements.push(db.prepare("INSERT INTO player_actions (id,table_id,round_id,user_id,action_type,action_json,expected_version,accepted_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(uid("act"), table.id, state.roundId, actionRecord.userId, actionRecord.action.type, JSON.stringify(actionRecord.action), actionRecord.expectedVersion, state.stateVersion, at));
  for (const adjustment of result.walletAdjustments.filter((item) => item.reason === "DOUBLE_DOWN" || item.reason === "SPLIT_BET" || item.reason === "INSURANCE_BET")) {
    statements.push(db.prepare("INSERT INTO bets (id,round_id,user_id,hand_id,type,amount,status,created_at) VALUES (?,?,?,?,?,?,'committed',?)")
      .bind(uid("bet"), state.roundId, adjustment.userId, adjustment.handId ?? null, adjustment.reason.toLowerCase(), Math.abs(adjustment.amount), at));
  }
  if (state.phase === "settled" || state.phase === "cancelled") {
    statements.push(...settlementStatements(table.id, state, at));
  }
  try { await db.batch(statements); }
  catch (error) {
    if (String(error).includes("UNIQUE") || String(error).includes("constraint")) throw new HttpError(409, "STALE_STATE", "The table changed before that action arrived. Refreshing will restore the current state.");
    throw error;
  }
}

export async function submitAction(tableId: string, userId: string, action: BlackjackAction, expectedVersion: number, idempotencyKey: string) {
  const table = await loadTable(tableId); await requireMembership(tableId, userId, false);
  if (!table.game_state_json || !table.current_round_id || table.status !== "in_round") throw new HttpError(409, "NO_ACTIVE_ROUND", "There is no active round");
  if (table.state_version !== expectedVersion) throw new HttpError(409, "STALE_STATE", "The table has moved on", { currentVersion: table.state_version });
  const wallet = await getD1().prepare("SELECT balance FROM wallets WHERE user_id=?").bind(userId).first<{ balance: number }>();
  let result;
  try { result = blackjackAdapter.applyAction(JSON.parse(table.game_state_json) as BlackjackState, userId, action, wallet?.balance ?? 0, new Date()); }
  catch (error) { throw new HttpError(409, "ACTION_REJECTED", error instanceof Error ? error.message : "Action was rejected"); }
  await persistEngineResult(table, result, idempotencyKey, { userId, action, expectedVersion });
  return { stateVersion: result.state.stateVersion, phase: result.state.phase, events: result.events };
}

async function recoverIfNeeded(table: TableRow) {
  if (!table.game_state_json || table.status !== "in_round") return table;
  const state = JSON.parse(table.game_state_json) as BlackjackState;
  if (!state.actionDeadlineAt || new Date(state.actionDeadlineAt) > new Date()) return table;
  const result = blackjackAdapter.recoverState(state, new Date());
  if (result.state.stateVersion !== state.stateVersion) {
    try { await persistEngineResult(table, result, `timeout:${table.id}:${state.stateVersion}`); }
    catch (error) {
      if (!(error instanceof HttpError) || error.code !== "STALE_STATE") throw error;
      const latest = await loadTable(table.id);
      if (latest.state_version !== table.state_version || latest.status !== "in_round" || !latest.game_state_json) return latest;
      // A lock with an unchanged row means a legacy/regressed version or an
      // interrupted transition made safe continuation impossible. Cancel and
      // refund the complete committed wager instead of guessing card state.
      const lock = await getD1().prepare("SELECT COALESCE(MAX(from_version),?) AS version FROM state_transition_locks WHERE table_id=?").bind(latest.state_version, latest.id).first<{ version: number }>();
      const recoveryLockVersion = Math.max(latest.state_version, lock?.version ?? latest.state_version) + 1;
      const cancelled = cancelRound(JSON.parse(latest.game_state_json) as BlackjackState, new Date());
      cancelled.state.stateVersion = recoveryLockVersion + 1;
      try { await persistEngineResult(latest, cancelled, `recovery:${latest.id}:${recoveryLockVersion}`, undefined, recoveryLockVersion); }
      catch (recoveryError) { if (!(recoveryError instanceof HttpError) || recoveryError.code !== "STALE_STATE") throw recoveryError; }
    }
  }
  return loadTable(table.id);
}

export async function getTableState(tableId: string, userId: string) {
  let table = await loadTable(tableId); let member = await requireMembership(tableId, userId); table = await recoverIfNeeded(table);
  await refreshPresence(tableId, userId);
  member = await requireMembership(tableId, userId);
  const people = await getD1().prepare(`SELECT tm.user_id,tm.role,tm.connection_status,tm.ready,tm.pending_bet,u.display_name,u.avatar_url,w.balance,s.seat_number FROM table_memberships tm JOIN users u ON u.id=tm.user_id LEFT JOIN wallets w ON w.user_id=tm.user_id LEFT JOIN seats s ON s.table_id=tm.table_id AND s.user_id=tm.user_id WHERE tm.table_id=? AND tm.connection_status!='left' ORDER BY COALESCE(s.seat_number,99),tm.joined_at`).bind(tableId).all<Record<string, string | number | null>>();
  const chat = await getD1().prepare(`SELECT c.id,c.kind,c.body,c.created_at,u.id AS user_id,u.display_name FROM chat_messages c JOIN users u ON u.id=c.user_id WHERE c.table_id=? ORDER BY c.created_at DESC LIMIT 40`).bind(tableId).all<Record<string, string>>();
  const wallet = await getD1().prepare("SELECT balance FROM wallets WHERE user_id=?").bind(userId).first<{ balance: number }>();
  const state = table.game_state_json ? JSON.parse(table.game_state_json) as BlackjackState : null;
  return {
    table: { id: table.id, name: table.name, gameType: table.game_type, status: table.status, visibility: table.visibility, dealerMode: table.dealer_mode, dealerUserId: table.dealer_user_id, maxSeats: table.max_seats, minBet: table.min_bet, maxBet: table.max_bet, rules: JSON.parse(table.rules_json), stateVersion: table.state_version, ownerUserId: table.owner_user_id },
    membership: member,
    people: people.results.map((person) => ({ userId: person.user_id, role: person.role, connectionStatus: person.connection_status, ready: Boolean(person.ready), pendingBet: person.pending_bet, displayName: person.display_name, avatarUrl: person.avatar_url, balance: Number(person.balance), seatNumber: person.seat_number })),
    publicState: state ? serializePublicState(state) : null,
    privateState: state ? serializePrivateState(state, userId, wallet?.balance ?? 0) : null,
    chat: chat.results.reverse(),
    serverTime: nowIso(),
  };
}

export async function getEvents(tableId: string, userId: string, sinceVersion: number) {
  await requireMembership(tableId, userId);
  await refreshPresence(tableId, userId);
  const rows = await getD1().prepare("SELECT id,state_version,event_type,public_payload_json,private_payload_json,created_at,round_id FROM game_events WHERE table_id=? AND state_version>? ORDER BY state_version,id LIMIT 100").bind(tableId, sinceVersion).all<Record<string, string | number | null>>();
  return rows.results.map((row) => {
    const parsed = JSON.parse(String(row.public_payload_json));
    if (parsed.tableId) return parsed;
    return { id: String(row.id), version: Number(row.state_version), tableId, roundId: row.round_id ? String(row.round_id) : null, type: String(row.event_type), timestamp: String(row.created_at), publicPayload: parsed, privatePayload: row.private_payload_json ? JSON.parse(String(row.private_payload_json))[userId] : undefined } satisfies RealtimeEnvelope;
  });
}

export async function addChat(tableId: string, userId: string, raw: { kind?: string; body?: string }) {
  await requireMembership(tableId, userId); const kind = raw.kind === "reaction" ? "reaction" : "message"; let body = cleanText(String(raw.body ?? ""), 180);
  if (kind === "reaction") { const allowed = ["BRAVE", "PAINFUL", "CLEAN", "AGAIN", "ABSOLUTELY NOT", "EXCELLENT FORM"]; if (!allowed.includes(body.toUpperCase())) throw new HttpError(400, "INVALID_REACTION", "Unknown table reaction"); body = body.toUpperCase(); }
  if (!body) throw new HttpError(400, "EMPTY_MESSAGE", "Message cannot be empty");
  const item = { id: uid("msg"), tableId, userId, kind, body, createdAt: nowIso() };
  await getD1().prepare("INSERT INTO chat_messages (id,table_id,user_id,kind,body,created_at) VALUES (?,?,?,?,?,?)").bind(item.id, tableId, userId, kind, body, item.createdAt).run(); return item;
}

export async function updateTableConfig(tableId: string, userId: string, raw: unknown) {
  const table = await loadTable(tableId); if (table.owner_user_id !== userId) throw new HttpError(403, "OWNER_REQUIRED", "Only the table owner can change the table");
  if (table.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "Change rules between rounds");
  const schema = z.object({
    expectedVersion: z.number().int().nonnegative().optional(),
    name: z.string().trim().min(2).max(40).optional(),
    visibility: z.enum(["private", "friends", "public"]).optional(),
    dealerMode: z.enum(["automated", "player"]).optional(),
    dealerUserId: z.string().nullable().optional(),
    minBet: z.number().int().min(1).max(100_000).optional(),
    maxBet: z.number().int().min(1).max(1_000_000).optional(),
    rules: z.object({
      deckCount: z.number().int().min(1).max(8).optional(),
      blackjackPayout: z.number().min(1).max(2).optional(),
      dealerHitsSoft17: z.boolean().optional(),
      allowSurrender: z.boolean().optional(),
      maxSplits: z.number().int().min(0).max(4).optional(),
      hitSplitAces: z.boolean().optional(),
      doubleAfterSplit: z.boolean().optional(),
      turnSeconds: z.number().int().min(10).max(90).optional(),
    }).strict().optional(),
  }).strict();
  const input = schema.parse(raw);
  if (input.dealerMode === "player") throw new HttpError(409, "PLAYER_DEALER_NOT_ENABLED", "Player-controlled dealer mode is reserved by the API but is not enabled in this release");
  if (input.dealerUserId) throw new HttpError(409, "PLAYER_DEALER_NOT_ENABLED", "A dealer user can only be assigned when player-controlled dealing is enabled");
  const name = input.name === undefined ? table.name : cleanText(input.name, 40);
  if (name.length < 2) throw new HttpError(400, "INVALID_TABLE_NAME", "Table name must contain at least two visible characters");
  const minBet = input.minBet ?? table.min_bet; const maxBet = input.maxBet ?? table.max_bet;
  if (maxBet < minBet) throw new HttpError(400, "INVALID_LIMITS", "Maximum bet must be at least the minimum bet");
  const nextRules: Partial<BlackjackRules> = { ...JSON.parse(table.rules_json), ...(input.rules ?? {}), minBet, maxBet };
  const visibility = input.visibility ?? table.visibility;
  const dealerMode = input.dealerMode ?? table.dealer_mode;
  const dealerUserId = input.dealerUserId === undefined ? table.dealer_user_id : input.dealerUserId;
  const expectedVersion = input.expectedVersion ?? table.state_version; const stateVersion = expectedVersion + 1;
  const at = nowIso(); const eventId = uid("evt");
  const publicPayload = { name, visibility, dealerMode, minBet, maxBet, rules: nextRules };
  const envelope: RealtimeEnvelope = { id: eventId, version: stateVersion, tableId, roundId: null, type: "table.configured", timestamp: at, publicPayload };
  const db = getD1();
  const results = await db.batch([
    db.prepare(`UPDATE tables SET name=?,visibility=?,dealer_mode=?,dealer_user_id=?,min_bet=?,max_bet=?,rules_json=?,state_version=state_version+1,last_event_at=?,updated_at=?
      WHERE id=? AND status!='in_round' AND state_version=?
      AND NOT EXISTS (SELECT 1 FROM table_memberships WHERE table_id=? AND (ready=1 OR pending_bet IS NOT NULL))`)
      .bind(name, visibility, dealerMode, dealerUserId, minBet, maxBet, JSON.stringify(nextRules), at, at, tableId, expectedVersion, tableId),
    db.prepare(`INSERT INTO game_events (id,table_id,round_id,state_version,event_type,public_payload_json,private_payload_json,created_at)
      SELECT ?,?,NULL,?,'table.configured',?,NULL,? WHERE EXISTS (SELECT 1 FROM tables WHERE id=? AND state_version=? AND updated_at=?)`)
      .bind(eventId, tableId, stateVersion, JSON.stringify(envelope), at, tableId, stateVersion, at),
  ]);
  if (!Number(results[0].meta.changes ?? 0)) {
    const latest = await loadTable(tableId);
    if (latest.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "Change rules between rounds");
    const blocker = await db.prepare("SELECT COUNT(*) AS count FROM table_memberships WHERE table_id=? AND (ready=1 OR pending_bet IS NOT NULL)").bind(tableId).first<{ count: number }>();
    if (Number(blocker?.count ?? 0) > 0) throw new HttpError(409, "TABLE_CONFIGURATION_LOCKED", "Rules are locked after a player has placed a bet or marked ready");
    throw new HttpError(409, "STALE_STATE", "The table changed before these settings were saved", { currentVersion: latest.state_version });
  }
  return { updated: true, stateVersion, config: publicPayload };
}

export async function closeTable(tableId: string, userId: string) {
  const table = await loadTable(tableId); if (table.owner_user_id !== userId) throw new HttpError(403, "OWNER_REQUIRED", "Only the table owner can close it");
  if (table.status === "in_round") throw new HttpError(409, "ROUND_IN_PROGRESS", "Finish the active round before closing the table");
  await getD1().batch([getD1().prepare("UPDATE tables SET status='closed',updated_at=? WHERE id=?").bind(nowIso(), tableId), getD1().prepare("UPDATE invite_codes SET revoked_at=? WHERE table_id=? AND revoked_at IS NULL").bind(nowIso(), tableId)]); return { closed: true };
}

export async function roundHistory(tableId: string, userId: string) {
  await requireMembership(tableId, userId); const rows = await getD1().prepare("SELECT id,sequence,status,started_at,settled_at FROM game_rounds WHERE table_id=? ORDER BY sequence DESC LIMIT 50").bind(tableId).all(); return rows.results;
}

export async function getUserOverview(userId: string) {
  const db = getD1(); const wallet = await db.prepare("SELECT balance,last_refill_at FROM wallets WHERE user_id=?").bind(userId).first(); const stats = await db.prepare("SELECT * FROM statistics WHERE user_id=?").bind(userId).first(); return { wallet, stats };
}

export async function getLedger(userId: string, limit = 100) {
  const rows = await getD1().prepare("SELECT id,table_id,round_id,amount,reason,balance_before,balance_after,idempotency_key,metadata_json,created_at FROM wallet_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT ?").bind(userId, Math.min(250, Math.max(1, limit))).all(); return rows.results;
}

export async function dailyRefill(userId: string, idempotencyKey: string) {
  const db = getD1(); const wallet = await db.prepare("SELECT balance,version,last_refill_at FROM wallets WHERE user_id=?").bind(userId).first<{ balance: number; version: number; last_refill_at: string | null }>(); if (!wallet) throw new HttpError(404, "WALLET_NOT_FOUND", "Wallet not found");
  if (wallet.last_refill_at && Date.now() - new Date(wallet.last_refill_at).getTime() < 86400_000) throw new HttpError(409, "REFILL_NOT_READY", "The recovery allowance is available once every 24 hours");
  const amount = Number(getRuntimeEnv().DAILY_REFILL_AMOUNT ?? 500); const after = wallet.balance + amount; const at = nowIso();
  await db.batch([db.prepare("INSERT INTO wallet_mutation_locks (user_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(userId, wallet.version, idempotencyKey, at), db.prepare("UPDATE wallets SET balance=?,version=version+1,last_refill_at=?,updated_at=? WHERE user_id=? AND version=?").bind(after, at, at, userId, wallet.version), db.prepare("INSERT INTO wallet_ledger (id,user_id,amount,reason,balance_before,balance_after,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(uid("led"), userId, amount, "DAILY_REFILL", wallet.balance, after, idempotencyKey, at)]); return { amount, balance: after, nextAvailableAt: new Date(Date.now() + 86400_000).toISOString() };
}

export async function adminAdjustWallet(actorUserId: string, targetUserId: string, raw: { operation: string; amount?: number; reason: string }, idempotencyKey: string) {
  const db = getD1(); const wallet = await db.prepare("SELECT balance,version FROM wallets WHERE user_id=?").bind(targetUserId).first<{ balance: number; version: number }>(); if (!wallet) throw new HttpError(404, "USER_NOT_FOUND", "User wallet not found");
  const reason = cleanText(raw.reason, 200); if (reason.length < 3) throw new HttpError(400, "REASON_REQUIRED", "An audit reason is required");
  const amount = Number(raw.amount ?? 0); let after: number;
  if (raw.operation === "grant") after = wallet.balance + Math.abs(amount); else if (raw.operation === "remove") after = Math.max(0, wallet.balance - Math.abs(amount)); else if (raw.operation === "reset") after = Number(getRuntimeEnv().STARTING_BALANCE ?? 10_000); else throw new HttpError(400, "INVALID_OPERATION", "Operation must be grant, remove, or reset");
  if (!Number.isFinite(after) || after < 0 || after > 1_000_000_000) throw new HttpError(400, "INVALID_AMOUNT", "Adjustment amount is invalid");
  const delta = after - wallet.balance; const at = nowIso();
  await db.batch([db.prepare("INSERT INTO wallet_mutation_locks (user_id,from_version,idempotency_key,created_at) VALUES (?,?,?,?)").bind(targetUserId, wallet.version, idempotencyKey, at), db.prepare("UPDATE wallets SET balance=?,version=version+1,updated_at=? WHERE user_id=? AND version=?").bind(after, at, targetUserId, wallet.version), db.prepare("INSERT INTO wallet_ledger (id,user_id,amount,reason,balance_before,balance_after,idempotency_key,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(uid("led"), targetUserId, delta, `ADMIN_${raw.operation.toUpperCase()}`, wallet.balance, after, idempotencyKey, JSON.stringify({ actorUserId, reason }), at), db.prepare("INSERT INTO admin_audit_logs (id,actor_user_id,target_user_id,action,before_json,after_json,reason,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(uid("aud"), actorUserId, targetUserId, `wallet.${raw.operation}`, JSON.stringify({ balance: wallet.balance }), JSON.stringify({ balance: after }), reason, at)]); return { userId: targetUserId, balance: after, delta };
}

export async function adminSetUserStatus(actorUserId: string, targetUserId: string, raw: { status: "active" | "suspended"; reason: string }) {
  if (actorUserId === targetUserId && raw.status === "suspended") throw new HttpError(409, "SELF_SUSPEND_REJECTED", "Use another administrator to suspend this account");
  const reason = cleanText(raw.reason, 200); if (reason.length < 3) throw new HttpError(400, "REASON_REQUIRED", "An audit reason is required");
  const db = getD1(); const user = await db.prepare("SELECT status FROM users WHERE id=?").bind(targetUserId).first<{ status: string }>();
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  const at = nowIso(); const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE users SET status=?,updated_at=? WHERE id=?").bind(raw.status, at, targetUserId),
    db.prepare("INSERT INTO admin_audit_logs (id,actor_user_id,target_user_id,action,before_json,after_json,reason,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(uid("aud"), actorUserId, targetUserId, "account.status", JSON.stringify({ status: user.status }), JSON.stringify({ status: raw.status }), reason, at),
  ];
  if (raw.status === "suspended") statements.push(db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(at, targetUserId));
  await db.batch(statements); return { userId: targetUserId, status: raw.status };
}

export async function leaderboard() {
  const rows = await getD1().prepare(`SELECT u.id,u.display_name,u.avatar_url,s.rounds_played,s.hands_won,s.blackjacks,s.biggest_win,w.balance FROM statistics s JOIN users u ON u.id=s.user_id JOIN wallets w ON w.user_id=u.id WHERE u.is_development=0 OR ?='true' ORDER BY s.hands_won DESC,s.blackjacks DESC LIMIT 25`).bind(getRuntimeEnv().DEV_AUTH_BYPASS ?? "false").all(); return rows.results;
}
