import { expect, type Page, test } from "@playwright/test";

type Persona = "chris" | "maya";
type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type TableState = {
  table: { id: string; stateVersion: number; status: string };
  people: Array<{ userId: string; displayName: string; seatNumber: number | null }>;
  publicState: null | {
    roundId: string;
    phase: string;
    stateVersion: number;
    dealer: { holeRevealed: boolean };
    shoe: { initialSize: number; remaining: number; cards?: unknown };
  };
};

async function signIn(page: Page, persona: Persona) {
  const sessionProbe = page.waitForResponse((response) => response.url().endsWith("/api/v1/auth/session"));
  await page.goto("/");
  await sessionProbe;
  const ageConfirmation = page.getByRole("checkbox");
  await page.locator("label.age-check").click();
  await expect(ageConfirmation).toBeChecked();
  await expect(page.getByRole("link", { name: "Continue with Discord" })).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: `Enter as ${persona === "chris" ? "Chris" : "Maya"}` }).click();
  await expect(page).toHaveURL(/\/lobby$/);
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (requestedPath) => {
    let response: Response | undefined;
    let networkError: unknown;
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try { response = await fetch(`/api/v1/${requestedPath}`, { credentials: "same-origin", cache: "no-store" }); }
      catch (error) { networkError = error; await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1))); }
    }
    if (!response) throw networkError;
    const payload = await response.json() as Envelope<T>;
    if (!payload.ok) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    return payload.data;
  }, path);
}

async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  return page.evaluate(async ({ requestedPath, requestBody }) => {
    const csrf = document.cookie.match(/(?:^|;\s*)ls_csrf=([^;]+)/)?.[1];
    const idempotencyKey = crypto.randomUUID();
    let response: Response | undefined;
    let networkError: unknown;
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try {
        response = await fetch(`/api/v1/${requestedPath}`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-csrf-token": csrf ? decodeURIComponent(csrf) : "",
          },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        networkError = error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (!response) throw networkError;
    const payload = await response.json() as Envelope<T>;
    if (!payload.ok) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    return payload.data;
  }, { requestedPath: path, requestBody: body });
}

async function chooseBet(page: Page, amount: number) {
  const chip = page.locator(".rail-chips button").filter({ hasText: `$${amount}` }).first();
  await expect(chip).toBeEnabled();
  await chip.click();
  await expect(page.locator(".seat-plate").filter({ hasText: "You" }).locator("small")).toContainText(`BET $${amount}`);
}

async function completeRound(pages: Page[], tableId: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const state = await apiGet<TableState>(pages[0], `tables/${tableId}`);
    if (state.publicState?.phase === "settled") return state;
    for (const page of pages) {
      for (const actionName of [/NO THANKS/i, /STAND/i]) {
        const action = page.getByRole("button", { name: actionName }).first();
        if (await action.isVisible().catch(() => false) && await action.isEnabled().catch(() => false)) {
          await action.click();
          break;
        }
      }
    }
    await pages[0].waitForTimeout(180);
  }
  throw new Error("The two-player round did not settle before the test deadline");
}

