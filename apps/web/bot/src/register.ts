import { REST, Routes } from "discord.js";
import { z } from "zod";
import { commandDefinitions } from "./commands";

const config = z.object({
  DISCORD_BOT_TOKEN: z.string().min(20),
  DISCORD_CLIENT_ID: z.string().min(3),
  DISCORD_COMMAND_GUILD_ID: z.string().min(3).optional(),
}).parse(process.env);

const rest = new REST({ version: "10" }).setToken(config.DISCORD_BOT_TOKEN);
const route = config.DISCORD_COMMAND_GUILD_ID
  ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_COMMAND_GUILD_ID)
  : Routes.applicationCommands(config.DISCORD_CLIENT_ID);

await rest.put(route, { body: commandDefinitions });
console.log(JSON.stringify({
  level: "info",
  service: "low-stakes-discord-bot",
  event: "commands_registered",
  scope: config.DISCORD_COMMAND_GUILD_ID ? "guild" : "global",
  commandCount: commandDefinitions.length,
  at: new Date().toISOString(),
}));
