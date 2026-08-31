import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import { CasinoApi, CasinoApiError, type TableStatus } from "./api";

const GOLD = 0xb58b4a;
const CREAM = 0xf1e5ce;

export const commandDefinitions = [
  new SlashCommandBuilder().setName("casino").setDescription("Open the private Low Stakes casino"),
  new SlashCommandBuilder().setName("table").setDescription("Create and manage a blackjack table")
    .addSubcommand((command) => command.setName("create").setDescription("Create a private blackjack table")
      .addStringOption((option) => option.setName("name").setDescription("Table name").setMinLength(2).setMaxLength(40).setRequired(true))
      .addIntegerOption((option) => option.setName("minimum").setDescription("Minimum play-money bet").setMinValue(1).setMaxValue(100_000))
      .addIntegerOption((option) => option.setName("maximum").setDescription("Maximum play-money bet").setMinValue(1).setMaxValue(1_000_000))
      .addIntegerOption((option) => option.setName("seats").setDescription("Player seats").setMinValue(1).setMaxValue(7)))
    .addSubcommand((command) => command.setName("join").setDescription("Get the secure link for a table code")
      .addStringOption((option) => option.setName("code").setDescription("Short invite code").setMinLength(4).setMaxLength(20).setRequired(true)))
    .addSubcommand((command) => command.setName("status").setDescription("Show the status of a table you joined")
      .addStringOption((option) => option.setName("table").setDescription("Table ID or invite code").setMinLength(4).setMaxLength(80).setRequired(true)))
    .addSubcommand((command) => command.setName("close").setDescription("Close a table you own")
      .addStringOption((option) => option.setName("table").setDescription("Table ID or invite code").setMinLength(4).setMaxLength(80).setRequired(true))),
  new SlashCommandBuilder().setName("balance").setDescription("Show your current play-money balance"),
  new SlashCommandBuilder().setName("stats").setDescription("Show your blackjack statistics"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Show the social blackjack leaderboard"),
  new SlashCommandBuilder().setName("help").setDescription("Show Low Stakes commands and rules"),
].map((command) => command.setDMPermission(false).toJSON());

export const money = (value: number) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 })}`;

export function tableEmbed(table: Pick<TableStatus, "name" | "owner_display_name" | "status" | "seated_count" | "max_seats" | "min_bet" | "max_bet">, joinUrl: string) {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(table.name)
    .setDescription(`[Take a seat at the table](${joinUrl})\n\nPrivate blackjack with friends. Every chip is play money with no cash value.`)
    .addFields(
      { name: "Host", value: table.owner_display_name, inline: true },
      { name: "Table", value: table.status === "in_round" ? "Round in progress" : "Waiting for players", inline: true },
      { name: "Seats", value: `${table.seated_count} / ${table.max_seats}`, inline: true },
      { name: "Limits", value: `${money(table.min_bet)} – ${money(table.max_bet)}`, inline: true },
      { name: "Dealer", value: "The House, automated", inline: true },
      { name: "Value", value: "Play money only", inline: true },
    )
    .setFooter({ text: "LOW STAKES • No purchases, cash-out, prizes, or transfers" });
}

const privateReply = (content: string): InteractionReplyOptions => ({ content, ephemeral: true, allowedMentions: { parse: [] } });

async function resolveTable(api: CasinoApi, reference: string) {
  if (reference.startsWith("tbl_")) return reference;
  return (await api.validateInvite(reference.trim().toUpperCase())).tableId;
}

export async function handleCommand(interaction: ChatInputCommandInteraction, api: CasinoApi, appOrigin: string) {
  try {
    if (interaction.commandName === "casino") {
      await interaction.reply(privateReply(`Open Low Stakes: ${appOrigin}\n\nYou must sign in with Discord and confirm the permitted age for play-money casino games where you live. Currency has no monetary value.`));
      return;
    }

    if (interaction.commandName === "table") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "create") {
        await interaction.deferReply({ ephemeral: false });
        const minBet = interaction.options.getInteger("minimum") ?? 25;
        const maxBet = interaction.options.getInteger("maximum") ?? 500;
        if (maxBet < minBet) throw new CasinoApiError("Maximum bet must be at least the minimum bet", 400, "INVALID_LIMITS");
        const created = await api.createTable(interaction.user.id, {
          name: interaction.options.getString("name", true),
          minBet,
          maxBet,
          maxSeats: interaction.options.getInteger("seats") ?? 7,
        }, interaction.id);
        const joinUrl = new URL(created.joinUrl, appOrigin).toString();
        const message = await interaction.editReply({
          embeds: [tableEmbed({
            name: interaction.options.getString("name", true),
            owner_display_name: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.globalName ?? interaction.user.username,
            status: "open",
            seated_count: 0,
            max_seats: interaction.options.getInteger("seats") ?? 7,
            min_bet: minBet,
            max_bet: maxBet,
          }, joinUrl)],
          components: [],
          allowedMentions: { parse: [] },
        });
        if (interaction.guildId && interaction.channelId) await api.linkTable(created.tableId, {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: message.id,
          discordUserId: interaction.user.id,
        });
        return;
      }

      if (subcommand === "join") {
        const code = interaction.options.getString("code", true).trim().toUpperCase();
        const invite = await api.validateInvite(code);
        const joinUrl = new URL(`/join/${encodeURIComponent(code)}`, appOrigin).toString();
        await interaction.reply(privateReply(`${invite.tableName} is ${invite.status === "in_round" ? "mid-round; you can spectate until the next hand" : "waiting"}.\n\nJoin securely: ${joinUrl}`));
        return;
      }

      const tableId = await resolveTable(api, interaction.options.getString("table", true));
      if (subcommand === "status") {
        const table = await api.tableStatus(tableId, interaction.user.id);
        await interaction.reply({ embeds: [tableEmbed(table, new URL(`/table/${table.id}`, appOrigin).toString())], ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (subcommand === "close") {
        await api.closeTable(tableId, interaction.user.id);
        await interaction.reply({ content: "Table closed. Existing invite links have been revoked.", allowedMentions: { parse: [] } });
        return;
      }
    }

    if (interaction.commandName === "balance") {
      const wallet = await api.balance(interaction.user.id);
      await interaction.reply(privateReply(`Your play-money balance is ${money(Number(wallet.balance))}. It cannot be purchased, transferred, exchanged, or cashed out.`));
      return;
    }

    if (interaction.commandName === "stats") {
      const stats = await api.stats(interaction.user.id);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(GOLD).setTitle("Your blackjack record").addFields(
          { name: "Rounds", value: String(stats.rounds_played ?? 0), inline: true },
          { name: "Hands won", value: String(stats.hands_won ?? 0), inline: true },
          { name: "Pushes", value: String(stats.hands_pushed ?? 0), inline: true },
          { name: "Blackjacks", value: String(stats.blackjacks ?? 0), inline: true },
          { name: "Biggest win", value: money(Number(stats.biggest_win ?? 0)), inline: true },
          { name: "Total wagered", value: money(Number(stats.total_wagered ?? 0)), inline: true },
        ).setFooter({ text: "All figures use play money with no monetary value" })],
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "leaderboard") {
      const rows = await api.leaderboard();
      const body = rows.length ? rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.display_name} — ${Number(row.hands_won ?? 0)} wins, ${Number(row.blackjacks ?? 0)} blackjacks`).join("\n") : "No completed rounds yet. A suspiciously peaceful beginning.";
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(GOLD).setTitle("Low Stakes leaderboard").setDescription(body).setFooter({ text: "Social standings only • Play money has no cash value" })], allowedMentions: { parse: [] } });
      return;
    }

    if (interaction.commandName === "help") {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(CREAM).setTitle("Low Stakes commands").setDescription([
          "`/casino` Open the web casino",
          "`/table create` Create a private table",
          "`/table join` Open an invite code",
          "`/table status` Check a table you joined",
          "`/table close` Close a table you own",
          "`/balance` View play-money balance",
          "`/stats` View your record",
          "`/leaderboard` View social standings",
          "",
          `[Blackjack rules and accessibility guide](${new URL("/rules", appOrigin)})`,
        ].join("\n")).setFooter({ text: "Private social blackjack • No real-money gambling" })],
        ephemeral: true,
      });
    }
  } catch (error) {
    const message = error instanceof CasinoApiError
      ? `${error.message}${error.requestId ? ` (reference ${error.requestId})` : ""}`
      : "The casino host hit an unexpected problem. Please try once more.";
    const payload = privateReply(message);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, embeds: [], components: [], allowedMentions: { parse: [] } });
    else await interaction.reply(payload);
  }
}
