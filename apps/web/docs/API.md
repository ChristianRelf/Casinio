# API and realtime reference

All application routes are versioned under `/api/v1`. JSON responses use one envelope:

```json
{
  "ok": true,
  "data": {},
  "requestId": "req_..."
}
```

Errors are stable, machine-readable responses:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_STATE",
    "message": "The table changed before that action arrived"
  },
  "requestId": "req_..."
}
```

## Request security

- Browser authentication uses the HttpOnly `ls_session` cookie. OAuth tokens are never sent to browser JavaScript.
- Browser mutations require the readable `ls_csrf` cookie value in `X-CSRF-Token` and an exact matching `Origin`.
- Balance-changing and table mutations require an `Idempotency-Key` between 8 and 100 characters. Repeating the same method, route, body, and key replays the stored response. Reusing the key for different input returns `IDEMPOTENCY_CONFLICT`.
- Game actions also require the client's last observed `expectedVersion`; stale and out-of-turn actions are rejected.
- Bot routes require `Authorization: Bearer <DISCORD_BOT_API_SECRET>` and do not accept browser sessions.

## Authentication and account

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Process liveness; does not query the database |
| `GET` | `/readiness` | Database readiness check |
| `GET` | `/auth/discord?ageConfirmed=true` | Start Discord OAuth with state and PKCE |
| `GET` | `/auth/discord/callback` | Complete OAuth and issue the session |
| `POST` | `/auth/dev` | Local development identity only |
| `GET` | `/auth/session` | Current session user and CSRF token, or `null` |
| `POST` | `/auth/logout` | Revoke the current server-side session |
| `GET` | `/me` | User, wallet, and statistics |
| `GET` | `/me/ledger?limit=100` | Authenticated user's ledger, maximum 250 rows |
| `POST` | `/me/refill` | Once-per-24-hour play-money recovery allowance |
| `GET` | `/leaderboard` | Social blackjack standings |

## Tables

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/tables` | Tables visible to or joined by the current user |
| `POST` | `/tables` | Create a table and initial invite |
| `POST` | `/tables/join` | Join by invite code as a spectator |
| `GET` | `/invites/:code` | Validate a code without consuming a use |
| `GET` | `/tables/:id` | Combined table, people, public state, own private state, and chat |
| `GET` | `/tables/:id/public-state` | Public member-visible state only |
| `GET` | `/tables/:id/private-state` | Current member and authenticated player's private state |
| `GET` | `/tables/:id/stream?since=:version` | Authenticated event stream |
| `GET` | `/tables/:id/history` | Up to 50 rounds |
| `POST` | `/tables/:id/seat` | Take a numbered seat |
| `POST` | `/tables/:id/release-seat` | Release a seat between rounds |
| `POST` | `/tables/:id/leave` | Leave, or mark disconnected while a round safely retains the seat |
| `POST` | `/tables/:id/bet` | Place or change the next-round bet |
| `POST` | `/tables/:id/ready` | Change ready state; the final ready player starts the round |
| `POST` | `/tables/:id/action` | Submit one authoritative game action |
| `POST` | `/tables/:id/chat` | Sanitized message or approved designed reaction |
| `POST` | `/tables/:id/invites` | Owner creates another expiring invite |
| `PATCH` | `/tables/:id/config` | Owner changes table/game settings between rounds |
| `POST` | `/tables/:id/close` | Owner closes an idle table and revokes invites |

Create-table example:

```http
POST /api/v1/tables
Content-Type: application/json
X-CSRF-Token: <cookie value>
Idempotency-Key: 663b1bea-30f5-4d10-a309-3f1c8c7cc36a
```

```json
{
  "name": "Friday table",
  "maxSeats": 7,
  "minBet": 25,
  "maxBet": 500,
  "deckCount": 6,
  "blackjackPayout": 1.5,
  "dealerHitsSoft17": false,
  "allowSurrender": true,
  "visibility": "private"
}
```

Action example:

```json
{
  "action": { "type": "stand" },
  "expectedVersion": 14
}
```

Action types are `hit`, `stand`, `double`, `split`, `surrender`, `insurance`, and `decline_insurance`. The server derives allowed actions from authoritative state and wallet balance. Extra card, total, payout, shoe, actor, or balance fields are ignored by schema validation or rejected.

Configuration reserves future dealer ownership but does not pretend it is available:

```json
{
  "dealerMode": "player",
  "dealerUserId": "usr_..."
}
```

The current release responds with `PLAYER_DEALER_NOT_ENABLED`. The production UI never exposes this control.

## Table state and privacy

`GET /tables/:id` returns one authenticated view:

