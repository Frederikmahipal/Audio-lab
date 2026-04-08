/**
 * STFT utilities.
 * This is the main time-frequency analysis layer used by the app.
 */

import { createWindow, type WindowType } from "./windows";
import {
  fftMagnitude,
  fftMagnitudeAndPhase,
  buildComplexFromMagnitudePhase,
  inverseReal,
} from "./fft";

export interface STFTOptions {
  fftSize: number;
  hopLength: number;
  windowType: WindowType;
}

/** Split the signal into overlapping frames and keep only magnitude per frame. */
export function stft(
  signal: Float32Array,
  options: STFTOptions
): Float32Array[] {
  const { fftSize, hopLength, windowType } = options;
  const window = createWindow(windowType, fftSize);
  const frames: Float32Array[] = [];
  const frameBuffer = new Float32Array(fftSize);

  // Walk through the signal in hops and analyze one frame at a time.
  for (let start = 0; start + fftSize <= signal.length; start += hopLength) {
    // Windowing reduces edge artifacts before FFT.
    for (let i = 0; i < fftSize; i++) {
      frameBuffer[i] = signal[start + i] * window[i];
    }
    const magnitude = fftMagnitude(frameBuffer);
    frames.push(new Float32Array(magnitude));
  }

  return frames;
}

export interface STFTComplexResult {
  magnitudes: Float32Array[];
  phases: Float32Array[];
}

/** Same STFT as above, but keep phase so the signal can be reconstructed later. */
export function stftComplex(
  signal: Float32Array,
  options: STFTOptions
): STFTComplexResult {
  const { fftSize, hopLength, windowType } = options;
  const window = createWindow(windowType, fftSize);
  const magnitudes: Float32Array[] = [];
  const phases: Float32Array[] = [];
  const frameBuffer = new Float32Array(fftSize);

  for (let start = 0; start + fftSize <= signal.length; start += hopLength) {
    for (let i = 0; i < fftSize; i++) {
      frameBuffer[i] = signal[start + i] * window[i];
    }

    // Magnitude is what we modify; phase helps us rebuild the waveform.
    const { magnitude, phase } = fftMagnitudeAndPhase(frameBuffer);
    magnitudes.push(new Float32Array(magnitude));
    phases.push(new Float32Array(phase));
  }

  return { magnitudes, phases };
}

/** Rebuild a time signal from processed STFT frames using overlap-add. */
export function istft(
  magnitudes: Float32Array[],
  phases: Float32Array[],
  options: STFTOptions
): Float32Array {
  const { fftSize, hopLength, windowType } = options;
  const window = createWindow(windowType, fftSize);
  const numFrames = magnitudes.length;
  const outLength = (numFrames - 1) * hopLength + fftSize;
  const out = new Float32Array(outLength);

  for (let t = 0; t < numFrames; t++) {
    // Turn one processed spectrum back into one time-domain frame.
    const spectrum = buildComplexFromMagnitudePhase(
      magnitudes[t],
      phases[t],
      fftSize
    );
    const frame = inverseReal(spectrum, fftSize);
    const start = t * hopLength;

    // Overlap-add places each reconstructed frame back into the output signal.
    for (let i = 0; i < fftSize; i++) {
      out[start + i] += frame[i] * window[i];
    }
  }

  // Normalize so overlap regions do not get artificially louder.
  const maxOverlap = Math.ceil(fftSize / hopLength);
  let norm = 0;
  for (let i = 0; i < fftSize; i++) norm += window[i] * window[i];
  norm *= maxOverlap;
  if (norm > 0) {
    for (let i = 0; i < outLength; i++) out[i] /= norm;
  }
  return out;
}

/** Convert linear magnitudes to dB so the spectrogram is easier to read. */
export function magnitudeToDb(
  frames: Float32Array[],
  eps = 1e-10
): Float32Array[] {
  return frames.map((m) => {
    const db = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) {
      db[i] = 20 * Math.log10(Math.max(m[i], eps));
    }
    return db;
  });
}
