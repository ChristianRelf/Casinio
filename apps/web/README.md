# Low Stakes

Low Stakes is a private, play-money social blackjack app for friends on Discord. The web app and Discord bot share one authoritative game service and database. Cards, timers, legal actions, balances, payouts, and round recovery are controlled by the server; the browser only presents state and submits intentions.

There are no deposits, purchases, withdrawals, transfers, prizes, crypto assets, or cash-out. Play-money currency has no monetary value.

## What is implemented

- Discord OAuth with state, PKCE, server-side sessions, protected cookies, optional guild and user allowlists, and no browser-visible OAuth tokens
- A companion Discord bot with `/casino`, `/table create`, `/table join`, `/table status`, `/table close`, `/balance`, `/stats`, `/leaderboard`, and `/help`
- Private invites, one to seven seats, spectators, reconnectable membership, chat, designed text reactions, and table ownership
- Server-authoritative blackjack with configurable decks, limits, payout, soft 17, surrender, split rules, insurance, doubles, timers, automated safe actions, recovery, and atomic settlement
- An immutable wallet ledger, wallet/state version locks, idempotency keys, transaction rollback, daily recovery allowances, and audited administration
- Versioned HTTP API and authenticated Server-Sent Events under `/api/v1`
- A reusable game-adapter contract and generic table schema with reserved player-dealer fields
- A responsive isometric table, ten registered dealer poses, a complete local vector card system, state-driven effects, camera shake controls, and local sound cues
- Rules, legal/privacy, profile, history, settings, and role-protected administration pages

The initial release exposes blackjack with an automated dealer only. Player-dealer mode is represented in the data/API contract but is deliberately rejected until a complete implementation exists.

## Repository map

```text
app/                    Web routes and the versioned API
bot/                    Independently runnable Discord bot
components/             Casino UI, table, dealer, and vector cards
db/                     Typed D1 schema and runtime binding
drizzle/                Ordered database migrations
lib/server/             Sessions, OAuth, authorization, and table service
packages/contracts/     Shared API and realtime types
packages/game-core/     Blackjack engine and reusable game adapter
public/assets/          Dealer sprites and local sound library
e2e/                    Two-browser multiplayer test
tests/                  API, database, privacy, ledger, and asset tests
docs/                   API, architecture, and production operations
```

## Requirements

- Node.js 22.13 or newer
- npm
- A Discord application for real sign-in and the bot
- A Cloudflare account and D1 database for production deployment

Local development uses the project-local D1 emulator. Discord credentials are not required to use the three local development identities.

## Local development

From `apps/web`:

```powershell
Copy-Item .env.example .env.local
npm install
npm run db:migrate:local
npm run dev
```

Open `http://localhost:3000`, confirm the play-money/age notice, and use Chris, Maya, or Arthur under `LOCAL DEVELOPMENT`. These identities are created only on demand, carry `is_development = 1`, and never appear in a normal production leaderboard. Chris receives the development administrator role.

Do not set `DEV_AUTH_BYPASS=true` on an internet-accessible deployment. Localhost development sign-in works without it.

## Environment

Copy `.env.example` to an ignored local environment file. Never commit populated secrets.

| Variable | Process | Purpose |
| --- | --- | --- |
| `APP_ORIGIN` | web and bot | Exact public origin, with no trailing path |
| `NEXT_PUBLIC_APP_ORIGIN` | web | Public origin available to the frontend build |
| `CASINO_API_ORIGIN` | bot | Origin of the shared web API |
| `DISCORD_CLIENT_ID` | web and command registration | Discord application ID |
| `DISCORD_CLIENT_SECRET` | web only | OAuth client secret |
| `DISCORD_REDIRECT_URI` | web | Exact OAuth callback URI |
| `DISCORD_ALLOWED_GUILD_ID` | web, optional | Require membership of one Discord server |
| `DISCORD_USER_ALLOWLIST` | web, optional | Comma-separated Discord user IDs |
| `DISCORD_BOT_TOKEN` | bot only | Discord bot token |
| `DISCORD_BOT_API_SECRET` | web and bot | Shared high-entropy secret for bot-only API routes |
| `DISCORD_COMMAND_GUILD_ID` | registration, optional | Register commands immediately in one development guild |
| `SESSION_SECRET` | web | At least 32 characters; HMAC key for session, CSRF, and IP metadata hashes |
| `STARTING_BALANCE` | web | New-account play-money balance |
| `DAILY_REFILL_AMOUNT` | web | Once-per-24-hour recovery allowance |
| `DEV_AUTH_BYPASS` | web | Dangerous non-local development sign-in override; keep `false` in production |

