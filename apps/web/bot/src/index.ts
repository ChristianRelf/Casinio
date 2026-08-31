import { Client, EmbedBuilder, Events, GatewayIntentBits, RESTEvents, type TextBasedChannel } from "discord.js";
import { z } from "zod";
import { CasinoApi, type DiscordTableLink } from "./api";
import { handleCommand } from "./commands";

const config = z.object({
  DISCORD_BOT_TOKEN: z.string().min(20),
  DISCORD_BOT_API_SECRET: z.string().min(24),
  CASINO_API_ORIGIN: z.string().url(),
  APP_ORIGIN: z.string().url(),
}).parse(process.env);

const api = new CasinoApi(config.CASINO_API_ORIGIN, config.DISCORD_BOT_API_SECRET);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const log = (level: "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}) => {
  const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  target(JSON.stringify({ level, service: "low-stakes-discord-bot", event, at: new Date().toISOString(), ...details }));
};

function announcement(link: DiscordTableLink): string[] {
  const lines: string[] = [];
  if (link.status === "in_round" && link.last_status !== "in_round") lines.push("A new round has started. The dealer has taken this personally.");
  if (link.status === "open" && link.last_status === "in_round") lines.push("The round is settled. The arithmetic has declined an appeal.");
  if (link.status === "open" && link.seated_count !== link.last_seated_count) lines.push(`${link.seated_count} of ${link.max_seats} seats are occupied.`);
  return lines;
}

async function pollTableLinks() {
  if (polling || !client.isReady()) return;
  polling = true;
  try {
    const links = await api.tableLinks();
    for (const link of links) {
      if (link.state_version <= link.last_announced_version && link.status === link.last_status && link.seated_count === link.last_seated_count) continue;
      const lines = announcement(link);
      if (lines.length) {
        const channel = await client.channels.fetch(link.channel_id);
        if (!channel?.isTextBased() || !("send" in channel)) throw new Error(`Linked channel ${link.channel_id} is not sendable`);
        await (channel as TextBasedChannel & { send: (options: unknown) => Promise<unknown> }).send({
          embeds: [new EmbedBuilder().setColor(0xb58b4a).setTitle(link.name).setDescription(lines.join("\n")).setFooter({ text: "Play money only • Table events are intentionally quiet" })],
          allowedMentions: { parse: [] },
        });
      }
      await api.acknowledgeLink(link.table_id, { stateVersion: link.state_version, status: link.status, roundId: link.current_round_id, seatedCount: link.seated_count });
    }
  } catch (error) {
    log("warn", "table_link_poll_failed", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    polling = false;
  }
}

client.once(Events.ClientReady, (readyClient) => {
  log("info", "ready", { botUserId: readyClient.user.id, guildCount: readyClient.guilds.cache.size });
  void pollTableLinks();
  pollTimer = setInterval(() => void pollTableLinks(), 15_000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  log("info", "command", { name: interaction.commandName, guildId: interaction.guildId, userId: interaction.user.id });
  await handleCommand(interaction, api, config.APP_ORIGIN);
});

client.rest.on(RESTEvents.RateLimited, (rateLimit) => log("warn", "discord_rate_limited", { route: rateLimit.route, retryAfter: rateLimit.retryAfter, global: rateLimit.global }));
client.on(Events.Error, (error) => log("error", "client_error", { message: error.message, stack: error.stack }));
client.on(Events.Warn, (message) => log("warn", "client_warning", { message }));

const shutdown = async (signal: string) => {
  log("info", "shutdown", { signal });
  if (pollTimer) clearInterval(pollTimer);
  client.destroy();
  process.exitCode = 0;
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.DISCORD_BOT_TOKEN);
