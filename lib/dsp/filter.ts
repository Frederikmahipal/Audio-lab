/**
 * Simple low-pass (high-cut) filter via STFT: zero out high-frequency bins.
 * Makes the sound clearly "muffled" so you hear that we're changing the signal.
 */

import { stftComplex, istft, type STFTOptions } from "./stft";

/**
 * Apply high-frequency cut by zeroing bins above a cutoff frequency.
 * The cutoff mapping matches AudioPlayer so visual "processed" and playback agree.
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
  const cutoffHz = highCutFracToCutoffHz(cutFrac, sampleRate);
  const nyquist = sampleRate / 2;
  const binHz = nyquist / Math.max(1, numBins - 1);
  const keepBins = Math.max(1, Math.min(numBins, Math.floor(cutoffHz / binHz) + 1));

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

function highCutFracToCutoffHz(cutFrac: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  const maxHz = Math.max(500, nyquist * 0.98);
  const minHz = 120;
  const clamped = Math.max(0, Math.min(1, cutFrac));
  const t = 1 - clamped;
  return minHz + (maxHz - minHz) * (t * t);
}