```json
{
  "table": {
    "id": "tbl_...",
    "gameType": "blackjack",
    "dealerMode": "automated",
    "status": "in_round",
    "stateVersion": 14
  },
  "people": [
    {
      "userId": "usr_...",
      "role": "player",
      "connectionStatus": "connected",
      "seatNumber": 4,
      "ready": false,
      "pendingBet": 100
    }
  ],
  "publicState": {
    "roundId": "rnd_...",
    "phase": "player_turns",
    "stateVersion": 14,
    "dealer": {
      "cards": [
        { "id": "...", "rank": "10", "suit": "club", "deck": 2 },
        { "id": "...", "hidden": true }
      ],
      "holeRevealed": false
    },
    "shoe": { "remaining": 307, "initialSize": 312 }
  },
  "privateState": {
    "userId": "usr_...",
    "allowedActions": ["hit", "stand", "double", "surrender"],
    "actionDeadlineAt": "2026-09-01T20:15:25.000Z"
  },
  "serverTime": "2026-09-01T20:15:03.100Z"
}
```

The public shoe contains counts only. It never contains the remaining card array, the next card, or a shoe position. The dealer hole card is replaced with `{ "hidden": true }` until the authoritative reveal. Private state is serialized for the requesting user only.

## Realtime stream

Connect with the current table version:

```text
GET /api/v1/tables/tbl_123/stream?since=14
Accept: text/event-stream
Cookie: ls_session=...
```

The server verifies membership before opening the stream. It emits `table-event` records and heartbeats, then closes periodically so browsers reconnect cleanly with `Last-Event-ID` or the latest `since` value.

```text
id: 15
event: table-event
data: {"id":"evt_...","version":15,"tableId":"tbl_123","roundId":"rnd_456","type":"hand.stood","timestamp":"2026-09-01T20:15:10.000Z","publicPayload":{"handId":"hand_...","total":18}}
```

Envelope fields:

| Field | Meaning |
| --- | --- |
| `id` | Unique event identifier |
| `version` | Monotonic table state version; multiple events may share one committed version |
| `tableId` | Owning table |
| `roundId` | Round when applicable |
| `type` | Reusable event name such as `turn.started`, `card.dealt`, or `round.settled` |
| `timestamp` | Server UTC timestamp |
| `publicPayload` | Member-visible payload only |
| `privatePayload` | Optional payload selected only for the authenticated user |

Clients should treat an event as a prompt to fetch current state, ignore versions they already applied, and fetch a full snapshot after a gap. The included client does this and also polls as a fallback.

## Administration

| Method | Route | Required role |
| --- | --- | --- |
| `GET` | `/admin/users` | `admin` |
| `GET` | `/admin/audit` | `admin` |
| `POST` | `/admin/users/:id/wallet` | `admin` |
| `POST` | `/admin/users/:id/status` | `admin` |

Wallet adjustment body:

```json
{
  "operation": "grant",
  "amount": 500,
  "reason": "Hosted game-night recovery grant"
}
```

`remove` never takes a wallet below zero. `reset` ignores `amount` and restores `STARTING_BALANCE`. Every call writes an admin audit record and one wallet ledger record in the same database transaction.

## Bot-only routes

Bot routes live under `/api/v1/bot` and require the shared bearer secret.

| Method | Route | Use |
| --- | --- | --- |
| `POST` | `/bot/tables` | Create a table for a linked Discord identity |
| `GET` | `/bot/invites/:code` | Validate an invite |
| `GET` | `/bot/tables/:id/status?discordUserId=...` | Authorized member status |
| `POST` | `/bot/tables/:id/close` | Owner close |
| `POST` | `/bot/tables/:id/discord-link` | Link a Discord channel/message |
| `GET` | `/bot/table-links` | Poll linked table versions |
| `POST` | `/bot/tables/:id/discord-link/ack` | Advance announcement cursor |
| `GET` | `/bot/users/:discordId/balance` | Linked wallet |
| `GET` | `/bot/users/:discordId/stats` | Linked statistics |
| `GET` | `/bot/leaderboard` | Social standings |

## Common rejection codes

- `AUTH_REQUIRED`, `AGE_CONFIRMATION_REQUIRED`, `ADMIN_REQUIRED`, `BOT_AUTH_REQUIRED`
- `INVALID_ORIGIN`, `CSRF_REJECTED`, `IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_CONFLICT`
- `TABLE_ACCESS_DENIED`, `OWNER_REQUIRED`, `SEAT_REQUIRED`, `SEAT_UNAVAILABLE`
- `ROUND_IN_PROGRESS`, `NO_ACTIVE_ROUND`, `STALE_STATE`, `ACTION_REJECTED`
- `BET_OUTSIDE_LIMITS`, `INSUFFICIENT_BALANCE`, `REFILL_NOT_READY`
- `PLAYER_DEALER_NOT_ENABLED`, `RATE_LIMITED`, `VALIDATION_ERROR`
