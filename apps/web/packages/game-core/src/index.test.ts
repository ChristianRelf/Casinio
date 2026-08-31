import { describe, expect, it } from "vitest";
import { allowedActions, applyBlackjackAction, applyTimeout, blackjackAdapter, cancelRound, createBlackjackRound, createBlackjackRoundResult, createOrderedShoe, createShoe, handValue, serializePrivateState, serializePublicState, type Card, type Suit } from "./index";

const c = (rank: Card["rank"], suit: Suit = "spade") => ({ rank, suit });
const participants = [{ userId: "u1", seat: 1, displayName: "Chris", bet: 100 }];
function round(draws: Array<ReturnType<typeof c>>, options: Record<string, unknown> = {}) {
  return createBlackjackRound({ participants, shoe: createOrderedShoe(draws), now: new Date("2026-01-01T00:00:00Z"), ...options });
}

describe("blackjack totals", () => {
  it("values hard totals", () => expect(handValue([{ ...c("10"), id: "1", deck: 0 }, { ...c("7"), id: "2", deck: 0 }]).total).toBe(17));
  it("values soft totals and multiple aces", () => {
    const cards = [c("A"), c("A"), c("9")].map((card, index) => ({ ...card, id: String(index), deck: 0 }));
    expect(handValue(cards)).toMatchObject({ total: 21, soft: true, busted: false });
  });
});

