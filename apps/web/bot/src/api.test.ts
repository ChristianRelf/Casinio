import { afterEach, describe, expect, it, vi } from "vitest";
import { CasinoApi, CasinoApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Discord backend client", () => {
  it("authenticates server-to-server and sends an idempotency key for table creation", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-secret-with-enough-length");
      expect(new Headers(init.headers).get("idempotency-key")).toBe("discord:interaction-1");
      return new Response(JSON.stringify({ ok: true, data: { tableId: "tbl_1", inviteCode: "ABC123", joinUrl: "/join/ABC123" }, requestId: "req_1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = new CasinoApi("https://api.example", "server-secret-with-enough-length");
    await expect(api.createTable("discord-user", { name: "Friday", minBet: 25, maxBet: 500, maxSeats: 7 }, "interaction-1")).resolves.toMatchObject({ tableId: "tbl_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns safe API errors without retrying rejected commands", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "OWNER_REQUIRED", message: "Only the owner can close this table" }, requestId: "req_safe" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new CasinoApi("https://api.example", "server-secret-with-enough-length");
    await expect(api.closeTable("tbl_1", "someone-else")).rejects.toMatchObject({ code: "OWNER_REQUIRED", status: 403, requestId: "req_safe" } satisfies Partial<CasinoApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
