import { magnitudeToDb, stft, type STFTOptions } from "./stft";

export function timed<T>(fn: () => T): { value: T; durationMs: number } {
  const t0 = performance.now();
  const value = fn();
  const durationMs = performance.now() - t0;
  return { value, durationMs };
}

export function snrDb(reference: Float32Array, estimate: Float32Array): number {
  const n = Math.min(reference.length, estimate.length);
  if (n === 0) return 0;
  let signalEnergy = 0;
  let noiseEnergy = 0;
  for (let i = 0; i < n; i++) {
    const s = reference[i];
    const e = estimate[i];
    const d = s - e;
    signalEnergy += s * s;
    noiseEnergy += d * d;
  }
  if (noiseEnergy <= 1e-20) return Infinity;
  return 10 * Math.log10(Math.max(1e-20, signalEnergy) / noiseEnergy);
}

export function logSpectralDistanceDb(
  reference: Float32Array,
  estimate: Float32Array,
  stftOptions: STFTOptions
): number {
  const refFrames = magnitudeToDb(stft(reference, stftOptions));
  const estFrames = magnitudeToDb(stft(estimate, stftOptions));
  const frameCount = Math.min(refFrames.length, estFrames.length);
  if (frameCount === 0) return 0;
  const binCount = Math.min(refFrames[0].length, estFrames[0].length);
  let sq = 0;
  let count = 0;
  for (let t = 0; t < frameCount; t++) {
    for (let k = 0; k < binCount; k++) {
      const d = refFrames[t][k] - estFrames[t][k];
      sq += d * d;
      count++;
    }
  }
  return Math.sqrt(sq / Math.max(1, count));
}

export function spectralConvergence(
  reference: Float32Array,
  estimate: Float32Array,
  stftOptions: STFTOptions
): number {
  const refFrames = stft(reference, stftOptions);
  const estFrames = stft(estimate, stftOptions);
  const frameCount = Math.min(refFrames.length, estFrames.length);
  if (frameCount === 0) return 0;
  const binCount = Math.min(refFrames[0].length, estFrames[0].length);
  let num = 0;
  let den = 0;
  for (let t = 0; t < frameCount; t++) {
    for (let k = 0; k < binCount; k++) {
      const ref = refFrames[t][k];
      const est = estFrames[t][k];
      const d = ref - est;
      num += d * d;
      den += ref * ref;
    }
  }
  return Math.sqrt(num) / Math.max(1e-12, Math.sqrt(den));
}
