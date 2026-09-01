# Production operations

## Deployment shape

Deploy two processes against one API/database authority:

1. The web worker hosts React routes, `/api/v1`, Server-Sent Events, Discord OAuth, and the `DB` binding.
2. The Discord bot is a long-running Node.js 22 process running `npm run bot`. It calls the web API with `DISCORD_BOT_API_SECRET` and stores no separate game state.

Do not run two databases for web and bot. Do not put the bot token, Discord client secret, session secret, database credentials, or bot API secret in `NEXT_PUBLIC_*` variables.

## Pre-deployment checklist

- Set a private production origin and the exact matching OAuth callback.
- Generate independent high-entropy `SESSION_SECRET` and `DISCORD_BOT_API_SECRET` values.
- Keep `DEV_AUTH_BYPASS=false` for every shared or public deployment. It may be enabled temporarily on an owner-only test deployment and must be disabled before access is widened.
- Configure `DISCORD_ALLOWED_GUILD_ID`, `DISCORD_USER_ALLOWLIST`, or both before sharing the URL.
- Bind the production D1 database as `DB` and apply every migration in order.
- Set `STARTING_BALANCE` and `DAILY_REFILL_AMOUNT` as policy values, not real currency claims.
- Review the location-specific minimum-age wording and legal/privacy copy.
- Assign administrator roles to the minimum number of accounts.
- Install the bot with only the documented channel permissions and no privileged intents.
- Register global commands after guild-scoped testing succeeds.
- Preserve license/provenance files for the supplied dealer and audio assets.
- Run the complete verification command set against the release commit.
- Confirm `/api/v1/health` and `/api/v1/readiness` before inviting users.

## Build and migration order

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Apply migrations before the new application version receives traffic. Back up or export the production D1 database through the provider's supported workflow before schema changes. A failed migration should stop deployment; never let request handlers improvise missing tables.

## Discord cutover

1. Deploy the web origin and verify health/readiness.
2. Update `DISCORD_REDIRECT_URI` in both the Discord application and web environment.
3. Complete one real Discord sign-in and confirm display-name/avatar update, age confirmation, and allowlist behavior.
4. Run `npm run bot:register` with a test guild ID.
5. Start the bot and exercise create, join, status, close, balance, stats, leaderboard, and help.
6. Remove the guild ID and register global commands when ready.
7. Monitor structured bot logs for `ready`, `command`, `discord_rate_limited`, and `table_link_poll_failed`.

## Health and monitoring

- `/api/v1/health` proves the worker can answer.
- `/api/v1/readiness` performs a database query.
- API errors include `requestId`; retain it in user support reports.
- Unexpected server errors are emitted as structured JSON and call `globalThis.reportError` when the host provides it.
- The bot logs structured JSON and has handlers for Discord warnings, errors, rate limits, `SIGINT`, and `SIGTERM`.
- Alert on readiness failures, elevated 5xx/429 rates, repeated stale-state conflicts, table recovery cancellations, failed bot polls, and abnormal ledger adjustments.

## Currency operations

Use `/admin` or the documented admin API. Every adjustment needs a human-readable reason.

- `grant` adds play money.
- `remove` subtracts play money without going below zero.
- `reset` restores `STARTING_BALANCE`.
- `POST /me/refill` gives the configured allowance no more than once per 24 hours.

Never modify the `wallets` table directly in normal operations. Direct edits bypass the ledger, mutation lock, audit log, and balance-before/after evidence.

When investigating a balance:

1. Find the wallet and its version.
2. Read the user's ledger in timestamp order.
3. Group round-linked entries by `round_id`.
4. Confirm each `idempotency_key` is unique.
5. Compare the ledger's chained before/after balances with the current wallet.
6. If a correction is necessary, use an audited admin adjustment rather than editing history.

## Incident handling

### Discord secret or bot token exposure

Rotate it at Discord or in the deployment secret store, update the relevant process, restart, and review bot-only API logs. Never put the replacement in chat, source control, or client configuration.

### Session secret exposure

Rotate `SESSION_SECRET` and redeploy. Existing session cookies will no longer match their stored HMAC hashes, effectively signing everyone out. Revoke old session rows during cleanup.

### Unsafe active round

Do not manually choose a result. Let recovery use persisted state. If deterministic continuation is impossible, cancel through the service path so every committed wager is restored and recorded.

### Database write failure during settlement

The transaction rolls back. Keep the service available if readiness is healthy; the next authenticated snapshot can retry deterministic recovery. If readiness is failing, stop new traffic and restore database service first.

### Bot outage

Web tables continue because the bot is not the game host process. Restart the bot; its persisted link cursor prevents replaying old channel announcements.

## Data retention and access

Choose and publish retention periods for sessions, chat, event history, OAuth metadata, and operational logs before production use. Ledger, round, action, and audit history should be retained long enough to investigate balance integrity. Restrict raw authoritative state and card history to operators who need it.

Suspending an account revokes its active sessions. Closing a table revokes live invites but retains auditable game history.

## Release rollback

Application rollback is safe only when the previous version understands the current schema. Prefer additive migrations and forward fixes. If a release changes authoritative state shape, include version-aware deserialization or a migration before deployment; never roll back into code that can misread an active round.
