export type ApiEnvelope<T> = { ok: true; data: T; requestId: string };

export class CasinoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "CasinoApiError";
  }
}

export type TableStatus = {
  id: string;
  name: string;
  game_type: string;
  status: string;
  visibility: string;
  dealer_mode: string;
  max_seats: number;
  min_bet: number;
  max_bet: number;
  current_round_id: string | null;
  state_version: number;
  owner_display_name: string;
  seated_count: number;
  spectator_count: number;
};

export type DiscordTableLink = {
  table_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  last_announced_version: number;
  last_status: string;
  last_round_id: string | null;
  last_seated_count: number;
  name: string;
  status: string;
  state_version: number;
  current_round_id: string | null;
  min_bet: number;
  max_bet: number;
  max_seats: number;
  owner_display_name: string;
  seated_count: number;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CasinoApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly secret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/bot/${path.replace(/^\//, "")}`, {
          ...init,
          signal: AbortSignal.timeout(10_000),
          headers: {
            authorization: `Bearer ${this.secret}`,
            accept: "application/json",
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            ...init.headers,
          },
        });
        const payload = await response.json() as ApiEnvelope<T> | { ok: false; error?: { code?: string; message?: string }; requestId?: string };
        if (response.ok && payload.ok) return payload.data;
        const code = !payload.ok ? payload.error?.code ?? "API_ERROR" : "API_ERROR";
        const message = !payload.ok ? payload.error?.message ?? "The casino service rejected the request" : "The casino service rejected the request";
        const error = new CasinoApiError(message, response.status, code, payload.requestId);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
        const retryAfter = Number(response.headers.get("retry-after") ?? 0) * 1000;
        await wait(Math.min(8_000, Math.max(retryAfter, 500 * (2 ** attempt))));
      } catch (error) {
        if (error instanceof CasinoApiError && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
        if (attempt < 3) await wait(500 * (2 ** attempt));
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Casino API did not respond");
  }

  createTable(discordUserId: string, input: { name: string; minBet: number; maxBet: number; maxSeats: number }, interactionId: string) {
    return this.request<{ tableId: string; inviteCode: string; joinUrl: string }>("tables", { method: "POST", body: JSON.stringify({ discordUserId, ...input }) }, `discord:${interactionId}`);
  }

  validateInvite(code: string) {
    return this.request<{ tableId: string; tableName: string; gameType: string; status: string }>(`invites/${encodeURIComponent(code)}`);
  }

  tableStatus(tableId: string, discordUserId: string) {
    return this.request<TableStatus>(`tables/${encodeURIComponent(tableId)}/status?discordUserId=${encodeURIComponent(discordUserId)}`);
  }

  closeTable(tableId: string, discordUserId: string) {
    return this.request<{ closed: boolean }>(`tables/${encodeURIComponent(tableId)}/close`, { method: "POST", body: JSON.stringify({ discordUserId }) });
  }

  balance(discordUserId: string) {
    return this.request<{ balance: number; last_refill_at: string | null }>(`users/${discordUserId}/balance`);
  }

  stats(discordUserId: string) {
    return this.request<Record<string, number | string>>(`users/${discordUserId}/stats`);
  }

  leaderboard() {
    return this.request<Array<Record<string, string | number | null>>>("leaderboard");
  }

  linkTable(tableId: string, input: { guildId: string; channelId: string; messageId: string | null; discordUserId: string }) {
    return this.request<{ linked: boolean }>(`tables/${tableId}/discord-link`, { method: "POST", body: JSON.stringify(input) });
  }

  tableLinks() {
    return this.request<DiscordTableLink[]>("table-links");
  }

  acknowledgeLink(tableId: string, state: { stateVersion: number; status: string; roundId: string | null; seatedCount: number }) {
    return this.request<{ acknowledged: boolean }>(`tables/${tableId}/discord-link/ack`, { method: "POST", body: JSON.stringify(state) });
  }
}
