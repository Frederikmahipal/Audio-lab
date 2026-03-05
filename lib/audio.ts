/**
 * Decode audio file to mono float array.
 * Must be called in the browser (uses AudioContext).
 */

const TARGET_SAMPLE_RATE = 16000;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

export async function decodeAudioToMono(
  arrayBuffer: ArrayBuffer,
  targetSampleRate: number = TARGET_SAMPLE_RATE
): Promise<DecodedAudio> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer);

  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sr = buffer.sampleRate;

  // Mix down to mono
  const mono = new Float32Array(length);
  if (numChannels === 1) {
    mono.set(buffer.getChannelData(0));
  } else {
    for (let c = 0; c < numChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += ch[i];
    }
    for (let i = 0; i < length; i++) mono[i] /= numChannels;
  }

  await ctx.close();

  // Resample to target if needed
  let out: Float32Array = mono;
  let outSr = sr;
  if (sr !== targetSampleRate) {
    out = resample(mono, sr, targetSampleRate) as Float32Array;
    outSr = targetSampleRate;
  }

  // Peak normalize to [-1, 1]
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > max) max = a;
  }
  if (max > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= max;
  }

  return {
    samples: out,
    sampleRate: outSr,
    durationSeconds: out.length / outSr,
  };
}

function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const j = Math.floor(srcIndex);
    const frac = srcIndex - j;
    const a = input[j] ?? 0;
    const b = input[Math.min(j + 1, input.length - 1)] ?? 0;
    output[i] = a + frac * (b - a);
  }
  return output;
}
