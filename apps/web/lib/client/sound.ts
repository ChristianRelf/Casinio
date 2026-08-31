"use client";

export type SoundCue = "deal" | "flip" | "chip" | "button" | "win" | "loss" | "blackjack" | "reveal" | "notice";

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext(); return context;
}

export async function playSound(cue: SoundCue, enabled: boolean, volume: number) {
  if (!enabled) return; const ctx = audioContext(); if (!ctx) return;
  if (ctx.state === "suspended") await ctx.resume();
  const now = ctx.currentTime; const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * .12, now); gain.connect(ctx.destination);
  const tone = (frequency: number, duration: number, type: OscillatorType = "sine", delay = 0) => {
    const osc = ctx.createOscillator(); const local = ctx.createGain(); osc.type = type; osc.frequency.setValueAtTime(frequency, now + delay); local.gain.setValueAtTime(1, now + delay); local.gain.exponentialRampToValueAtTime(.001, now + delay + duration); osc.connect(local).connect(gain); osc.start(now + delay); osc.stop(now + delay + duration);
  };
  if (cue === "deal") { tone(180, .08, "triangle"); tone(120, .09, "triangle", .045); }
  if (cue === "flip") { tone(280, .1, "sine"); tone(430, .12, "triangle", .05); }
  if (cue === "chip") { tone(720, .05, "square"); tone(490, .09, "triangle", .045); }
  if (cue === "button") tone(260, .06, "triangle");
  if (cue === "win") { tone(392, .18, "sine"); tone(494, .2, "sine", .09); tone(659, .3, "sine", .18); }
  if (cue === "loss") { tone(180, .22, "sawtooth"); tone(120, .3, "triangle", .08); }
  if (cue === "blackjack") { tone(440, .16); tone(554, .18, "sine", .08); tone(659, .2, "sine", .16); tone(880, .38, "sine", .24); }
  if (cue === "reveal") { tone(110, .36, "sine"); tone(165, .3, "triangle", .14); }
  if (cue === "notice") tone(520, .14, "sine");
}
