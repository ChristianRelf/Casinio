import { describe, expect, it } from "vitest";
import { commandDefinitions, tableEmbed } from "./commands";

describe("Discord command surface", () => {
  it("registers every production command exactly once", () => {
    const names = commandDefinitions.map((command) => command.name);
    expect(names).toEqual(["casino", "table", "balance", "stats", "leaderboard", "help"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds a play-money table embed without exposing authoritative state", () => {
    const embed = tableEmbed({ name: "Friday table", owner_display_name: "Chris", status: "open", seated_count: 2, max_seats: 7, min_bet: 25, max_bet: 500 }, "https://casino.example/join/ABC123").toJSON();
    expect(embed.description).toContain("play money");
    expect(embed.description).toContain("https://casino.example/join/ABC123");
    expect(JSON.stringify(embed)).not.toContain("game_state_json");
  });
});
