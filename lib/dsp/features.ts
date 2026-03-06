import { stft, type STFTOptions } from "./stft";

interface ScalarStat {
  mean: number;
  std: number;
}

export interface FeatureSummary {
  frameCount: number;
  mfccMean: number[];
  mfccStd: number[];
  spectralCentroidHz: ScalarStat;
  spectralBandwidthHz: ScalarStat;
  spectralRolloffHz: ScalarStat;
  spectralFlux: ScalarStat;
  rms: ScalarStat;
  zcr: ScalarStat;
}

export interface FeatureExtractionOptions {
  mfccCount?: number;
  melBands?: number;
  rolloffFraction?: number;
  minHz?: number;
  maxHz?: number;
}

const DEFAULT_FEATURE_OPTIONS: Required<FeatureExtractionOptions> = {
  mfccCount: 13,
  melBands: 26,
  rolloffFraction: 0.85,
  minHz: 20,
  maxHz: 8000,
};

export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  stftOptions: STFTOptions,
  options: FeatureExtractionOptions = {}
): FeatureSummary {
  const cfg = { ...DEFAULT_FEATURE_OPTIONS, ...options };
  const frames = stft(samples, stftOptions);
  if (frames.length === 0) return emptyFeatureSummary(cfg.mfccCount);

  const numFrames = frames.length;
  const numBins = frames[0].length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / Math.max(1, numBins - 1);
  const melBank = buildMelFilterBank(
    cfg.melBands,
    stftOptions.fftSize,
    sampleRate,
    cfg.minHz,
    Math.min(cfg.maxHz, nyquist)
  );

  const centroid = new Float64Array(numFrames);
  const bandwidth = new Float64Array(numFrames);
  const rolloff = new Float64Array(numFrames);
  const flux = new Float64Array(numFrames);
  const rms = new Float64Array(numFrames);
  const zcr = new Float64Array(numFrames);
  const mfccMatrix: number[][] = new Array(numFrames);

  let prevNormMag: Float64Array | null = null;

  for (let t = 0; t < numFrames; t++) {
    const mag = frames[t];
    const power = new Float64Array(numBins);
    let totalPower = 0;
    let magSum = 0;

    for (let k = 0; k < numBins; k++) {
      const p = mag[k] * mag[k];
      power[k] = p;
      totalPower += p;
      magSum += mag[k];
    }

    if (totalPower <= 1e-20) {
      centroid[t] = 0;
      bandwidth[t] = 0;
      rolloff[t] = 0;
      flux[t] = 0;
      mfccMatrix[t] = new Array(cfg.mfccCount).fill(0);
    } else {
      let centroidHz = 0;
      for (let k = 0; k < numBins; k++) {
        centroidHz += k * binHz * power[k];
      }
      centroidHz /= totalPower;
      centroid[t] = centroidHz;

      let bw = 0;
      for (let k = 0; k < numBins; k++) {
        const d = k * binHz - centroidHz;
        bw += d * d * power[k];
      }
      bandwidth[t] = Math.sqrt(bw / totalPower);

      const target = totalPower * cfg.rolloffFraction;
      let cumulative = 0;
      let rollIdx = 0;
      for (let k = 0; k < numBins; k++) {
        cumulative += power[k];
        if (cumulative >= target) {
          rollIdx = k;
          break;
        }
      }
      rolloff[t] = rollIdx * binHz;

      const normMag = new Float64Array(numBins);
      for (let k = 0; k < numBins; k++) {
        normMag[k] = mag[k] / Math.max(magSum, 1e-12);
      }
      if (!prevNormMag) {
        flux[t] = 0;
      } else {
        let sq = 0;
        for (let k = 0; k < numBins; k++) {
          const d = normMag[k] - prevNormMag[k];
          sq += d * d;
        }
        flux[t] = Math.sqrt(sq / numBins);
      }
      prevNormMag = normMag;

      const melEnergies = applyMelBank(power, melBank);
      const mfcc = dctType2(melEnergies, cfg.mfccCount);
      mfccMatrix[t] = mfcc;
    }

    const start = t * stftOptions.hopLength;
    const end = Math.min(start + stftOptions.fftSize, samples.length);
    let energy = 0;
    let signChanges = 0;
    let prevSign = 0;
    for (let i = start; i < end; i++) {
      const x = samples[i];
      energy += x * x;
      const sign = x >= 0 ? 1 : -1;
      if (i > start && sign !== prevSign) signChanges++;
      prevSign = sign;
    }
    const n = Math.max(1, end - start);
    rms[t] = Math.sqrt(energy / n);
    zcr[t] = signChanges / Math.max(1, n - 1);
  }

  return {
    frameCount: numFrames,
    mfccMean: vectorMean(mfccMatrix),
    mfccStd: vectorStd(mfccMatrix),
    spectralCentroidHz: summarize(centroid),
    spectralBandwidthHz: summarize(bandwidth),
    spectralRolloffHz: summarize(rolloff),
    spectralFlux: summarize(flux),
    rms: summarize(rms),
    zcr: summarize(zcr),
  };
}

