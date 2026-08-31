import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardBack, PlayingCard, RANKS, SUITS } from "../components/cards/PlayingCard";

const root = process.cwd();

describe("complete local card deck", () => {
  it("renders every unique rank and suit plus a card back", () => {
    const faces = SUITS.flatMap(suit => RANKS.map(rank => renderToStaticMarkup(createElement(PlayingCard, { rank, suit }))));
    expect(faces).toHaveLength(52);
    expect(new Set(faces).size).toBe(52);
    for (const markup of faces) {
      expect(markup).toContain('role="img"');
      expect(markup).not.toMatch(/[♠♥♦♣]/u);
      expect(markup).not.toMatch(/https?:\/\//u);
    }
    const back = renderToStaticMarkup(createElement(CardBack));
    expect(back).toContain('aria-label="Face-down card"');
    expect(back).toContain("back-lattice");
  });
});

describe("dealer sprite pack", () => {
  it("contains every manifest pose on one coherent PNG canvas", () => {
    const directory = join(root, "public", "assets", "dealer");
    const manifest = JSON.parse(readFileSync(join(directory, "sprite-manifest.json"), "utf8")) as {
      complete: boolean;
      format: string;
      canvas: { width: number; height: number };
      registrationPoint: { x: number; y: number };
      poses: Record<string, string>;
    };
    expect(manifest).toMatchObject({ complete: true, format: "image/png", canvas: { width: 1600, height: 1600 }, registrationPoint: { x: 2205, y: 304 } });
    expect(Object.keys(manifest.poses)).toHaveLength(10);
    for (const filename of Object.values(manifest.poses)) {
      const bytes = readFileSync(join(directory, "source", filename));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(manifest.canvas.width);
      expect(bytes.readUInt32BE(20)).toBe(manifest.canvas.height);
    }
  });
});

describe("local sound library", () => {
  it("keeps all runtime cues local and available", () => {
    const directory = join(root, "public", "assets", "sounds");
    const manifest = JSON.parse(readFileSync(join(directory, "sound-manifest.json"), "utf8")) as { cues: Record<string, { custom?: string; fallback: string }> };
    expect(Object.keys(manifest.cues)).toHaveLength(10);
    for (const cue of Object.values(manifest.cues)) expect(readFileSync(join(directory, cue.fallback)).byteLength).toBeGreaterThan(1000);
    for (const filename of ["button.wav", "loss.wav"]) expect(readFileSync(join(directory, "source", "custom", filename)).byteLength).toBeGreaterThan(1000);
    for (let index = 1; index <= 8; index += 1) expect(readFileSync(join(directory, "source", "kenney-casino-audio", `card-slide-${index}.ogg`)).byteLength).toBeGreaterThan(1000);
    for (let index = 1; index <= 6; index += 1) expect(readFileSync(join(directory, "source", "kenney-casino-audio", `chips-handle-${index}.ogg`)).byteLength).toBeGreaterThan(1000);
  });
});
