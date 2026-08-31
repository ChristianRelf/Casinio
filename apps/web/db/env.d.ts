declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    DISCORD_CLIENT_ID?: string;
    DISCORD_CLIENT_SECRET?: string;
    DISCORD_REDIRECT_URI?: string;
    DISCORD_ALLOWED_GUILD_ID?: string;
    DISCORD_USER_ALLOWLIST?: string;
    DISCORD_BOT_API_SECRET?: string;
    SESSION_SECRET?: string;
    DEV_AUTH_BYPASS?: string;
    STARTING_BALANCE?: string;
    DAILY_REFILL_AMOUNT?: string;
    APP_ORIGIN?: string;
  }
}
