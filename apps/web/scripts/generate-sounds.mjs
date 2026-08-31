import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44_100;
const output = fileURLToPath(new URL("../public/assets/sounds/", import.meta.url));

const cues = {
  deal: [[0, 0.07, 185, "noise"], [0.035, 0.08, 120, "triangle"]],
  flip: [[0, 0.08, 300, "noise"], [0.04, 0.11, 450, "sine"]],
  chip: [[0, 0.055, 760, "triangle"], [0.045, 0.1, 510, "sine"]],
  "chip-land": [[0, 0.06, 620, "triangle"], [0.035, 0.13, 340, "triangle"], [0.075, 0.1, 210, "sine"]],
  button: [[0, 0.065, 270, "triangle"]],
  win: [[0, 0.18, 392, "sine"], [0.09, 0.2, 494, "sine"], [0.18, 0.3, 659, "sine"]],
  loss: [[0, 0.24, 180, "saw"], [0.08, 0.34, 120, "triangle"]],
  blackjack: [[0, 0.16, 440, "sine"], [0.08, 0.18, 554, "sine"], [0.16, 0.2, 659, "sine"], [0.24, 0.4, 880, "sine"]],
  reveal: [[0, 0.38, 110, "sine"], [0.14, 0.32, 165, "triangle"], [0.02, 0.18, 80, "noise"]],
  notice: [[0, 0.14, 520, "sine"], [0.07, 0.16, 650, "sine"]],
};

let noiseState = 0x51a7e5;
const noise = () => {
  noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
  return (noiseState / 0xffffffff) * 2 - 1;
};

function oscillator(kind, phase) {
  if (kind === "triangle") return 2 * Math.asin(Math.sin(phase)) / Math.PI;
  if (kind === "saw") return 2 * ((phase / (2 * Math.PI)) % 1) - 1;
  if (kind === "noise") return noise();
  return Math.sin(phase);
}

function makeWave(parts) {
  const duration = Math.max(...parts.map(([start, length]) => start + length)) + 0.04;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  for (const [start, length, frequency, kind] of parts) {
    const first = Math.floor(start * sampleRate); const count = Math.floor(length * sampleRate);
    for (let index = 0; index < count; index += 1) {
      const progress = index / count; const envelope = Math.pow(1 - progress, kind === "noise" ? 3 : 2);
      samples[first + index] += oscillator(kind, 2 * Math.PI * frequency * index / sampleRate) * envelope * (kind === "noise" ? 0.22 : 0.42);
    }
  }
  const dataBytes = samples.length * 2; const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + index * 2));
  return buffer;
}

await mkdir(output, { recursive: true });
for (const [name, parts] of Object.entries(cues)) await writeFile(join(output, `${name}.wav`), makeWave(parts));
