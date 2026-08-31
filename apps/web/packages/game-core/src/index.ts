export const SUITS = ["club", "diamond", "heart", "spade"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type GameType = "blackjack" | (string & {});
export type DealerMode = "automated" | "player";

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
  deck: number;
}

export interface BlackjackRules {
  deckCount: number;
  minBet: number;
  maxBet: number;
  blackjackPayout: number;
  dealerHitsSoft17: boolean;
  allowSurrender: boolean;
  maxSplits: number;
  hitSplitAces: boolean;
  doubleAfterSplit: boolean;
  turnSeconds: number;
}

export const DEFAULT_BLACKJACK_RULES: BlackjackRules = {
  deckCount: 6,
  minBet: 25,
  maxBet: 500,
  blackjackPayout: 1.5,
  dealerHitsSoft17: false,
  allowSurrender: true,
  maxSplits: 3,
  hitSplitAces: false,
  doubleAfterSplit: true,
  turnSeconds: 25,
};

export type HandStatus = "active" | "standing" | "busted" | "surrendered" | "blackjack" | "won" | "lost" | "push";

export interface BlackjackHand {
  id: string;
  cards: Card[];
  wager: number;
  status: HandStatus;
  isSplitHand: boolean;
  isSplitAces: boolean;
  doubled: boolean;
  resultAmount?: number;
}

export interface BlackjackPlayer {
  userId: string;
  seat: number;
  displayName: string;
  hands: BlackjackHand[];
  activeHandIndex: number;
  insuranceBet: number;
  insuranceDecided: boolean;
}

export interface ShoeState {
  cards: Card[];
  initialSize: number;
}

export type BlackjackPhase = "insurance" | "player_turns" | "dealer_turn" | "settled" | "cancelled";
export type BlackjackActionType = "hit" | "stand" | "double" | "split" | "surrender" | "insurance" | "decline_insurance";

export interface BlackjackAction {
  type: BlackjackActionType;
  amount?: number;
}

export interface WalletAdjustment {
  userId: string;
  amount: number;
  reason: "DOUBLE_DOWN" | "SPLIT_BET" | "INSURANCE_BET" | "PAYOUT" | "INSURANCE_PAYOUT" | "ROUND_REFUND";
  handId?: string;
}

export interface GameEvent {
  id: string;
  type: string;
  at: string;
  actorUserId?: string;
  payload: Record<string, unknown>;
}

export interface BlackjackState {
  gameType: "blackjack";
  roundId: string;
  phase: BlackjackPhase;
  rules: BlackjackRules;
  shoe: ShoeState;
  dealer: { cards: Card[]; holeRevealed: boolean; status: HandStatus };
  players: BlackjackPlayer[];
  currentPlayerIndex: number;
  stateVersion: number;
  actionDeadlineAt: string | null;
  startedAt: string;
  settledAt: string | null;
  events: GameEvent[];
}

export interface RoundParticipantInput {
  userId: string;
  seat: number;
  displayName: string;
  bet: number;
}

export interface ActionResult {
  state: BlackjackState;
  events: GameEvent[];
  walletAdjustments: WalletAdjustment[];
}

export interface PublicBlackjackState extends Omit<BlackjackState, "shoe" | "dealer" | "events"> {
  dealer: { cards: Array<Card | { id: string; hidden: true }>; holeRevealed: boolean; status: HandStatus };
  shoe: { remaining: number; initialSize: number };
  lastEvents: GameEvent[];
}

export interface GameAdapter<TState, TAction> {
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

export type RandomInt = (maxExclusive: number) => number;

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new Error("maxExclusive must be a positive safe integer");
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

export function createShoe(deckCount: number, randomInt: RandomInt = secureRandomInt): ShoeState {
  if (!Number.isInteger(deckCount) || deckCount < 1 || deckCount > 8) throw new Error("Deck count must be between 1 and 8");
  const cards: Card[] = [];
  for (let deck = 0; deck < deckCount; deck += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ id: `d${deck}-${suit}-${rank}`, rank, suit, deck });
  }
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [cards[index], cards[swapWith]] = [cards[swapWith], cards[index]];
  }
  return { cards, initialSize: cards.length };
}

