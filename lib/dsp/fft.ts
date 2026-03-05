/**
 * FFT wrapper around fft.js.
 * Real input → magnitude (and optionally phase) for STFT/denoise.
 */

import FFT from "fft.js";

export function fftMagnitude(realInput: Float32Array): Float32Array {
  const { magnitude } = fftMagnitudeAndPhase(realInput);
  return magnitude;
}

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
  for (let k = 0; k < numBins; k++) {
    const r = out[k * 2];
    const i = out[k * 2 + 1];
    magnitude[k] = Math.sqrt(r * r + i * i);
    phase[k] = Math.atan2(i, r);
  }
  return { magnitude, phase };
}

/** Build full complex spectrum (interleaved) from magnitude + phase; fills conjugate. size = FFT size. */
export function buildComplexFromMagnitudePhase(
  magnitude: Float32Array,
  phase: Float32Array,
  size: number
): number[] {
  const fullSpectrum = new Array(size * 2);
  for (let i = 0; i < fullSpectrum.length; i++) fullSpectrum[i] = 0;
  const numBins = magnitude.length;
  for (let k = 0; k < numBins; k++) {
    fullSpectrum[k * 2] = magnitude[k] * Math.cos(phase[k]);
    fullSpectrum[k * 2 + 1] = magnitude[k] * Math.sin(phase[k]);
  }
  const fft = new FFT(size);
  fft.completeSpectrum(fullSpectrum);
  return fullSpectrum;
}

/** Inverse FFT: full complex spectrum (interleaved) → real time-domain. */
export function inverseReal(complexSpectrum: number[], size: number): Float32Array {
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  fft.inverseTransform(out, complexSpectrum);
  const real = new Float32Array(size);
  for (let i = 0; i < size; i++) real[i] = out[i * 2];
  return real;
}
