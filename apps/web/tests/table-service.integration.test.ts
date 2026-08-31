import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createBlackjackRound, createOrderedShoe, type Card, type Suit } from "../packages/game-core/src";
import type { SessionUser } from "../packages/contracts/src";
import { createSession, getSession, HttpError, requireCsrf, requireIdempotency, saveIdempotentResult, validateOrigin } from "../lib/server/runtime";
import { createTable, getEvents, getTableState, joinWithInvite, leaveTable, listTables, markReady, placeBet, submitAction, takeSeat } from "../lib/server/table-service";
import { TestD1Database } from "./d1-test-db";

const c = (rank: Card["rank"], suit: Suit = "spade") => ({ rank, suit });
const at = "2026-08-31T12:00:00.000Z";
const env = workerEnv as unknown as Record<string, unknown>;
let database: TestD1Database;

function user(id: string, displayName: string): SessionUser {
  return { id, displayName, avatarUrl: null, balance: 1_000, roles: [], ageConfirmed: true, isDevelopment: true };
}

async function seedUser(value: SessionUser, balance = 1_000) {
  await database.prepare("INSERT INTO users (id,display_name,age_confirmed_at,status,is_development,created_at,updated_at) VALUES (?,?,?,'active',1,?,?)").bind(value.id, value.displayName, at, at, at).run();
  await database.prepare("INSERT INTO wallets (user_id,balance,version,updated_at) VALUES (?,?,0,?)").bind(value.id, balance, at).run();
  await database.prepare("INSERT INTO statistics (user_id,updated_at) VALUES (?,?)").bind(value.id, at).run();
}

async function installSchema() {
  for (const filename of ["0000_material_chamber.sql", "0001_past_mandroid.sql", "0002_motionless_madelyne_pryor.sql", "0003_medical_hellcat.sql"]) {
    await database.exec(readFileSync(join(process.cwd(), "drizzle", filename), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  await database.exec("PRAGMA foreign_keys = ON");
}

async function deterministicRound(players: SessionUser[]) {
  const owner = players[0];
  const created = await createTable(owner, { name: "Integration table", maxSeats: 7, minBet: 25, maxBet: 500, deckCount: 6, visibility: "private" });
  for (let index = 1; index < players.length; index += 1) await joinWithInvite(players[index].id, created.inviteCode);
  for (let index = 0; index < players.length; index += 1) {
    await takeSeat(created.tableId, players[index].id, index + 1);
    await placeBet(created.tableId, players[index].id, 100, `bet-${players[index].id}-${crypto.randomUUID()}`);
  }

  const roundId = `rnd_${crypto.randomUUID()}`;
  const draws = players.length === 2
    ? [c("10"), c("9"), c("10", "heart"), c("7"), c("8"), c("7", "diamond")]
    : [c("10"), c("10", "heart"), c("7"), c("7", "diamond")];
  const state = createBlackjackRound({
    roundId,
    participants: players.map((player, index) => ({ userId: player.id, seat: index + 1, displayName: player.displayName, bet: 100 })),
    shoe: createOrderedShoe(draws),
    now: new Date(),
  });
  await database.prepare("INSERT INTO game_rounds (id,table_id,sequence,game_type,status,rules_json,authoritative_state_json,started_at) VALUES (?,?,1,'blackjack','active',?,?,?)")
    .bind(roundId, created.tableId, JSON.stringify(state.rules), JSON.stringify(state), state.startedAt).run();
  await database.prepare("UPDATE tables SET status='in_round',game_state_json=?,current_round_id=?,state_version=? WHERE id=?")
    .bind(JSON.stringify(state), roundId, state.stateVersion, created.tableId).run();
  for (let index = 0; index < players.length; index += 1) {
    await database.prepare("INSERT INTO round_participants (round_id,user_id,seat_number,starting_balance) VALUES (?,?,?,1000)").bind(roundId, players[index].id, index + 1).run();
    await database.prepare("INSERT INTO bets (id,round_id,user_id,type,amount,status,created_at) VALUES (?,?,?,'main',100,'committed',?)").bind(`betrow_${crypto.randomUUID()}`, roundId, players[index].id, at).run();
  }
  return { ...created, roundId, state };
}

beforeEach(async () => {
  database = await TestD1Database.create();
  env.DB = database as unknown as D1Database;
  env.APP_ORIGIN = "http://localhost:3000";
  env.STARTING_BALANCE = "1000";
  env.DAILY_REFILL_AMOUNT = "500";
  await installSchema();
});

afterEach(() => database.close());

describe("authentication and request protection", () => {
  it("creates server-side sessions and enforces CSRF, origin, and suspension", async () => {
    const chris = user("u1", "Chris"); await seedUser(chris);
    const issued = await createSession(new Request("http://localhost:3000/api/v1/auth/dev", { headers: { "user-agent": "integration-test" } }), chris.id);
    const cookie = issued.cookies[0].split(";", 1)[0];
    const authenticated = new Request("http://localhost:3000/api/v1/me", { headers: { cookie } });
    expect((await getSession(authenticated))?.user.id).toBe(chris.id);
    await expect(requireCsrf(new Request("http://localhost:3000/api/v1/tables", { method: "POST", headers: { cookie } }), (await getSession(authenticated))!)).rejects.toMatchObject({ code: "CSRF_REJECTED" });
    await expect(requireCsrf(new Request("http://localhost:3000/api/v1/tables", { method: "POST", headers: { cookie, "x-csrf-token": issued.csrfToken } }), (await getSession(authenticated))!)).resolves.toBeUndefined();
    expect(() => validateOrigin(new Request("http://localhost:3000/api/v1/tables", { method: "POST", headers: { origin: "https://attacker.invalid" } }))).toThrowError(HttpError);
    await database.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(chris.id).run();
    expect(await getSession(authenticated)).toBeNull();
  });

  it("replays an idempotent response and rejects key reuse with a different body", async () => {
    await seedUser(user("u1", "Chris"));
    const key = "test-key-123456";
    const firstRequest = new Request("http://localhost:3000/api/v1/test", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ amount: 25 }) });
    const first = await requireIdempotency(firstRequest, "u1", "/test");
    expect(first.replay).toBeNull();
    await saveIdempotentResult({ key, userId: "u1", route: "/test", requestHash: first.requestHash, status: 200, response: { ok: true, data: { balance: 975 } } });
    const replay = await requireIdempotency(new Request("http://localhost:3000/api/v1/test", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ amount: 25 }) }), "u1", "/test");
    expect(replay.replay?.headers.get("x-idempotent-replay")).toBe("true");
    await expect(requireIdempotency(new Request("http://localhost:3000/api/v1/test", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ amount: 50 }) }), "u1", "/test")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});