test("two friends create, join, play, settle, reconnect, and begin the next round", async ({ browser }) => {
  const chrisContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const mayaContext = await browser.newContext();
  const chris = await chrisContext.newPage();
  const maya = await mayaContext.newPage();

  try {
    await signIn(chris, "chris");
    await signIn(maya, "maya");
    await apiPost(chris, "admin/users/dev_chris/wallet", { operation: "reset", reason: "Browser test balance reset" });
    await apiPost(chris, "admin/users/dev_maya/wallet", { operation: "reset", reason: "Browser test balance reset" });

    await chris.getByRole("button", { name: "Create a table" }).click();
    const dialog = chris.getByRole("dialog");
    const tableName = `Night table ${Date.now()}`;
    await dialog.getByLabel("Table name").fill(tableName);
    await dialog.getByLabel("Seats").selectOption("7");
    await dialog.getByLabel("Minimum bet").fill("25");
    await dialog.getByLabel("Maximum bet").fill("100");
    await dialog.getByRole("button", { name: "Create private table" }).click();
    await expect(chris).toHaveURL(/\/table\/tbl_/);
    const tableId = new URL(chris.url()).pathname.split("/").at(-1)!;
    await expect(chris.getByLabel("Blackjack table")).toBeVisible();

    const inviteResponse = chris.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/v1/tables/${tableId}/invites`));
    await chris.getByRole("button", { name: "Invite friends" }).click();
    const invitePayload = await (await inviteResponse).json() as Envelope<{ code: string }>;
    if (!invitePayload.ok) throw new Error(invitePayload.error.message);

    await maya.goto(`/join/${invitePayload.data.code}`);
    await maya.getByRole("button", { name: "Join table" }).click();
    await expect(maya).toHaveURL(new RegExp(`/table/${tableId}$`));
    await maya.getByRole("button", { name: "Take seat 3" }).click();
    await expect(maya.locator(".iso-seat.seat-3")).toHaveClass(/is-me/);
    await expect(chris.locator(".iso-seat.seat-4")).toHaveClass(/is-me/);

    await Promise.all([chooseBet(chris, 25), chooseBet(maya, 25)]);
    await chris.getByRole("button", { name: /Ready up/ }).click();
    await maya.getByRole("button", { name: /Ready up/ }).click();

    const firstRound = await completeRound([chris, maya], tableId);
    expect(firstRound.publicState?.phase).toBe("settled");
    expect(firstRound.publicState?.dealer.holeRevealed).toBe(true);
    expect(firstRound.publicState?.shoe.cards).toBeUndefined();
    await expect(chris.getByRole("button", { name: /Ready up/ })).toBeVisible();
    await expect(maya.getByRole("button", { name: /Ready up/ })).toBeVisible();
    expect(await chris.locator(".dealer-cards-zone .deck-card").count()).toBeGreaterThanOrEqual(2);
    expect(await maya.locator(".dealer-cards-zone .deck-card").count()).toBeGreaterThanOrEqual(2);
    await expect(chris.locator(".dealer-cards-zone .deck-hidden")).toHaveCount(0);
    await expect(maya.locator(".dealer-cards-zone .deck-hidden")).toHaveCount(0);

    const [chrisView, mayaView] = await Promise.all([
      apiGet<TableState>(chris, `tables/${tableId}`),
      apiGet<TableState>(maya, `tables/${tableId}`),
    ]);
    expect(chrisView.publicState?.roundId).toBe(mayaView.publicState?.roundId);
    expect(chrisView.table.stateVersion).toBe(mayaView.table.stateVersion);
    expect(chrisView.people.map((person) => person.displayName).sort()).toEqual(["Chris", "Maya"]);

    const chrisLedger = await apiGet<Array<{ table_id: string | null; reason: string; idempotency_key: string }>>(chris, "me/ledger?limit=100");
    const mayaLedger = await apiGet<Array<{ table_id: string | null; reason: string; idempotency_key: string }>>(maya, "me/ledger?limit=100");
    for (const ledger of [chrisLedger, mayaLedger]) {
      const roundEntries = ledger.filter((entry) => entry.table_id === tableId);
      expect(roundEntries.filter((entry) => entry.reason === "BET_PLACED")).toHaveLength(1);
      expect(new Set(roundEntries.map((entry) => entry.idempotency_key)).size).toBe(roundEntries.length);
    }

    await maya.reload();
    await expect(maya.getByLabel("Blackjack table")).toBeVisible();
    await expect(maya.locator(".iso-seat.seat-3")).toHaveClass(/is-me/);
    await expect(maya.getByRole("button", { name: /Ready up/ })).toBeVisible();

    const settledRoundId = firstRound.publicState!.roundId;
    await Promise.all([chooseBet(chris, 25), chooseBet(maya, 25)]);
    await chris.getByRole("button", { name: /Ready up/ }).click();
    await maya.getByRole("button", { name: /Ready up/ }).click();
    await expect.poll(async () => (await apiGet<TableState>(chris, `tables/${tableId}`)).publicState?.roundId).not.toBe(settledRoundId);
  } finally {
    await chrisContext.close().catch(() => undefined);
    await mayaContext.close().catch(() => undefined);
  }
});
