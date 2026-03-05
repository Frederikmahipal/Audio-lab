/**
 * Synthetic test signals for reproducible DSP demos.
 * Output is peak-normalized to [-1, 1].
 */

export type SignalType = "harmonic_sweep" | "step_pattern";

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

function fadeInOutGain(i: number, n: number, fadeSamples: number): number {
  const f = Math.max(1, Math.min(fadeSamples, Math.floor(n / 2)));
  if (i < f) {
    return Math.sin((0.5 * Math.PI * i) / f);
  }
  if (i > n - f - 1) {
    const k = n - 1 - i;
    return Math.sin((0.5 * Math.PI * k) / f);
  }
  return 1;
}

function lcgNext(state: number): number {
  return (1664525 * state + 1013904223) >>> 0;
}

/**
 * Harmonic sweep:
 * Fundamental glides up and harmonics follow it.
 * Spectrogram shows multiple curved/diagonal bands.
 */
export function generateHarmonicSweep(
  sampleRate: number,
  durationSeconds: number
): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const out = new Float32Array(n);
  const fStart = 140;
  const fEnd = 2400;
  const fade = Math.floor(0.04 * sampleRate);
  let phase = 0;

  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    const f0 = fStart * Math.pow(fEnd / fStart, u);
    phase += (2 * Math.PI * f0) / sampleRate;

    const h1 = Math.sin(phase);
    const h2 = 0.56 * Math.sin(2 * phase);
    const h3 = 0.34 * Math.sin(3 * phase);
    const h4 = 0.2 * Math.sin(4 * phase);
    const voiced = (h1 + h2 + h3 + h4) / 2.1;

    const slowAm = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 3.2 * i) / sampleRate));
    out[i] = voiced * slowAm * fadeInOutGain(i, n, fade);
  }

  peakNormalize(out);
  return out;
}

/**
 * Step pattern:
 * Harmonic notes in blocks + short broadband bursts at transitions.
 * Spectrogram shows horizontal harmonic stacks and vertical transients.
 */
export function generateStepPattern(
  sampleRate: number,
  durationSeconds: number
): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const out = new Float32Array(n);
  const freqs = [180, 260, 360, 520, 700, 460, 320, 240];
  const segments = freqs.length;
  const fade = Math.floor(0.02 * sampleRate);
  const burstLength = Math.max(1, Math.floor(0.018 * sampleRate));
  let noiseState = 0x12345678;

  for (let i = 0; i < n; i++) {
    const seg = Math.min(segments - 1, Math.floor((i / n) * segments));
    const segStart = Math.floor((seg / segments) * n);
    const segEnd = Math.floor(((seg + 1) / segments) * n);
    const localN = Math.max(1, segEnd - segStart);
    const localI = i - segStart;

    const baseHz = freqs[seg];
    const localU = localI / localN;
    const f0 = baseHz + 70 * localU;
    const phase = (2 * Math.PI * f0 * i) / sampleRate;
    const note =
      0.9 * Math.sin(phase) +
      0.42 * Math.sin(2 * phase) +
      0.2 * Math.sin(3 * phase);

    const segEnv = Math.sin(Math.PI * localU);
    const voiced = note * segEnv;

    let burst = 0;
    if (localI < burstLength || localN - localI < burstLength) {
      noiseState = lcgNext(noiseState);
      const w = (noiseState / 0xffffffff) * 2 - 1;
      burst = 0.26 * w;
    }

    noiseState = lcgNext(noiseState);
    const floorNoise = 0.018 * ((noiseState / 0xffffffff) * 2 - 1);

    out[i] = (0.66 * voiced + burst + floorNoise) * fadeInOutGain(i, n, fade);
  }

  peakNormalize(out);
  return out;
}

export function buildTestSignal(
  type: SignalType,
  options: {
    sampleRate: number;
    durationSeconds: number;
  }
): Float32Array {
  const sr = options.sampleRate;
  const dur = options.durationSeconds;
  if (type === "step_pattern") return generateStepPattern(sr, dur);
  return generateHarmonicSweep(sr, dur);
}
