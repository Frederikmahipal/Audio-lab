export interface LpcResult {
  order: number;
  coefficients: number[];
  reflectionCoefficients: number[];
  predictionError: number;
  residualRms: number;
  gainDb: number;
}

export function analyzeLpc(samples: Float32Array, order = 12): LpcResult {
  const p = Math.max(1, Math.min(32, Math.floor(order)));
  if (samples.length <= p + 1) {
    return {
      order: p,
      coefficients: new Array(p).fill(0),
      reflectionCoefficients: new Array(p).fill(0),
      predictionError: 0,
      residualRms: 0,
      gainDb: 0,
    };
  }

  const centered = meanCenter(samples);
  const r = autocorrelation(centered, p);
  const { a, reflection, error } = levinsonDurbin(r, p);

  const residualRms = computeResidualRms(centered, a, p);
  const signalRms = computeRms(centered);
  const gainDb =
    signalRms > 1e-12 && residualRms > 1e-12
      ? 20 * Math.log10(signalRms / residualRms)
      : 0;

  return {
    order: p,
    coefficients: a.slice(1),
    reflectionCoefficients: reflection,
    predictionError: error,
    residualRms,
    gainDb,
  };
}

function meanCenter(samples: Float32Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  const mean = sum / samples.length;
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - mean;
  return out;
}

function autocorrelation(x: Float64Array, order: number): Float64Array {
  const r = new Float64Array(order + 1);
  const n = x.length;
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let i = 0; i < n - k; i++) sum += x[i] * x[i + k];
    r[k] = sum;
  }
  return r;
}

function levinsonDurbin(
  r: Float64Array,
  order: number
): { a: number[]; reflection: number[]; error: number } {
  const eps = 1e-12;
  const a = new Array(order + 1).fill(0);
  const reflection = new Array(order).fill(0);
  a[0] = 1;
  let e = Math.max(r[0], eps);

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / Math.max(e, eps);
    reflection[i - 1] = k;

    const next = a.slice();
    next[i] = k;
    for (let j = 1; j < i; j++) next[j] = a[j] - k * a[i - j];
    for (let j = 1; j <= i; j++) a[j] = next[j];

    e *= Math.max(eps, 1 - k * k);
  }

  return { a, reflection, error: e };
}

function computeResidualRms(x: Float64Array, a: number[], order: number): number {
  const n = x.length;
  if (n <= order) return 0;
  let sum = 0;
  let count = 0;
  for (let i = order; i < n; i++) {
    let pred = 0;
    for (let k = 1; k <= order; k++) pred += a[k] * x[i - k];
    const e = x[i] - pred;
    sum += e * e;
    count++;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function computeRms(x: Float64Array): number {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}
