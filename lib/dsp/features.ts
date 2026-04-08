/**
 * Feature extraction helpers.
 * This file turns STFT magnitudes into compact mel-band features for ML.
 */

export interface LogMelFeatureOptions {
  numBands?: number;
  minHz?: number;
  maxHz?: number;
  floor?: number;
}

export interface LogMelFeatureResult {
  dbFrames: Float32Array[];
  centerHz: Float32Array;
  numBands: number;
}

/** Convert STFT magnitude frames into log-mel filterbank energies (MFE). */
export function extractLogMelFeatures(
  magnitudeFrames: Float32Array[],
  sampleRate: number,
  fftSize: number,
  options: LogMelFeatureOptions = {}
): LogMelFeatureResult {
  if (!magnitudeFrames.length || !magnitudeFrames[0]?.length) {
    return {
      dbFrames: [],
      centerHz: new Float32Array(0),
      numBands: 0,
    };
  }

  const nyquist = sampleRate / 2;
  // Keep defaults simple and stable for speech/music-style audio.
  const numBands = Math.max(4, Math.floor(options.numBands ?? 32));
  const minHz = clamp(options.minHz ?? 40, 0, Math.max(0, nyquist - 1));
  const maxHz = clamp(options.maxHz ?? nyquist, minHz + 1, nyquist);
  const floor = options.floor ?? 1e-10;
  const numBins = magnitudeFrames[0].length;
  const { filters, centerHz } = createMelFilterBank(
    numBands,
    numBins,
    sampleRate,
    fftSize,
    minHz,
    maxHz
  );

  const dbFrames = magnitudeFrames.map((frame) => {
    const out = new Float32Array(numBands);
    for (let band = 0; band < numBands; band++) {
      const filter = filters[band]!;
      let energy = 0;

      // Sum energy from all FFT bins covered by this mel band.
      for (let bin = 0; bin < numBins; bin++) {
        const magnitude = frame[bin] ?? 0;
        energy += filter[bin]! * magnitude * magnitude;
      }

      // Log scale makes the features easier to compare and store.
      out[band] = 10 * Math.log10(Math.max(energy, floor));
    }
    return out;
  });

  return {
    dbFrames,
    centerHz,
    numBands,
  };
}

/** Build triangular mel filters that map FFT bins into perceptual bands. */
function createMelFilterBank(
  numBands: number,
  numBins: number,
  sampleRate: number,
  fftSize: number,
  minHz: number,
  maxHz: number
): {
  filters: Float32Array[];
  centerHz: Float32Array;
} {
  const melMin = hzToMel(minHz);
  const melMax = hzToMel(maxHz);
  const melStep = (melMax - melMin) / (numBands + 1);
  const melPoints = new Float32Array(numBands + 2);
  const hzPoints = new Float32Array(numBands + 2);
  const centerHz = new Float32Array(numBands);

  for (let i = 0; i < numBands + 2; i++) {
    const mel = melMin + i * melStep;
    melPoints[i] = mel;
    hzPoints[i] = melToHz(mel);
    if (i > 0 && i < numBands + 1) centerHz[i - 1] = hzPoints[i]!;
  }

  const filters: Float32Array[] = [];
  for (let band = 0; band < numBands; band++) {
    const leftHz = hzPoints[band]!;
    const centerBandHz = hzPoints[band + 1]!;
    const rightHz = hzPoints[band + 2]!;
    const filter = new Float32Array(numBins);

    for (let bin = 0; bin < numBins; bin++) {
      const hz = (bin * sampleRate) / fftSize;
      let weight = 0;

      // Each mel band ramps up to a center frequency and down again.
      if (hz >= leftHz && hz <= centerBandHz) {
        weight = (hz - leftHz) / Math.max(1e-12, centerBandHz - leftHz);
      } else if (hz > centerBandHz && hz <= rightHz) {
        weight = (rightHz - hz) / Math.max(1e-12, rightHz - centerBandHz);
      }

      filter[bin] = Math.max(0, weight);
    }

    filters.push(filter);
  }

  return { filters, centerHz };
}

/** Convert Hz to mel so spacing matches human pitch perception more closely. */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/** Convert mel back to Hz for readable band labels and plotting. */
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Clamp helper to keep option values inside a safe range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
