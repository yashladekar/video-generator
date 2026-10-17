import { createHash } from "node:crypto";

import { encodeWav } from "../../lib/wav";
import type {
  MusicGenerateInput,
  MusicGenerateOutput,
  MusicProvider,
  ProviderCallContext,
  ResolvedProvider,
} from "../types";

const SAMPLE_RATE = 44_100;

type Preset = {
  bpm: number;
  chords: number[][];
  style: "pad" | "drone" | "arp" | "keys";
  drums: boolean;
  noise: number;
};

const PRESETS: Record<string, Preset> = {
  ambient: {
    bpm: 60,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ],
    style: "pad",
    drums: false,
    noise: 0.004,
  },
  cinematic: {
    bpm: 72,
    chords: [
      [50, 53, 57],
      [46, 50, 53],
      [48, 52, 55],
      [45, 48, 52],
    ],
    style: "drone",
    drums: true,
    noise: 0.003,
  },
  upbeat: {
    bpm: 112,
    chords: [
      [48, 52, 55],
      [55, 59, 62],
      [57, 60, 64],
      [53, 57, 60],
    ],
    style: "arp",
    drums: true,
    noise: 0.002,
  },
  lofi: {
    bpm: 76,
    chords: [
      [53, 57, 60, 64],
      [52, 55, 59, 62],
      [50, 53, 57, 60],
      [48, 52, 55, 59],
    ],
    style: "keys",
    drums: true,
    noise: 0.012,
  },
};

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function envelope(time: number, duration: number, attack: number, release: number): number {
  if (time < 0 || time > duration) return 0;
  if (time < attack) return time / attack;
  if (time > duration - release) {
    return Math.max(0, (duration - time) / release);
  }
  return 1;
}

function lowPass(previous: number, input: number, alpha: number): number {
  return previous + alpha * (input - previous);
}

export async function renderProceduralMusic(
  mood: string,
  durationSeconds: number,
  seed = 1,
): Promise<{ audio: Buffer; durationSeconds: number }> {
  const preset = PRESETS[mood] ?? PRESETS.ambient!;
  const duration = Math.max(1, Math.min(180, durationSeconds));
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const rand = seededRandom(seed);

  const beatDuration = 60 / preset.bpm;
  const chordDuration = beatDuration * 4;
  let chordIndex = 0;
  let chordStart = 0;
  let lowPassL = 0;
  let lowPassR = 0;

  while (chordStart < duration) {
    const chord = preset.chords[chordIndex % preset.chords.length] ?? [48, 52, 55];
    const segmentEnd = Math.min(duration, chordStart + chordDuration);
    const segmentFrames = Math.ceil(segmentEnd * SAMPLE_RATE);
    const startFrame = Math.floor(chordStart * SAMPLE_RATE);

    for (let frame = startFrame; frame < segmentFrames; frame += 1) {
      const t = frame / SAMPLE_RATE;
      const local = t - chordStart;
      let l = 0;
      let r = 0;
      const padEnvelope = envelope(local, chordDuration, 0.6, 0.9);

      if (preset.style === "pad" || preset.style === "drone" || preset.style === "keys") {
        chord.forEach((midi, noteIndex) => {
          const freq = midiToFreq(midi);
          const detune = preset.style === "pad" ? 1.003 : 1;
          const amp = preset.style === "drone" ? 0.06 : 0.08;
          const oscL =
            Math.sin(2 * Math.PI * freq * t) * 0.65 +
            Math.sin(2 * Math.PI * freq * 2 * t) * 0.18 +
            Math.sin(2 * Math.PI * freq * detune * t) * 0.17;
          const pan = noteIndex % 2 === 0 ? 0.65 : 0.35;
          const value = oscL * amp * padEnvelope;
          l += value * pan;
          r += value * (1 - pan);
        });
        if (preset.style === "drone") {
          const sub = midiToFreq((chord[0] ?? 48) - 12);
          const value = Math.sin(2 * Math.PI * sub * t) * 0.05 * padEnvelope;
          l += value;
          r += value;
        }
      }

      if (preset.style === "arp" || preset.style === "keys") {
        const subdivision = preset.style === "arp" ? beatDuration / 2 : beatDuration;
        const noteIndex = Math.floor(local / subdivision) % chord.length;
        const noteTime = local % subdivision;
        const midi = chord[noteIndex] ?? chord[0] ?? 48;
        const freq = midiToFreq(midi + (preset.style === "arp" ? 12 : 0));
        const env = envelope(noteTime, subdivision * 0.95, 0.01, subdivision * 0.5);
        const value =
          Math.sin(2 * Math.PI * freq * t) * 0.1 * env +
          Math.sin(2 * Math.PI * freq * 2 * t) * 0.02 * env;
        const pan = noteIndex % 2 === 0 ? 0.6 : 0.4;
        l += value * pan;
        r += value * (1 - pan);
      }

      if (preset.drums) {
        const beatTime = local % beatDuration;
        if (beatTime < 0.16) {
          const kick = Math.sin(2 * Math.PI * (110 - beatTime * 300) * beatTime);
          const env = Math.max(0, 1 - beatTime / 0.16);
          const value = kick * 0.18 * env;
          l += value;
          r += value;
        }
        const offBeat = (local + beatDuration / 2) % beatDuration;
        if (offBeat < 0.06) {
          const hat = (rand() * 2 - 1) * Math.max(0, 1 - offBeat / 0.06) * 0.025;
          l += hat;
          r += hat;
        }
      }

      if (preset.noise > 0) {
        const noise = (rand() * 2 - 1) * preset.noise;
        lowPassL = lowPass(lowPassL, noise, 0.08);
        lowPassR = lowPass(lowPassR, noise * 0.9, 0.08);
        l += lowPassL;
        r += lowPassR;
      }

      left[frame] = l;
      right[frame] = r;
    }

    chordStart = segmentEnd;
    chordIndex += 1;
  }

  const fadeFrames = Math.min(Math.floor(SAMPLE_RATE * 1.2), Math.floor(frames / 4));
  for (let i = 0; i < fadeFrames; i += 1) {
    const gain = i / fadeFrames;
    const a = frames - 1 - i;
    left[i] = (left[i] ?? 0) * gain;
    right[i] = (right[i] ?? 0) * gain;
    if (a >= 0) {
      left[a] = (left[a] ?? 0) * gain;
      right[a] = (right[a] ?? 0) * gain;
    }
  }

  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    peak = Math.max(peak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
  }
  const scale = peak > 0 ? Math.min(1, 0.65 / peak) : 1;
  for (let i = 0; i < frames; i += 1) {
    left[i] = (left[i] ?? 0) * scale;
    right[i] = (right[i] ?? 0) * scale;
  }

  return {
    audio: encodeWav(left, right, SAMPLE_RATE),
    durationSeconds: frames / SAMPLE_RATE,
  };
}

export const proceduralMusicProvider: MusicProvider = {
  provider: "music-generator",
  async generateMusic(
    input: MusicGenerateInput,
    _resolved: ResolvedProvider,
    _ctx: ProviderCallContext,
  ): Promise<MusicGenerateOutput> {
    const seed =
      input.seed ??
      createHash("sha256")
        .update(`${input.mood}:${input.durationSeconds}`)
        .digest()
        .readUInt32BE(0);
    const generated = await renderProceduralMusic(
      input.mood,
      input.durationSeconds,
      seed,
    );
    return {
      audio: generated.audio,
      mimeType: "audio/wav",
      durationSeconds: generated.durationSeconds,
      provider: "music-generator",
      usage: {
        unit: "track",
        inputUnits: 1,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};
