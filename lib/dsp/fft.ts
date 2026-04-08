/**
 * Thin wrapper around fft.js.
 * This file turns raw FFT output into values the rest of the app can use.
 */

import FFT from "fft.js";

/** Run a real FFT and keep only magnitude, which is enough for visualization. */
export function fftMagnitude(realInput: Float32Array): Float32Array {
  const { magnitude } = fftMagnitudeAndPhase(realInput);
  return magnitude;
}

/** Run a real FFT and return both magnitude and phase for reconstruction. */
export function fftMagnitudeAndPhase(realInput: Float32Array): {
  magnitude: Float32Array;
  phase: Float32Array;
} {
  const size = realInput.length;
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  const inputArr = Array.from(realInput);
  fft.realTransform(out, inputArr);
  const numBins = size / 2 + 1;
  const magnitude = new Float32Array(numBins);
  const phase = new Float32Array(numBins);

  // Convert the complex FFT result into polar form.
  for (let k = 0; k < numBins; k++) {
    const r = out[k * 2];
    const i = out[k * 2 + 1];
    magnitude[k] = Math.sqrt(r * r + i * i);
    phase[k] = Math.atan2(i, r);
  }
  return { magnitude, phase };
}

/**
 * Build a full complex spectrum from magnitude and phase.
 * We need this before inverse FFT when we want sound back out.
 */
export function buildComplexFromMagnitudePhase(
  magnitude: Float32Array,
  phase: Float32Array,
  size: number
): number[] {
  const fullSpectrum = new Array(size * 2);
  for (let i = 0; i < fullSpectrum.length; i++) fullSpectrum[i] = 0;
  const numBins = magnitude.length;

  // Convert polar values back into real/imaginary pairs.
  for (let k = 0; k < numBins; k++) {
    fullSpectrum[k * 2] = magnitude[k] * Math.cos(phase[k]);
    fullSpectrum[k * 2 + 1] = magnitude[k] * Math.sin(phase[k]);
  }

  // Fill the mirrored negative-frequency half expected by inverse FFT.
  const fft = new FFT(size);
  fft.completeSpectrum(fullSpectrum);
  return fullSpectrum;
}

/** Inverse FFT: spectrum back to a time-domain frame. */
export function inverseReal(complexSpectrum: number[], size: number): Float32Array {
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  fft.inverseTransform(out, complexSpectrum);
  const real = new Float32Array(size);

  // fft.js returns complex samples; here we keep the real part for audio.
  for (let i = 0; i < size; i++) real[i] = out[i * 2];
  return real;
}
