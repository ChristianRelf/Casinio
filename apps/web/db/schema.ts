import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  ageConfirmedAt: text("age_confirmed_at"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  isDevelopment: integer("is_development", { mode: "boolean" }).notNull().default(false),
  lastSeenAt: text("last_seen_at"),
  ...timestamps,
});

export const discordIdentities = sqliteTable("discord_identities", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id").notNull(),
  username: text("username").notNull(),
  globalName: text("global_name"),
  avatarHash: text("avatar_hash"),
  scopes: text("scopes").notNull(),
  tokenExpiresAt: text("token_expires_at"),
  lastAuthenticatedAt: text("last_authenticated_at").notNull(),
}, (table) => [uniqueIndex("uq_discord_identities_discord_user_id").on(table.discordUserId)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [uniqueIndex("uq_sessions_token_hash").on(table.tokenHash), index("idx_sessions_user_id").on(table.userId), index("idx_sessions_expires_at").on(table.expiresAt)]);

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  permissionsJson: text("permissions_json").notNull(),
}, (table) => [uniqueIndex("uq_roles_name").on(table.name)]);

export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  grantedAt: text("granted_at").notNull(),
  grantedBy: text("granted_by"),
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] })]);

export const wallets = sqliteTable("wallets", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull(),
  version: integer("version").notNull().default(0),
  lastRefillAt: text("last_refill_at"),
  updatedAt: text("updated_at").notNull(),
});

export const tables = sqliteTable("tables", {
  id: text("id").primaryKey(),
  gameType: text("game_type").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["open", "in_round", "closed"] }).notNull(),
  visibility: text("visibility", { enum: ["private", "friends", "public"] }).notNull().default("private"),
  dealerMode: text("dealer_mode", { enum: ["automated", "player"] }).notNull().default("automated"),
  dealerUserId: text("dealer_user_id"),
  maxSeats: integer("max_seats").notNull(),
  minBet: integer("min_bet").notNull(),
  maxBet: integer("max_bet").notNull(),
  rulesJson: text("rules_json").notNull(),
  gameStateJson: text("game_state_json"),
  currentRoundId: text("current_round_id"),
  stateVersion: integer("state_version").notNull().default(0),
  lastEventAt: text("last_event_at"),
  ...timestamps,
}, (table) => [index("idx_tables_owner_user_id").on(table.ownerUserId), index("idx_tables_status_visibility").on(table.status, table.visibility)]);

export const tableMemberships = sqliteTable("table_memberships", {
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "player", "spectator", "dealer"] }).notNull(),
  connectionStatus: text("connection_status", { enum: ["connected", "disconnected", "left"] }).notNull(),
  ready: integer("ready", { mode: "boolean" }).notNull().default(false),
  leaveAfterRound: integer("leave_after_round", { mode: "boolean" }).notNull().default(false),
  pendingBet: integer("pending_bet"),
  joinedAt: text("joined_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  leftAt: text("left_at"),
}, (table) => [primaryKey({ columns: [table.tableId, table.userId] }), index("idx_memberships_user_id_status").on(table.userId, table.connectionStatus)]);

export const seats = sqliteTable("seats", {
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  seatNumber: integer("seat_number").notNull(),
  userId: text("user_id").references(() => users.id),
  reservedUntil: text("reserved_until"),
  occupiedAt: text("occupied_at"),
}, (table) => [primaryKey({ columns: [table.tableId, table.seatNumber] }), uniqueIndex("uq_seats_table_user").on(table.tableId, table.userId)]);

export const gameRounds = sqliteTable("game_rounds", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  gameType: text("game_type").notNull(),
  status: text("status", { enum: ["active", "settled", "cancelled"] }).notNull(),
  rulesJson: text("rules_json").notNull(),
  authoritativeStateJson: text("authoritative_state_json").notNull(),
  startedAt: text("started_at").notNull(),
  settledAt: text("settled_at"),
}, (table) => [uniqueIndex("uq_game_rounds_table_sequence").on(table.tableId, table.sequence), index("idx_game_rounds_table_started").on(table.tableId, table.startedAt)]);