describe("durable multiplayer table service", () => {
  it("keeps private tables membership-only and records every bet atomically", async () => {
    const chris = user("u1", "Chris"); const maya = user("u2", "Maya");
    await seedUser(chris); await seedUser(maya);
    const created = await createTable(chris, { name: "Private room", maxSeats: 3, minBet: 25, maxBet: 500, deckCount: 6, visibility: "private" });
    expect(await listTables(maya.id)).toEqual([]);
    await expect(getTableState(created.tableId, maya.id)).rejects.toMatchObject({ code: "TABLE_ACCESS_DENIED" });
    await joinWithInvite(maya.id, created.inviteCode);
    expect((await listTables(maya.id)).map(table => table.id)).toContain(created.tableId);
    await takeSeat(created.tableId, maya.id, 2);
    await placeBet(created.tableId, maya.id, 100, "maya-bet-0001");
    const wallet = await database.prepare("SELECT balance,version FROM wallets WHERE user_id=?").bind(maya.id).first<{ balance: number; version: number }>();
    const ledger = await database.prepare("SELECT amount,reason,balance_before,balance_after FROM wallet_ledger WHERE user_id=?").bind(maya.id).all<Record<string, number | string>>();
    expect(wallet).toMatchObject({ balance: 900, version: 1 });
    expect(ledger.results).toEqual([{ amount: -100, reason: "BET_PLACED", balance_before: 1000, balance_after: 900 }]);
    await expect(placeBet(created.tableId, maya.id, 500, "maya-bet-0002")).resolves.toMatchObject({ balance: 500 });
    await expect(placeBet(created.tableId, maya.id, 500, "maya-bet-0003")).resolves.toMatchObject({ balance: 500 });
    expect((await database.prepare("SELECT SUM(amount) AS total FROM wallet_ledger WHERE user_id=?").bind(maya.id).first<{ total: number }>())?.total).toBe(-500);
    expect(await database.prepare("SELECT balance,version FROM wallets WHERE user_id=?").bind(maya.id).first()).toMatchObject({ balance: 500, version: 2 });
    expect((await database.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE user_id=?").bind(maya.id).first<{ count: number }>())?.count).toBe(2);
  });

  it("synchronizes two players, restores reconnect state, hides the shoe, and settles once", async () => {
    const chris = user("u1", "Chris"); const maya = user("u2", "Maya"); const outsider = user("u3", "Arthur");
    await seedUser(chris); await seedUser(maya); await seedUser(outsider);
    const setup = await deterministicRound([chris, maya]);
    await expect(getTableState(setup.tableId, outsider.id)).rejects.toMatchObject({ code: "TABLE_ACCESS_DENIED" });
    const before = await getTableState(setup.tableId, chris.id);
    expect(before.publicState?.dealer.cards[1]).toMatchObject({ hidden: true });
    expect(before.publicState?.shoe).toMatchObject({ initialSize: 6, remaining: 0 });
    expect((before.publicState?.shoe as { cards?: unknown }).cards).toBeUndefined();
    expect(before.privateState?.player?.userId).toBe(chris.id);
    expect(before.privateState?.allowedActions).toContain("stand");

    const first = await submitAction(setup.tableId, chris.id, { type: "stand" }, setup.state.stateVersion, "action-chris-0001");
    await expect(submitAction(setup.tableId, maya.id, { type: "stand" }, setup.state.stateVersion, "action-maya-stale")).rejects.toMatchObject({ code: "STALE_STATE" });
    expect(await leaveTable(setup.tableId, maya.id)).toEqual({ left: false, seatHeldUntilRoundEnd: true });
    const reconnected = await getTableState(setup.tableId, maya.id);
    expect(reconnected.people.find(person => person.userId === maya.id)).toMatchObject({ connectionStatus: "connected", seatNumber: 2 });
    expect(reconnected.privateState?.allowedActions).toContain("stand");

    const settled = await submitAction(setup.tableId, maya.id, { type: "stand" }, first.stateVersion, "action-maya-0001");
    expect(settled.phase).toBe("settled");
    await expect(submitAction(setup.tableId, maya.id, { type: "stand" }, settled.stateVersion, "action-maya-duplicate")).rejects.toMatchObject({ code: "NO_ACTIVE_ROUND" });
    const wallets = await database.prepare("SELECT user_id,balance FROM wallets ORDER BY user_id").all<{ user_id: string; balance: number }>();
    expect(wallets.results).toEqual([{ user_id: "u1", balance: 1000 }, { user_id: "u2", balance: 1000 }, { user_id: "u3", balance: 1000 }]);
    const payouts = await database.prepare("SELECT user_id,COUNT(*) AS count FROM wallet_ledger WHERE reason='PAYOUT' GROUP BY user_id ORDER BY user_id").all<{ user_id: string; count: number }>();
    expect(payouts.results).toEqual([{ user_id: "u1", count: 1 }, { user_id: "u2", count: 1 }]);
    const stats = await database.prepare("SELECT user_id,rounds_played,hands_pushed FROM statistics WHERE user_id IN ('u1','u2') ORDER BY user_id").all();
    expect(stats.results).toEqual([{ user_id: "u1", rounds_played: 1, hands_pushed: 1 }, { user_id: "u2", rounds_played: 1, hands_pushed: 1 }]);
    const events = await getEvents(setup.tableId, chris.id, 0);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map(event => event.version)).toEqual([...events.map(event => event.version)].sort((a, b) => a - b));
    expect(JSON.stringify(events)).not.toContain("shoePosition");
  });

  it("converges simultaneous final-ready requests on one authoritative round", async () => {
    const chris = user("u1", "Chris"); const maya = user("u2", "Maya");
    await seedUser(chris); await seedUser(maya);
    const created = await createTable(chris, { name: "Ready race", maxSeats: 7, minBet: 25, maxBet: 500, deckCount: 6, visibility: "private" });
    await joinWithInvite(maya.id, created.inviteCode);
    await takeSeat(created.tableId, chris.id, 4); await takeSeat(created.tableId, maya.id, 3);
    await placeBet(created.tableId, chris.id, 25, "ready-race-bet-chris"); await placeBet(created.tableId, maya.id, 25, "ready-race-bet-maya");
    const results = await Promise.all([
      markReady(created.tableId, chris.id, true, "ready-race-chris"),
      markReady(created.tableId, maya.id, true, "ready-race-maya"),
    ]);
    expect(results.every((result) => result.roundStarted)).toBe(true);
    expect(new Set(results.map((result) => result.roundId)).size).toBe(1);
    const rounds = await database.prepare("SELECT COUNT(*) AS count FROM game_rounds WHERE table_id=?").bind(created.tableId).first<{ count: number }>();
    expect(rounds?.count).toBe(1);
    expect(await database.prepare("SELECT status,current_round_id FROM tables WHERE id=?").bind(created.tableId).first()).toMatchObject({ status: "in_round", current_round_id: results[0].roundId });
  });

  it("rolls back the entire settlement if one durable write fails", async () => {
    const chris = user("u1", "Chris"); await seedUser(chris);
    const setup = await deterministicRound([chris]);
    await database.exec("CREATE TRIGGER reject_payout BEFORE INSERT ON wallet_ledger WHEN NEW.reason='PAYOUT' BEGIN SELECT RAISE(ABORT, 'forced payout failure'); END;");
    await expect(submitAction(setup.tableId, chris.id, { type: "stand" }, setup.state.stateVersion, "rollback-action-0001")).rejects.toThrow(/forced payout failure/);
    const table = await database.prepare("SELECT status,state_version FROM tables WHERE id=?").bind(setup.tableId).first();
    const wallet = await database.prepare("SELECT balance,version FROM wallets WHERE user_id=?").bind(chris.id).first();
    const actions = await database.prepare("SELECT COUNT(*) AS count FROM player_actions WHERE table_id=?").bind(setup.tableId).first<{ count: number }>();
    const hands = await database.prepare("SELECT COUNT(*) AS count FROM hands WHERE round_id=?").bind(setup.roundId).first<{ count: number }>();
    expect(table).toMatchObject({ status: "in_round", state_version: setup.state.stateVersion });
    expect(wallet).toMatchObject({ balance: 900, version: 1 });
    expect(actions?.count).toBe(0);
    expect(hands?.count).toBe(0);
  });
});