function emptyFeatureSummary(mfccCount: number): FeatureSummary {
  return {
    frameCount: 0,
    mfccMean: new Array(mfccCount).fill(0),
    mfccStd: new Array(mfccCount).fill(0),
    spectralCentroidHz: { mean: 0, std: 0 },
    spectralBandwidthHz: { mean: 0, std: 0 },
    spectralRolloffHz: { mean: 0, std: 0 },
    spectralFlux: { mean: 0, std: 0 },
    rms: { mean: 0, std: 0 },
    zcr: { mean: 0, std: 0 },
  };
}

function summarize(values: Float64Array): ScalarStat {
  if (values.length === 0) return { mean: 0, std: 0 };
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let varSum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    varSum += d * d;
  }
  return {
    mean,
    std: Math.sqrt(varSum / values.length),
  };
}

function vectorMean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const d = vectors[0].length;
  const out = new Array(d).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    for (let j = 0; j < d; j++) out[j] += vectors[i][j];
  }
  for (let j = 0; j < d; j++) out[j] /= vectors.length;
  return out;
}

function vectorStd(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const mean = vectorMean(vectors);
  const d = mean.length;
  const out = new Array(d).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    for (let j = 0; j < d; j++) {
      const diff = vectors[i][j] - mean[j];
      out[j] += diff * diff;
    }
  }
  for (let j = 0; j < d; j++) out[j] = Math.sqrt(out[j] / vectors.length);
  return out;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildMelFilterBank(
  melBands: number,
  fftSize: number,
  sampleRate: number,
  minHz: number,
  maxHz: number
): Float64Array[] {
  const numBins = fftSize / 2 + 1;
  const minMel = hzToMel(minHz);
  const maxMel = hzToMel(maxHz);
  const melPoints = new Array(melBands + 2).fill(0).map((_, i) => {
    const a = i / (melBands + 1);
    return minMel + (maxMel - minMel) * a;
  });
  const hzPoints = melPoints.map(melToHz);
  const bins = hzPoints.map((hz) =>
    Math.max(0, Math.min(numBins - 1, Math.floor(((fftSize + 1) * hz) / sampleRate)))
  );

  const bank: Float64Array[] = [];
  for (let m = 1; m <= melBands; m++) {
    const filter = new Float64Array(numBins);
    const left = bins[m - 1];
    const center = bins[m];
    const right = bins[m + 1];
    if (left === right) {
      bank.push(filter);
      continue;
    }
    for (let k = left; k < center; k++) {
      filter[k] = (k - left) / Math.max(1, center - left);
    }
    for (let k = center; k < right; k++) {
      filter[k] = (right - k) / Math.max(1, right - center);
    }
    bank.push(filter);
  }
  return bank;
}

function applyMelBank(power: Float64Array, bank: Float64Array[]): Float64Array {
  const energies = new Float64Array(bank.length);
  for (let m = 0; m < bank.length; m++) {
    let sum = 0;
    const filter = bank[m];
    for (let k = 0; k < power.length; k++) sum += power[k] * filter[k];
    energies[m] = Math.log(Math.max(1e-12, sum));
  }
  return energies;
}

function dctType2(input: Float64Array, outDim: number): number[] {
  const m = input.length;
  const out = new Array(outDim).fill(0);
  const scale = Math.sqrt(2 / m);
  for (let n = 0; n < outDim; n++) {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      sum += input[i] * Math.cos((Math.PI * n * (i + 0.5)) / m);
    }
    out[n] = sum * (n === 0 ? scale / Math.sqrt(2) : scale);
  }
  return out;
}