export function createOrderedShoe(drawOrder: Array<Pick<Card, "rank" | "suit">>): ShoeState {
  const cards = [...drawOrder].reverse().map((card, index) => ({ ...card, id: `test-${drawOrder.length - index}`, deck: 0 }));
  return { cards, initialSize: cards.length };
}

export function cardNumericValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

export function handValue(cards: Card[]): { total: number; soft: boolean; blackjack: boolean; busted: boolean } {
  let total = cards.reduce((sum, card) => sum + cardNumericValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  const soft = aces > 0;
  return { total, soft, blackjack: cards.length === 2 && total === 21, busted: total > 21 };
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function draw(shoe: ShoeState): Card {
  const card = shoe.cards.pop();
  if (!card) throw new Error("Shoe exhausted");
  return card;
}

function event(type: string, payload: Record<string, unknown>, actorUserId?: string, now = new Date()): GameEvent {
  return { id: id("evt"), type, at: now.toISOString(), actorUserId, payload };
}

function deadline(rules: BlackjackRules, now: Date): string {
  return new Date(now.getTime() + rules.turnSeconds * 1000).toISOString();
}

function isTenValue(card: Card): boolean { return cardNumericValue(card.rank) === 10; }

function isNatural(hand: BlackjackHand): boolean {
  return !hand.isSplitHand && handValue(hand.cards).blackjack;
}

export type CreateRoundInput = {
  roundId?: string;
  participants: RoundParticipantInput[];
  rules?: Partial<BlackjackRules>;
  shoe?: ShoeState;
  now?: Date;
};

/**
 * Creates a round and preserves every automatic transition that can happen
 * during the initial deal. This matters when all players have naturals or the
 * dealer immediately reveals blackjack: the caller still receives the payout
 * instructions and can commit them atomically with the new round.
 */
export function createBlackjackRoundResult(input: CreateRoundInput): ActionResult {
  const rules = { ...DEFAULT_BLACKJACK_RULES, ...input.rules };
  const now = input.now ?? new Date();
  if (input.participants.length < 1 || input.participants.length > 7) throw new Error("Blackjack supports one to seven players");
  for (const participant of input.participants) {
    if (!Number.isInteger(participant.bet) || participant.bet < rules.minBet || participant.bet > rules.maxBet) throw new Error("Bet is outside table limits");
  }
  const shoe = input.shoe ? structuredClone(input.shoe) : createShoe(rules.deckCount);
  const players: BlackjackPlayer[] = [...input.participants].sort((a, b) => a.seat - b.seat).map((participant) => ({
    userId: participant.userId,
    seat: participant.seat,
    displayName: participant.displayName,
    activeHandIndex: 0,
    insuranceBet: 0,
    insuranceDecided: false,
    hands: [{ id: id("hand"), cards: [], wager: participant.bet, status: "active", isSplitHand: false, isSplitAces: false, doubled: false }],
  }));
  const dealer = { cards: [] as Card[], holeRevealed: false, status: "active" as HandStatus };
  for (const player of players) player.hands[0].cards.push(draw(shoe));
  dealer.cards.push(draw(shoe));
  for (const player of players) player.hands[0].cards.push(draw(shoe));
  dealer.cards.push(draw(shoe));
  for (const player of players) if (isNatural(player.hands[0])) player.hands[0].status = "blackjack";
  const state: BlackjackState = {
    gameType: "blackjack",
    roundId: input.roundId ?? id("round"),
    phase: dealer.cards[0].rank === "A" ? "insurance" : "player_turns",
    rules,
    shoe,
    dealer,
    players,
    currentPlayerIndex: 0,
    stateVersion: 1,
    actionDeadlineAt: deadline(rules, now),
    startedAt: now.toISOString(),
    settledAt: null,
    events: [event("round.started", { seats: players.map((player) => player.seat) }, undefined, now)],
  };
  const startedEvent = state.events[0];
  if (state.phase === "insurance") return { state, events: [startedEvent], walletAdjustments: [] };
  if (isTenValue(dealer.cards[0]) && handValue(dealer.cards).blackjack) {
    state.dealer.holeRevealed = true;
    state.dealer.status = "standing";
    const result = settle(state, now);
    result.events.unshift(startedEvent);
    return result;
  }
  const result = advanceTurn(state, now);
  result.events.unshift(startedEvent);
  return result;
}

export function createBlackjackRound(input: CreateRoundInput): BlackjackState {
  return createBlackjackRoundResult(input).state;
}

export function currentPlayer(state: BlackjackState): BlackjackPlayer | null {
  if (state.phase !== "player_turns" && state.phase !== "insurance") return null;
  return state.players[state.currentPlayerIndex] ?? null;
}

export function allowedActions(state: BlackjackState, userId: string, availableBalance = Number.MAX_SAFE_INTEGER): BlackjackActionType[] {
  const player = currentPlayer(state);
  if (!player || player.userId !== userId) return [];
  if (state.phase === "insurance") return player.insuranceDecided ? [] : ["insurance", "decline_insurance"];
  const hand = player.hands[player.activeHandIndex];
  if (!hand || hand.status !== "active") return [];
  const actions: BlackjackActionType[] = ["hit", "stand"];
  const firstDecision = hand.cards.length === 2;
  if (firstDecision && availableBalance >= hand.wager && (!hand.isSplitHand || state.rules.doubleAfterSplit)) actions.push("double");
  const splitCount = player.hands.length - 1;
  if (firstDecision && hand.cards[0].rank === hand.cards[1].rank && splitCount < state.rules.maxSplits && availableBalance >= hand.wager) actions.push("split");
  if (firstDecision && state.rules.allowSurrender && !hand.isSplitHand) actions.push("surrender");
  return actions;
}

export function validateBlackjackAction(state: BlackjackState, userId: string, action: BlackjackAction, availableBalance: number): string | null {
  if (state.phase === "settled" || state.phase === "cancelled" || state.phase === "dealer_turn") return "Round is not accepting player actions";
  if (!allowedActions(state, userId, availableBalance).includes(action.type)) return "Action is not allowed now";
  if (action.type === "insurance") {
    const player = currentPlayer(state)!;
    const maxInsurance = Math.floor(player.hands[0].wager / 2);
    const amount = action.amount ?? maxInsurance;
    if (!Number.isInteger(amount) || amount < 1 || amount > maxInsurance) return "Invalid insurance amount";
    if (availableBalance < amount) return "Insufficient balance for insurance";
  }
  return null;
}

export function applyBlackjackAction(stateInput: BlackjackState, userId: string, action: BlackjackAction, availableBalance: number, now = new Date()): ActionResult {
  const validation = validateBlackjackAction(stateInput, userId, action, availableBalance);
  if (validation) throw new Error(validation);
  const state = structuredClone(stateInput);
  const player = currentPlayer(state)!;
  const events: GameEvent[] = [];
  const walletAdjustments: WalletAdjustment[] = [];

  if (state.phase === "insurance") {
    if (action.type === "insurance") {
      const amount = action.amount ?? Math.floor(player.hands[0].wager / 2);
      player.insuranceBet = amount;
      walletAdjustments.push({ userId, amount: -amount, reason: "INSURANCE_BET" });
      events.push(event("insurance.taken", { amount }, userId, now));
    } else events.push(event("insurance.declined", {}, userId, now));
    player.insuranceDecided = true;
    state.currentPlayerIndex += 1;
    while (state.currentPlayerIndex < state.players.length && state.players[state.currentPlayerIndex].insuranceDecided) state.currentPlayerIndex += 1;
    if (state.currentPlayerIndex >= state.players.length) {
      if (handValue(state.dealer.cards).blackjack) {
        state.dealer.holeRevealed = true;
        const settled = settle(state, now);
        return combine(state, events, walletAdjustments, settled, now);
      }
      state.phase = "player_turns";
      state.currentPlayerIndex = 0;
      const advanced = advanceTurn(state, now);
      return combine(state, events, walletAdjustments, advanced, now);
    }
    state.actionDeadlineAt = deadline(state.rules, now);
    return finalize(state, events, walletAdjustments);
  }

  const hand = player.hands[player.activeHandIndex];
  switch (action.type) {
    case "hit": {
      const card = draw(state.shoe); hand.cards.push(card);
      events.push(event("card.dealt", { card, handId: hand.id, seat: player.seat }, userId, now));
      const value = handValue(hand.cards);
      if (value.busted) { hand.status = "busted"; events.push(event("hand.busted", { handId: hand.id, total: value.total }, userId, now)); }
      else if (value.total === 21) hand.status = "standing";
      break;
    }
    case "stand": hand.status = "standing"; events.push(event("hand.stood", { handId: hand.id, total: handValue(hand.cards).total }, userId, now)); break;
    case "surrender": hand.status = "surrendered"; events.push(event("hand.surrendered", { handId: hand.id }, userId, now)); break;
    case "double": {
      walletAdjustments.push({ userId, amount: -hand.wager, reason: "DOUBLE_DOWN", handId: hand.id });
      hand.wager *= 2; hand.doubled = true;
      const card = draw(state.shoe); hand.cards.push(card);
      hand.status = handValue(hand.cards).busted ? "busted" : "standing";
      events.push(event("hand.doubled", { handId: hand.id, card, wager: hand.wager }, userId, now));
      break;
    }
    case "split": {
      const splitCard = hand.cards.pop()!;
      const second: BlackjackHand = { id: id("hand"), cards: [splitCard], wager: hand.wager, status: "active", isSplitHand: true, isSplitAces: splitCard.rank === "A", doubled: false };
      hand.isSplitHand = true; hand.isSplitAces = hand.cards[0].rank === "A";
      player.hands.splice(player.activeHandIndex + 1, 0, second);
      walletAdjustments.push({ userId, amount: -hand.wager, reason: "SPLIT_BET", handId: second.id });
      const firstCard = draw(state.shoe); const secondCard = draw(state.shoe);
      hand.cards.push(firstCard); second.cards.push(secondCard);
      if (hand.isSplitAces && !state.rules.hitSplitAces) { hand.status = "standing"; second.status = "standing"; }
      events.push(event("hand.split", { firstHandId: hand.id, secondHandId: second.id, cards: [firstCard, secondCard] }, userId, now));
      break;
    }
    default: throw new Error("Unexpected action");
  }
  if (hand.status !== "active") player.activeHandIndex += 1;
  const advanced = advanceTurn(state, now);
  return combine(state, events, walletAdjustments, advanced, now);
}

function combine(base: BlackjackState, events: GameEvent[], adjustments: WalletAdjustment[], result: ActionResult, now: Date): ActionResult {
  void base; void now;
  result.events = [...events, ...result.events];
  result.walletAdjustments = [...adjustments, ...result.walletAdjustments];
  result.state.events.push(...events);
  return result;
}

function finalize(state: BlackjackState, events: GameEvent[], walletAdjustments: WalletAdjustment[]): ActionResult {
  state.stateVersion += 1;
  state.events.push(...events);
  state.events = state.events.slice(-80);
  return { state, events, walletAdjustments };
}

function advanceTurn(state: BlackjackState, now: Date): ActionResult {
  const events: GameEvent[] = [];
  while (state.currentPlayerIndex < state.players.length) {
    const player = state.players[state.currentPlayerIndex];
    while (player.activeHandIndex < player.hands.length && player.hands[player.activeHandIndex].status !== "active") player.activeHandIndex += 1;
    if (player.activeHandIndex < player.hands.length) {
      state.actionDeadlineAt = deadline(state.rules, now);
      events.push(event("turn.started", { userId: player.userId, seat: player.seat, handId: player.hands[player.activeHandIndex].id, deadlineAt: state.actionDeadlineAt }, undefined, now));
      return finalize(state, events, []);
    }
    state.currentPlayerIndex += 1;
  }
  state.phase = "dealer_turn"; state.actionDeadlineAt = null; state.dealer.holeRevealed = true;
  events.push(event("dealer.revealed", { card: state.dealer.cards[1] }, undefined, now));
  const dealerResult = runDealer(state, now);
  return combine(state, events, [], dealerResult, now);
}

export function runDealer(stateInput: BlackjackState, now = new Date()): ActionResult {
  const state = structuredClone(stateInput);
  if (state.phase !== "dealer_turn") return { state, events: [], walletAdjustments: [] };
  const events: GameEvent[] = [];
  const allDead = state.players.every((player) => player.hands.every((hand) => hand.status === "busted" || hand.status === "surrendered"));
  if (!allDead) {
    while (true) {
      const value = handValue(state.dealer.cards);
      const shouldHit = value.total < 17 || (value.total === 17 && value.soft && state.rules.dealerHitsSoft17);
      if (!shouldHit) break;
      const card = draw(state.shoe); state.dealer.cards.push(card);
      events.push(event("dealer.drew", { card, total: handValue(state.dealer.cards).total }, undefined, now));
    }
  }
  const dealerValue = handValue(state.dealer.cards);
  state.dealer.status = dealerValue.busted ? "busted" : "standing";
  const settled = settle(state, now);
  return combine(state, events, [], settled, now);
}

export function settle(stateInput: BlackjackState, now = new Date()): ActionResult {
  const state = structuredClone(stateInput);
  const events: GameEvent[] = [];
  const walletAdjustments: WalletAdjustment[] = [];
  const dealerValue = handValue(state.dealer.cards);
  const dealerNatural = dealerValue.blackjack;
  for (const player of state.players) {
    if (player.insuranceBet > 0 && dealerNatural) {
      const payout = player.insuranceBet * 3;
      walletAdjustments.push({ userId: player.userId, amount: payout, reason: "INSURANCE_PAYOUT" });
      events.push(event("insurance.won", { amount: payout }, player.userId, now));
    }
    for (const hand of player.hands) {
      const playerValue = handValue(hand.cards);
      let payout = 0;
      if (hand.status === "surrendered") { payout = hand.wager / 2; hand.status = "lost"; }
      else if (playerValue.busted) hand.status = "lost";
      else if (dealerNatural && isNatural(hand)) { payout = hand.wager; hand.status = "push"; }
      else if (dealerNatural) hand.status = "lost";
      else if (isNatural(hand)) { payout = hand.wager + hand.wager * state.rules.blackjackPayout; hand.status = "won"; }
      else if (dealerValue.busted || playerValue.total > dealerValue.total) { payout = hand.wager * 2; hand.status = "won"; }
      else if (playerValue.total === dealerValue.total) { payout = hand.wager; hand.status = "push"; }
      else hand.status = "lost";
      hand.resultAmount = payout - hand.wager;
      if (payout > 0) walletAdjustments.push({ userId: player.userId, amount: payout, reason: "PAYOUT", handId: hand.id });
      events.push(event("hand.settled", { handId: hand.id, status: hand.status, wager: hand.wager, payout, net: hand.resultAmount }, player.userId, now));
    }
  }
  state.phase = "settled"; state.settledAt = now.toISOString(); state.actionDeadlineAt = null; state.dealer.holeRevealed = true;
  events.push(event("round.settled", { dealerTotal: dealerValue.total, dealerBusted: dealerValue.busted }, undefined, now));
  return finalize(state, events, walletAdjustments);
}

export function applyTimeout(state: BlackjackState, now = new Date()): ActionResult {
  if (!state.actionDeadlineAt || new Date(state.actionDeadlineAt).getTime() > now.getTime()) return { state, events: [], walletAdjustments: [] };
  const player = currentPlayer(state);
  if (!player) return { state, events: [], walletAdjustments: [] };
  const safeAction: BlackjackAction = { type: state.phase === "insurance" ? "decline_insurance" : "stand" };
  const result = applyBlackjackAction(state, player.userId, safeAction, Number.MAX_SAFE_INTEGER, now);
  const timeoutEvent = event("turn.timed_out", { automaticAction: safeAction.type }, player.userId, now);
  result.events.unshift(timeoutEvent); result.state.events.push(timeoutEvent);
  return result;
}

export function cancelRound(stateInput: BlackjackState, now = new Date()): ActionResult {
  const state = structuredClone(stateInput);
  const walletAdjustments: WalletAdjustment[] = [];
  for (const player of state.players) {
    for (const hand of player.hands) walletAdjustments.push({ userId: player.userId, amount: hand.wager, reason: "ROUND_REFUND", handId: hand.id });
    if (player.insuranceBet) walletAdjustments.push({ userId: player.userId, amount: player.insuranceBet, reason: "ROUND_REFUND" });
  }
  state.phase = "cancelled"; state.settledAt = now.toISOString(); state.actionDeadlineAt = null; state.dealer.holeRevealed = false;
  return finalize(state, [event("round.cancelled", { reason: "safe_recovery" }, undefined, now)], walletAdjustments);
}

export function serializePublicState(state: BlackjackState): PublicBlackjackState {
  const dealerCards: Array<Card | { id: string; hidden: true }> = state.dealer.cards.map((card, index) => index === 1 && !state.dealer.holeRevealed ? { id: card.id, hidden: true as const } : card);
  const { shoe, events, ...rest } = state;
  return { ...rest, dealer: { ...state.dealer, cards: dealerCards }, shoe: { remaining: shoe.cards.length, initialSize: shoe.initialSize }, lastEvents: events.slice(-20) };
}

export function serializePrivateState(state: BlackjackState, userId: string, availableBalance: number) {
  const player = state.players.find((candidate) => candidate.userId === userId) ?? null;
  return { userId, player, allowedActions: allowedActions(state, userId, availableBalance), actionDeadlineAt: state.actionDeadlineAt };
}

export const blackjackAdapter: GameAdapter<BlackjackState, BlackjackAction> = {
  gameType: "blackjack",
  createInitialState: (input) => createBlackjackRound(input as Parameters<typeof createBlackjackRound>[0]),
  validateAction: validateBlackjackAction,
  applyAction: applyBlackjackAction,
  applyTimeout,
  serializePublicState,
  serializePrivateState,
  recoverState: (state, now) => {
    let result: ActionResult = { state, events: [], walletAdjustments: [] };
    let guard = 0;
    while (result.state.actionDeadlineAt && new Date(result.state.actionDeadlineAt) <= (now ?? new Date()) && guard < 8) { result = applyTimeout(result.state, now); guard += 1; }
    return result;
  },
  runAutomatedHost: runDealer,
};

export function dealerRemark(eventType: string, context: { displayName?: string; amount?: number; total?: number; consecutiveDealer21?: number; losers?: number } = {}): string | null {
  const name = context.displayName ?? "Someone";
  const remarks: Record<string, string[]> = {
    "unlikely_bust": [`${name} asked for one more card. The card had notes.`, "That hit had ambition. Not accuracy, but ambition."],
    "dealer_21": ["Twenty-one again. Administrative efficiency.", "The dealer appears to have completed the paperwork in advance."],
    "large_win": [`${name} has acquired a very impressive quantity of nothing.`, "A large virtual fortune. Guard it virtually."],
    "large_loss": ["A dramatic reduction in a currency that remains entirely fictional.", "The chips have left. Their forwarding address is unknown."],
    "odd_split": ["A split with character. Possibly too much character.", "Two questionable hands are, technically, more hands."],
    "everyone_push": ["A full-table push. Nothing happened, but magnificently.", "The round has concluded without choosing a side."],
    "slow_play": [`${name} is consulting the full weight of history.`, "The cards remain patient. Barely."],
    "reconnected": [`${name} returns. The chair denies everything.`, "Connection restored. Dignity status unknown."],
    "many_losses": ["A difficult round for the table. The felt declines to comment.", "Several plans have now reached their natural conclusion."],
  };
  const options = remarks[eventType];
  if (!options) return null;
  const selector = Math.abs((context.amount ?? context.total ?? context.losers ?? 0) + (context.consecutiveDealer21 ?? 0)) % options.length;
  return options[selector];
}