describe("round flow", () => {
  it("pays a natural blackjack at configured odds", () => {
    const shoe = createOrderedShoe([c("A"), c("9", "heart"), c("K", "club"), c("7", "diamond"), c("10")]);
    const result = createBlackjackRoundResult({ participants, shoe, now: new Date("2026-01-01T00:00:00Z") });
    const state = result.state;
    expect(state.phase).toBe("settled");
    expect(state.players[0].hands[0]).toMatchObject({ status: "won", resultAmount: 150 });
    expect(result.walletAdjustments).toContainEqual(expect.objectContaining({ reason: "PAYOUT", amount: 250 }));
  });
  it("preserves half-chip blackjack payouts without floating-point drift", () => {
    const result = createBlackjackRoundResult({ participants: [{ ...participants[0], bet: 25 }], shoe: createOrderedShoe([c("A"), c("9"), c("K"), c("7"), c("10")]) });
    expect(result.walletAdjustments).toContainEqual(expect.objectContaining({ reason: "PAYOUT", amount: 62.5 }));
    expect(result.state.players[0].hands[0].resultAmount).toBe(37.5);
  });
  it("handles dealer blackjack and insurance", () => {
    let state = round([c("10"), c("A", "heart"), c("9", "club"), c("K", "diamond")]);
    const result = applyBlackjackAction(state, "u1", { type: "insurance", amount: 50 }, 500);
    state = result.state;
    expect(state.phase).toBe("settled");
    expect(result.walletAdjustments).toContainEqual(expect.objectContaining({ reason: "INSURANCE_PAYOUT", amount: 150 }));
  });
  it("supports hit, bust, and dealer completion", () => {
    let state = round([c("10"), c("6"), c("6", "club"), c("10", "diamond"), c("K", "heart")]);
    state = applyBlackjackAction(state, "u1", { type: "hit" }, 500).state;
    expect(state.players[0].hands[0].status).toBe("lost");
    expect(state.phase).toBe("settled");
  });
  it("supports stand and push", () => {
    let state = round([c("10"), c("10", "heart"), c("8", "club"), c("8", "diamond")]);
    state = applyBlackjackAction(state, "u1", { type: "stand" }, 500).state;
    expect(state.players[0].hands[0].status).toBe("push");
  });
  it("supports double down", () => {
    let state = round([c("5"), c("6", "heart"), c("6", "club"), c("10", "diamond"), c("10", "heart"), c("5", "diamond")]);
    const result = applyBlackjackAction(state, "u1", { type: "double" }, 500);
    state = result.state;
    expect(state.players[0].hands[0].wager).toBe(200);
    expect(result.walletAdjustments).toContainEqual(expect.objectContaining({ reason: "DOUBLE_DOWN", amount: -100 }));
  });
  it("supports splitting and multiple hands", () => {
    let state = round([c("8"), c("6"), c("8", "club"), c("10"), c("3"), c("2"), c("10"), c("10")]);
    const result = applyBlackjackAction(state, "u1", { type: "split" }, 500);
    state = result.state;
    expect(state.players[0].hands).toHaveLength(2);
    expect(result.walletAdjustments[0]).toMatchObject({ reason: "SPLIT_BET", amount: -100 });
  });
  it("locks split aces when hit-split-aces is disabled", () => {
    const state = round([c("A"), c("6"), c("A", "club"), c("10"), c("9"), c("8"), c("10")]);
    const result = applyBlackjackAction(state, "u1", { type: "split" }, 500);
    expect(result.state.players[0].hands.every((hand) => hand.status !== "active")).toBe(true);
  });
  it("supports surrender", () => {
    const state = round([c("10"), c("9"), c("6"), c("7")]);
    const result = applyBlackjackAction(state, "u1", { type: "surrender" }, 500);
    expect(result.state.players[0].hands[0].resultAmount).toBe(-50);
  });
  it("obeys dealer soft 17 configuration", () => {
    let state = round([c("10"), c("6"), c("7"), c("A"), c("4")], { rules: { dealerHitsSoft17: true } });
    state = applyBlackjackAction(state, "u1", { type: "stand" }, 500).state;
    expect(state.dealer.cards).toHaveLength(3);
  });
  it("stands on soft 17 when configured", () => {
    let state = round([c("10"), c("6"), c("7"), c("A"), c("4")], { rules: { dealerHitsSoft17: false } });
    state = applyBlackjackAction(state, "u1", { type: "stand" }, 500).state;
    expect(state.dealer.cards).toHaveLength(2);
    expect(handValue(state.dealer.cards)).toMatchObject({ total: 17, soft: true });
  });
  it("lets a player decline insurance and continue the main hand", () => {
    const state = round([c("10"), c("A"), c("9"), c("6")]);
    const result = applyBlackjackAction(state, "u1", { type: "decline_insurance" }, 500);
    expect(result.state.phase).toBe("player_turns");
    expect(result.state.players[0].insuranceDecided).toBe(true);
    expect(result.walletAdjustments).toEqual([]);
  });
  it("settles multiple players in seat order", () => {
    const multiple = [{ userId: "u2", seat: 2, displayName: "Maya", bet: 100 }, { userId: "u1", seat: 1, displayName: "Chris", bet: 100 }];
    let state = createBlackjackRound({ participants: multiple, shoe: createOrderedShoe([c("10"), c("9"), c("10", "heart"), c("7"), c("8"), c("7", "diamond")]) });
    expect(state.players.map((player) => player.userId)).toEqual(["u1", "u2"]);
    state = applyBlackjackAction(state, "u1", { type: "stand" }, 500).state;
    expect(state.players[state.currentPlayerIndex].userId).toBe("u2");
    const result = applyBlackjackAction(state, "u2", { type: "stand" }, 500);
    expect(result.state.phase).toBe("settled");
    expect(result.state.players.flatMap((player) => player.hands).every((hand) => hand.status === "push")).toBe(true);
    expect(result.walletAdjustments.filter((item) => item.reason === "PAYOUT")).toHaveLength(2);
  });
  it("rejects out-of-turn and duplicate-style actions", () => {
    const state = round([c("9"), c("8"), c("7"), c("8"), c("10")]);
    expect(() => applyBlackjackAction(state, "wrong", { type: "hit" }, 500)).toThrow(/not allowed/);
    const settled = applyBlackjackAction(state, "u1", { type: "stand" }, 500).state;
    expect(() => applyBlackjackAction(settled, "u1", { type: "stand" }, 500)).toThrow(/not accepting/);
  });
  it("rejects unaffordable doubles and splits", () => {
    const state = round([c("8"), c("6"), c("8"), c("10")]);
    expect(allowedActions(state, "u1", 0)).not.toContain("double");
    expect(allowedActions(state, "u1", 0)).not.toContain("split");
    expect(() => applyBlackjackAction(state, "u1", { type: "double" }, 0)).toThrow(/not allowed/);
  });
  it("takes the safe action when the timer expires", () => {
    const state = round([c("9"), c("8"), c("7"), c("8"), c("10")]);
    const result = applyTimeout(state, new Date("2026-01-01T00:01:00Z"));
    expect(result.events.some((entry) => entry.type === "turn.timed_out")).toBe(true);
    expect(result.state.phase).toBe("settled");
  });
  it("never reveals a dealer hole card publicly", () => {
    const state = round([c("9"), c("8"), c("7"), c("8")]);
    const publicState = serializePublicState(state);
    expect(publicState.dealer.cards[1]).toEqual(expect.objectContaining({ hidden: true }));
    expect(publicState.dealer.cards[1]).not.toHaveProperty("rank");
    expect(publicState.dealer.cards[1]).not.toHaveProperty("suit");
    expect(publicState).not.toHaveProperty("shoe.cards");
  });
  it("restores the same private turn after serialization and reconnection", () => {
    const state = round([c("9"), c("8"), c("7"), c("8")]);
    const restored = JSON.parse(JSON.stringify(state));
    expect(serializePrivateState(restored, "u1", 500)).toEqual(serializePrivateState(state, "u1", 500));
    expect(serializePrivateState(restored, "someone-else", 500).player).toBeNull();
  });
  it("recovers every expired turn with safe automatic actions", () => {
    const state = round([c("9"), c("8"), c("7"), c("8"), c("10")]);
    const result = blackjackAdapter.recoverState(state, new Date("2026-01-01T00:05:00Z"));
    expect(result.state.phase).toBe("settled");
    expect(result.events.some((entry) => entry.type === "turn.timed_out")).toBe(true);
  });
  it("refunds the complete committed exposure when a round is cancelled", () => {
    const state = round([c("8"), c("6"), c("8"), c("10")]);
    state.players[0].hands[0].wager = 200;
    state.players[0].insuranceBet = 50;
    const result = cancelRound(state, new Date("2026-01-01T00:02:00Z"));
    expect(result.state.phase).toBe("cancelled");
    expect(result.walletAdjustments.filter((item) => item.reason === "ROUND_REFUND").map((item) => item.amount)).toEqual([200, 50]);
  });
});

