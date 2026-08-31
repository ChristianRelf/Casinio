"use client";

export type SoundCue = "deal" | "flip" | "chip" | "chip-land" | "button" | "win" | "loss" | "blackjack" | "reveal" | "notice";

const paths: Record<SoundCue, readonly string[]> = {
  deal: [1, 2, 3, 4, 5, 6, 7, 8].map(index => `/assets/sounds/source/kenney-casino-audio/card-slide-${index}.ogg`),
  flip: [1, 2, 3, 4].map(index => `/assets/sounds/source/kenney-casino-audio/card-place-${index}.ogg`),
  chip: [1, 2, 3, 4, 5, 6].map(index => `/assets/sounds/source/kenney-casino-audio/chips-handle-${index}.ogg`),
  "chip-land": [1, 2, 3, 4, 5, 6].map(index => `/assets/sounds/source/kenney-casino-audio/chips-stack-${index}.ogg`),
  button: ["/assets/sounds/source/kenney-casino-audio/chip-lay-2.ogg"],
  win: ["/assets/sounds/source/kenney-casino-audio/chips-stack-6.ogg"],
  loss: ["/assets/sounds/source/kenney-casino-audio/chips-collide-4.ogg"],
  blackjack: ["/assets/sounds/source/kenney-casino-audio/cards-pack-open-1.ogg"],
  reveal: ["/assets/sounds/source/kenney-casino-audio/card-fan-2.ogg"],
  notice: ["/assets/sounds/source/kenney-casino-audio/chip-lay-1.ogg"],
};

// Custom one-shots override the reviewed local fallbacks as soon as their
// conventional filenames are dropped into source/custom. Missing optional
// files are remembered for the lifetime of the page, so gameplay never waits
// on repeated 404s.
const customOverrides: Partial<Record<SoundCue, string>> = {
  button: "/assets/sounds/source/custom/button.wav",
  win: "/assets/sounds/source/custom/win.wav",
  loss: "/assets/sounds/source/custom/loss.wav",
  blackjack: "/assets/sounds/source/custom/blackjack.wav",
  reveal: "/assets/sounds/source/custom/reveal.wav",
  notice: "/assets/sounds/source/custom/notice.wav",
};

let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
const cueCursor = new Map<SoundCue, number>();
const unavailable = new Set<string>();

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext(); return context;
}

function nextPath(cue: SoundCue) {
  const choices = paths[cue];
  const cursor = cueCursor.get(cue) ?? 0;
  cueCursor.set(cue, cursor + 1);
  return choices[cursor % choices.length];
}

async function load(path: string, ctx: AudioContext) {
  const existing = buffers.get(path); if (existing) return existing;
  const pending = fetch(path, { cache: "force-cache" }).then(async (response) => {
    if (!response.ok) throw new Error(`Sound asset ${path} is unavailable`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  });
  buffers.set(path, pending);
  pending.catch(() => buffers.delete(path));
  return pending;
}

export async function playSound(cue: SoundCue, enabled: boolean, volume: number) {
  if (!enabled) return; const ctx = audioContext(); if (!ctx) return;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const candidates = [customOverrides[cue], nextPath(cue)].filter((path): path is string => path !== undefined && !unavailable.has(path));
  for (const path of candidates) {
    try {
      const source = ctx.createBufferSource(); const gain = ctx.createGain();
      source.buffer = await load(path, ctx); gain.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gain).connect(ctx.destination); source.start(); return;
    } catch {
      unavailable.add(path);
    }
  }
  // Audio is optional; blocked or unavailable cues must never interrupt play.
}