export const roundParticipants = sqliteTable("round_participants", {
  roundId: text("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  seatNumber: integer("seat_number").notNull(),
  startingBalance: integer("starting_balance").notNull(),
  endingBalance: integer("ending_balance"),
  outcome: text("outcome"),
}, (table) => [primaryKey({ columns: [table.roundId, table.userId] })]);

export const bets = sqliteTable("bets", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  handId: text("hand_id"),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_bets_round_user").on(table.roundId, table.userId)]);

export const hands = sqliteTable("hands", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  seatNumber: integer("seat_number"),
  handIndex: integer("hand_index").notNull(),
  wager: integer("wager").notNull(),
  status: text("status").notNull(),
  total: integer("total"),
  isDealer: integer("is_dealer", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull().references(() => gameRounds.id, { onDelete: "cascade" }),
  handId: text("hand_id"),
  shoePosition: integer("shoe_position").notNull(),
  rank: text("rank").notNull(),
  suit: text("suit").notNull(),
  deckIndex: integer("deck_index").notNull(),
  dealtAt: text("dealt_at"),
  revealedAt: text("revealed_at"),
}, (table) => [uniqueIndex("uq_cards_round_shoe_position").on(table.roundId, table.shoePosition)]);

export const playerActions = sqliteTable("player_actions", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  roundId: text("round_id"),
  userId: text("user_id").notNull().references(() => users.id),
  actionType: text("action_type").notNull(),
  actionJson: text("action_json").notNull(),
  expectedVersion: integer("expected_version").notNull(),
  acceptedVersion: integer("accepted_version"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_actions_round_created").on(table.roundId, table.createdAt)]);

export const gameEvents = sqliteTable("game_events", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  roundId: text("round_id"),
  stateVersion: integer("state_version").notNull(),
  eventType: text("event_type").notNull(),
  publicPayloadJson: text("public_payload_json").notNull(),
  privatePayloadJson: text("private_payload_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("uq_game_events_table_version_id").on(table.tableId, table.stateVersion, table.id), index("idx_game_events_table_version").on(table.tableId, table.stateVersion)]);

export const inviteCodes = sqliteTable("invite_codes", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  codePrefix: text("code_prefix").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("uq_invite_codes_hash").on(table.codeHash), index("idx_invite_codes_table").on(table.tableId)]);

export const walletLedger = sqliteTable("wallet_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tableId: text("table_id"),
  roundId: text("round_id"),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("uq_wallet_ledger_idempotency").on(table.idempotencyKey), index("idx_wallet_ledger_user_created").on(table.userId, table.createdAt), index("idx_wallet_ledger_round").on(table.roundId)]);

export const statistics = sqliteTable("statistics", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  roundsPlayed: integer("rounds_played").notNull().default(0),
  handsWon: integer("hands_won").notNull().default(0),
  handsLost: integer("hands_lost").notNull().default(0),
  handsPushed: integer("hands_pushed").notNull().default(0),
  blackjacks: integer("blackjacks").notNull().default(0),
  biggestWin: integer("biggest_win").notNull().default(0),
  totalWagered: integer("total_wagered").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull().references(() => users.id),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull(),
  ipHash: text("ip_hash"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_admin_audit_actor_created").on(table.actorUserId, table.createdAt)]);

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  route: text("route").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseJson: text("response_json").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: text("window_started_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const stateTransitionLocks = sqliteTable("state_transition_locks", {
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  fromVersion: integer("from_version").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tableId, table.fromVersion] })]);

export const walletMutationLocks = sqliteTable("wallet_mutation_locks", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromVersion: integer("from_version").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.fromVersion] })]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind", { enum: ["message", "reaction"] }).notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_chat_messages_table_created").on(table.tableId, table.createdAt)]);

export const discordTableLinks = sqliteTable("discord_table_links", {
  tableId: text("table_id").primaryKey().references(() => tables.id, { onDelete: "cascade" }),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  createdByDiscordUserId: text("created_by_discord_user_id").notNull(),
  lastAnnouncedVersion: integer("last_announced_version").notNull().default(0),
  lastStatus: text("last_status").notNull().default("open"),
  lastRoundId: text("last_round_id"),
  lastSeatedCount: integer("last_seated_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_discord_table_links_channel").on(table.guildId, table.channelId)]);