Generate independent secrets rather than reusing a Discord credential:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## Discord application setup

1. Create an application in the Discord Developer Portal.
2. Under OAuth2, add the exact redirect URI from `DISCORD_REDIRECT_URI`. For local development this is `http://localhost:3000/api/v1/auth/discord/callback`.
3. Put the application ID and client secret in the web process environment.
4. Create a bot user and copy its token into the bot process environment only.
5. Install the application with the `bot` and `applications.commands` scopes. The bot needs View Channels, Send Messages, Embed Links, and Read Message History in channels where tables may be hosted. It does not require privileged gateway intents.
6. Register slash commands:

```powershell
npm run bot:register
```

Set `DISCORD_COMMAND_GUILD_ID` while developing for immediate guild-scoped registration. Omit it for global registration in production; Discord may take time to propagate global commands.

7. Start the independently deployable bot process:

```powershell
npm run bot
```

The bot authenticates to `/api/v1/bot/*` with `DISCORD_BOT_API_SECRET`, retries transient and rate-limit responses, polls linked table versions every 15 seconds, and only announces round starts, settlement, or meaningful seat-count changes.

Users must sign in to the web app once before bot commands that need a linked casino account can succeed.

## Restricting access

- Set `DISCORD_ALLOWED_GUILD_ID` to require OAuth users to belong to one Discord server. This adds the `guilds` OAuth scope and checks membership during sign-in.
- Set `DISCORD_USER_ALLOWLIST` to a comma-separated list of Discord user IDs for a stricter private group.
- If both are set, both checks must pass.
- Tables are private by default. Unauthenticated users and authenticated non-members cannot read table state, event streams, history, or bot status.

## Database and migrations

The production binding is named `DB`. Migrations are ordered in `drizzle/`; the application never creates schema at request time.

Apply local migrations:

```powershell
npm run db:migrate:local
```

Apply the same migrations to the production D1 database through the deployment platform before routing production traffic. Do not edit a migration already applied to a shared environment; generate and review a new one.

Development identities are seeded by local sign-in rather than by a production seed. No pretend live tables or player counts are inserted.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

`npm test` covers the deterministic blackjack engine, privacy, authorization, sessions/CSRF, idempotency, database rollback, wallet consistency, Discord commands, all 52 card faces, the card back, all dealer poses, and local sound files.

`npm run test:e2e` starts the local D1-backed app and drives two isolated Chromium users through sign-in, private table creation, invite join, seating, betting, a complete synchronized round, settlement, ledger checks, reload/reconnect, and the start of the next round.

## Administration and play-money recovery

Administrators use `/admin`. Every grant, removal, reset, suspension, and recovery allowance is recorded; wallet changes also create immutable ledger rows.

The API equivalents are:

- `POST /api/v1/admin/users/:userId/wallet` with `grant`, `remove`, or `reset`
- `POST /api/v1/admin/users/:userId/status` with `active` or `suspended`
- `POST /api/v1/me/refill` for the configured daily recovery allowance

All mutating requests require the CSRF token and an `Idempotency-Key`. There is no player-to-player transfer endpoint.

## Supplied art and audio

Dealer PNGs live in `public/assets/dealer/source/`. All ten images use a 1600 by 1600 canvas and registration point `x: 2205, y: 304`, recorded in `sprite-manifest.json`. The development-only gallery is `/dev/dealer`.

The complete vector card renderer is verified at `/dev/deck` in development and is not dependent on a remote deck service.

Original audio drops live under `public/assets/sounds/source/`. Runtime mappings are in `sound-manifest.json` and `lib/client/sound.ts`. Preserve the Kenney pack's original license document alongside the source pack and retain provenance for custom sounds before production distribution.

## Further documentation

- [API and realtime reference](docs/API.md)
- [Architecture and adding another game](docs/ARCHITECTURE.md)
- [Production operations and deployment checklist](docs/OPERATIONS.md)
