# Architecture

## Trust boundary

The browser is untrusted. It can request a bet amount or action, but it cannot create a card, choose a shoe position, set a result, advance a turn, or write a balance.

The request path is:

```text
Discord OAuth or protected session
  -> /api/v1 validation, CSRF, origin, authorization, rate limit
    -> table service and state/version locks
      -> game adapter validation and transition
        -> one D1 transaction for state, events, actions, hands, ledger, and statistics
          -> public/private serializers
            -> SSE event plus snapshot refresh in each member client
```

The Discord bot uses the same API and table rows. It has no game simulation, shoe, or wallet implementation of its own.

## Shared table infrastructure

The `tables` row carries `game_type`, owner, visibility, dealer mode/user, seats, limits, rules, current round, serialized authoritative state, and one monotonic `state_version`. Membership, seats, spectators, invites, chat, rounds, participants, actions, events, and Discord links are game-neutral tables. Membership presence is lease-like: active snapshots and streams touch `last_seen_at`, stale members become disconnected while seats remain recoverable, and an explicit mid-round departure is finalized only after settlement.

Player-controlled dealer ownership is represented by `dealer_mode`, `dealer_user_id`, and the `dealer` membership role. Requests selecting that mode are rejected in this release so an incomplete feature cannot be exposed accidentally.

## Game adapter

`packages/game-core/src/index.ts` defines:

```ts
interface GameAdapter<TState, TAction> {
  readonly gameType: GameType;
  createInitialState(input: unknown): TState;
  validateAction(state: TState, actorUserId: string, action: TAction, availableBalance: number): string | null;
  applyAction(state: TState, actorUserId: string, action: TAction, availableBalance: number, now?: Date): ActionResult;
  applyTimeout(state: TState, now?: Date): ActionResult;
  serializePublicState(state: TState): unknown;
  serializePrivateState(state: TState, userId: string, availableBalance: number): unknown;
  recoverState(state: TState, now?: Date): ActionResult;
  runAutomatedHost(state: TState, now?: Date): ActionResult;
}
```

`blackjackAdapter` is the first implementation. Its state owns the shoe, rules, players, hands, dealer, turn, deadline, local engine version, and bounded event history. Shuffling uses rejection-sampled `crypto.getRandomValues`; `Math.random()` is never used for outcomes.

## Adding another game

1. Extend `GameType` in the game core and contracts.
2. Implement a new adapter in its own package or module. Keep its complete authoritative state serializable and free of browser-only objects.
3. Define strict action and settings schemas. An action must be validated again inside the adapter even if the route already parsed it.
4. Return wallet adjustments and semantic events from transitions. Do not update D1 or wallets from the adapter.
5. Add the adapter to the server registry/dispatch path selected by `tables.game_type`.
6. Add game-neutral persistence mapping for any hands/cards needed for history; create game-specific tables only when the generic action/event records cannot represent the data cleanly.
7. Implement public serialization that removes all secret order, hidden information, random seed material, and other players' private state. Add authenticated per-player serialization separately.
8. Implement timeout recovery and automated-host behavior. Recovery must either continue deterministically from persisted state or return complete refunds.
9. Add deterministic engine tests, hidden-information tests, rollback tests, realtime tests, and a two-player browser flow before exposing creation in the lobby.
10. Add a deliberate UI route and assets only after the server implementation is complete. Do not add disabled or pretend controls.

For a player-controlled host, also implement dealer eligibility, handoff, disconnect policy, private dealer state, abuse limits, and an auditable fallback to automated/cancelled settlement before allowing `dealerMode: "player"`.

## State and concurrency

Every table transition carries the last observed table version. `state_transition_locks` prevents two mutations from committing from the same version. `wallet_mutation_locks` does the equivalent for wallets. `Idempotency-Key` stores the response associated with method, route, and request body.

Settlement builds one batch containing:

- the state-transition lock;
- authoritative round/table state;
- the accepted player action;
- semantic game events and a public snapshot;
- wallet ledger entries and optimistic wallet versions;
- final hands and cards;
- participant outcome and statistics;
- reset next-round readiness.

The database either commits the batch or rolls it back. Tests install a trigger that forces a payout write to fail and verify that the state, wallet, action, and hand writes all remain unchanged.

## Recovery

Authoritative state is persisted after every accepted transition. Snapshot reads also recover expired turns using safe adapter actions. If a legacy lock or interrupted transition means the server cannot prove a safe continuation, the round is cancelled and all main-hand, split, double, and insurance exposure is restored through ledger entries.

Leaving during an active round marks the membership disconnected and retains its seat. Loading the table marks an authenticated member connected again and reconstructs the allowed actions from current server state.

## Privacy

- Session, CSRF, and IP metadata are HMAC-hashed with `SESSION_SECRET`.
- Discord access tokens are used server-side during the callback and are not persisted as browser credentials.
- Invite codes are stored as hashes with a non-secret prefix for support.
- The remaining shoe array stays only in authoritative state.
- Public state exposes shoe counts and replaces an unrevealed dealer hole card with a hidden marker.
- Event streams require membership and select any private payload by authenticated user ID.
- Chat is length-limited and sanitized; reactions come from a fixed text vocabulary.

## Presentation state

Animations are downstream of committed state. Cards animate when serialized card counts change, the dealer pose follows phase/outcome, balances count to the server value, and result effects use settled `resultAmount`. Shake is scoped to `.game-presentation`, capped by result size, disabled by the user setting, and removed by reduced-motion rules.

Dealer sprites are rendered on a stable common canvas. All PNGs use the manifest registration point, so pose changes do not move the NPC relative to the table.
