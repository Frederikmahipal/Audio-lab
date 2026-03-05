/**
 * Simple low-pass (high-cut) filter via STFT: zero out high-frequency bins.
 * Makes the sound clearly "muffled" so you hear that we're changing the signal.
 */

import { stftComplex, istft, type STFTOptions } from "./stft";

/**
 * Apply high-frequency cut: keep only the lowest (1 - cutFrac) of frequency bins.
 * cutFrac 0 = no change; cutFrac 1 = keep only ~10% lowest (very muffled).
 */
export function highCutFilter(
  samples: Float32Array,
  sampleRate: number,
  stftOptions: STFTOptions,
  cutFrac: number
): Float32Array {
  if (cutFrac <= 0) return samples;

  const { magnitudes, phases } = stftComplex(samples, stftOptions);
  const numBins = magnitudes[0]!.length;
  const keepBins = Math.max(1, Math.floor(numBins * (1 - cutFrac * 0.9)));

  for (let t = 0; t < magnitudes.length; t++) {
    for (let k = keepBins; k < numBins; k++) {
      magnitudes[t]![k] = 0;
    }
  }

  let out = istft(magnitudes, phases, stftOptions);
  if (out.length > samples.length) out = out.subarray(0, samples.length);

  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    if (a > max) max = a;
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i]! /= max;
  return out;
}