describe("security and adapters", () => {
  it("creates a complete unpredictable shoe shape without Math.random", () => {
    const original = Math.random;
    Math.random = () => { throw new Error("Math.random must not be used"); };
    try { expect(createShoe(2).cards).toHaveLength(104); } finally { Math.random = original; }
  });
  it("does not let an action payload choose the next card", () => {
    const state = round([c("5"), c("6"), c("6"), c("10"), c("K"), c("5", "club")]);
    const forgedAction = { type: "hit", card: { rank: "A", suit: "heart" } } as unknown as { type: "hit" };
    const result = applyBlackjackAction(state, "u1", forgedAction, 500);
    expect(result.state.players[0].hands[0].cards.at(-1)?.rank).toBe("K");
    expect(result.state.players[0].hands[0].cards.at(-1)?.suit).toBe("spade");
  });
  it("supports the full seven-seat table and rejects an eighth player", () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({ userId: `u${index + 1}`, seat: index + 1, displayName: `Player ${index + 1}`, bet: 25 }));
    const cards = [...Array.from({ length: 7 }, () => c("9")), c("10"), ...Array.from({ length: 7 }, () => c("8")), c("7")];
    expect(createBlackjackRound({ participants: seven, shoe: createOrderedShoe(cards) }).players).toHaveLength(7);
    expect(() => createBlackjackRound({ participants: [...seven, { userId: "u8", seat: 8, displayName: "Player 8", bet: 25 }], shoe: createOrderedShoe(cards) })).toThrow(/one to seven/);
  });
  it("exposes blackjack through the reusable game adapter", () => expect(blackjackAdapter.gameType).toBe("blackjack"));
});
