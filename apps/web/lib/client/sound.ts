"use client";

export type SoundCue = "deal" | "flip" | "chip" | "chip-land" | "button" | "win" | "loss" | "blackjack" | "reveal" | "notice";

const paths: Record<SoundCue, string> = {
  deal: "/assets/sounds/deal.wav", flip: "/assets/sounds/flip.wav", chip: "/assets/sounds/chip.wav", "chip-land": "/assets/sounds/chip-land.wav",
  button: "/assets/sounds/button.wav", win: "/assets/sounds/win.wav", loss: "/assets/sounds/loss.wav", blackjack: "/assets/sounds/blackjack.wav",
  reveal: "/assets/sounds/reveal.wav", notice: "/assets/sounds/notice.wav",
};

let context: AudioContext | null = null;
const buffers = new Map<SoundCue, Promise<AudioBuffer>>();

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext(); return context;
}

async function load(cue: SoundCue, ctx: AudioContext) {
  const existing = buffers.get(cue); if (existing) return existing;
  const pending = fetch(paths[cue], { cache: "force-cache" }).then(async (response) => {
    if (!response.ok) throw new Error(`Sound asset ${cue} is unavailable`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  });
  buffers.set(cue, pending); return pending;
}

export async function playSound(cue: SoundCue, enabled: boolean, volume: number) {
  if (!enabled) return; const ctx = audioContext(); if (!ctx) return;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createBufferSource(); const gain = ctx.createGain();
    source.buffer = await load(cue, ctx); gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain).connect(ctx.destination); source.start();
  } catch {
    // Audio is optional; a blocked or unavailable cue must never interrupt play.
  }
}
