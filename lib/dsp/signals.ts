/**
 * Synthetic test signals for reproducible experiments and debugging.
 * All at a given sample rate; output is peak-normalized to [-1, 1].
 */

export type SignalType =
  | "sine"
  | "chirp"
  | "tone_plus_noise"
  | "am_tone";

function peakNormalize(samples: Float32Array): void {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > max) max = a;
  }
  if (max > 0) {
    for (let i = 0; i < samples.length; i++) samples[i] /= max;
  }
}

/** White noise in [-1, 1] using Math.random(). */
function whiteNoise(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = 2 * Math.random() - 1;
  }
  return out;
}

/** Sine tone at given frequency. */
export function generateSineTone(
  sampleRate: number,
  durationSeconds: number,
  frequencyHz: number
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds);
  const out = new Float32Array(n);
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(omega * i);
  }
  peakNormalize(out);
  return out;
}

/** Linear chirp from f0 to f1 over duration. */
export function generateChirp(
  sampleRate: number,
  durationSeconds: number,
  f0Hz: number,
  f1Hz: number
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds);
  const out = new Float32Array(n);
  const k = (f1Hz - f0Hz) / durationSeconds;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = f0Hz + k * t;
    const phase = 2 * Math.PI * (f0Hz * t + (k / 2) * t * t);
    out[i] = Math.sin(phase);
  }
  peakNormalize(out);
  return out;
}

/** Sine tone plus white noise. noiseLevel 0 = pure tone, 1 = tone and noise equal RMS before norm. */
export function generateTonePlusNoise(
  sampleRate: number,
  durationSeconds: number,
  frequencyHz: number,
  noiseLevel: number
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds);
  const tone = generateSineTone(sampleRate, durationSeconds, frequencyHz);
  const noise = whiteNoise(n);
  const out = new Float32Array(n);
  const gTone = 1 - noiseLevel;
  const gNoise = noiseLevel;
  for (let i = 0; i < n; i++) {
    out[i] = gTone * tone[i] + gNoise * noise[i];
  }
  peakNormalize(out);
  return out;
}

/** Amplitude-modulated tone: carrier with modulator. x(t) = (1 + depth*sin(2π fm t)) * sin(2π fc t). */
export function generateAmTone(
  sampleRate: number,
  durationSeconds: number,
  carrierHz: number,
  modFrequencyHz: number,
  modDepth: number
): Float32Array {
  const n = Math.floor(sampleRate * durationSeconds);
  const out = new Float32Array(n);
  const omegaC = (2 * Math.PI * carrierHz) / sampleRate;
  const omegaM = (2 * Math.PI * modFrequencyHz) / sampleRate;
  for (let i = 0; i < n; i++) {
    const envelope = 1 + modDepth * Math.sin(omegaM * i);
    out[i] = envelope * Math.sin(omegaC * i);
  }
  peakNormalize(out);
  return out;
}

/** Build signal from type and simple options (for UI). */
export function buildTestSignal(
  type: SignalType,
  options: {
    sampleRate: number;
    durationSeconds: number;
    frequencyHz?: number;
    chirpStartHz?: number;
    chirpEndHz?: number;
    noiseLevel?: number;
    modFrequencyHz?: number;
    modDepth?: number;
  }
): Float32Array {
  const sr = options.sampleRate;
  const dur = options.durationSeconds;
  const f = options.frequencyHz ?? 440;

  switch (type) {
    case "sine":
      return generateSineTone(sr, dur, f);
    case "chirp":
      return generateChirp(
        sr,
        dur,
        options.chirpStartHz ?? 200,
        options.chirpEndHz ?? 4000
      );
    case "tone_plus_noise":
      return generateTonePlusNoise(sr, dur, f, options.noiseLevel ?? 0.3);
    case "am_tone":
      return generateAmTone(
        sr,
        dur,
        f,
        options.modFrequencyHz ?? 5,
        options.modDepth ?? 0.5
      );
    default:
      return generateSineTone(sr, dur, f);
  }
}
