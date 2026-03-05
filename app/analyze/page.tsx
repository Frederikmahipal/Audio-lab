"use client";

import { useAudioLab } from "@/context/AudioLabContext";
import { WaveformCanvas } from "@/components/WaveformCanvas";
import { SpectrogramCanvas } from "@/components/SpectrogramCanvas";
import { AudioPlayer } from "@/components/AudioPlayer";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  stft,
  stftComplex,
  istft,
  magnitudeToDb,
  type STFTOptions,
} from "@/lib/dsp/stft";
import type { WindowType } from "@/lib/dsp/windows";
import {
  estimateNoiseProfile,
  spectralSubtraction,
} from "@/lib/dsp/denoise";
import { highCutFilter } from "@/lib/dsp/filter";

const FFT_SIZES = [512, 1024, 2048] as const;
const HOP_LENGTHS = [128, 256, 512] as const;
const WINDOW_TYPES: { value: WindowType; label: string }[] = [
  { value: "hann", label: "Hann" },
  { value: "hamming", label: "Hamming" },
  { value: "rect", label: "Rectangular" },
];

const DEFAULT_VISUAL_STFT: STFTOptions = {
  fftSize: 1024,
  hopLength: 256,
  windowType: "hann",
};
const DEFAULT_PROCESSING_STFT: STFTOptions = {
  fftSize: 1024,
  hopLength: 256,
  windowType: "hann",
};
const DENOISE_DEBOUNCE_MS = 220;

type HelpKey = "fftSize" | "hopLength" | "window" | null;
type SpectrogramSource = "original" | "processed";

const HELP_TEXT: Record<NonNullable<HelpKey>, string> = {
  fftSize:
    "Length of each analysis frame in samples. Larger values give sharper frequency resolution (narrower bands) but blurrier time resolution. At 16 kHz, 1024 ≈ 64 ms per frame. You hear no difference—only the spectrogram picture changes.",
  hopLength:
    "How many samples the window moves forward for each new frame. Smaller hop = more overlapping frames = smoother in time but more computation. Doesn’t change the sound, only how the spectrogram looks.",
  window:
    "Shape of the window applied to each frame before the FFT. Hann and Hamming reduce spectral leakage (smoother peaks); rectangular is sharp but can show artifacts. Affects the spectrogram display only, not playback.",
};

export default function AnalyzePage() {
  const { audio } = useAudioLab();
  const [visualStftOptions, setVisualStftOptions] =
    useState<STFTOptions>(DEFAULT_VISUAL_STFT);
  const [spectrogramSource, setSpectrogramSource] =
    useState<SpectrogramSource>("original");
  const [helpOpen, setHelpOpen] = useState<HelpKey>(null);
  const [applyDenoise, setApplyDenoise] = useState(false);
  const [noiseSeconds, setNoiseSeconds] = useState(0.5);
  const [denoiseAlpha, setDenoiseAlpha] = useState(1.2);
  const [highCutFrac, setHighCutFrac] = useState(0);
  const [bypassProcessing, setBypassProcessing] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [denoisedResult, setDenoisedResult] = useState<{
    source: Float32Array;
    samples: Float32Array;
  } | null>(null);
  const [isDenoiseProcessing, setIsDenoiseProcessing] = useState(false);
  const [denoiseError, setDenoiseError] = useState<string | null>(null);
  const denoiseJobRef = useRef(0);

  const denoiseReady =
    !!audio?.samples &&
    !!denoisedResult &&
    denoisedResult.source === audio.samples;

  const denoiseBaseSamples = useMemo(() => {
    if (!audio?.samples.length) return null;
    if (applyDenoise && denoiseReady) return denoisedResult.samples;
    return audio.samples;
  }, [audio?.samples, applyDenoise, denoiseReady, denoisedResult]);

  const processedPreviewSamples = useMemo(() => {
    if (!audio?.samples.length || !denoiseBaseSamples) return null;
    if (highCutFrac <= 0) return denoiseBaseSamples;
    return highCutFilter(
      denoiseBaseSamples,
      audio.sampleRate,
      DEFAULT_PROCESSING_STFT,
      highCutFrac
    );
  }, [
    audio?.samples,
    audio?.sampleRate,
    denoiseBaseSamples,
    highCutFrac,
  ]);

  const spectrogramSamples = useMemo(() => {
    if (!audio?.samples.length) return null;
    if (spectrogramSource === "processed" && processedPreviewSamples) {
      return processedPreviewSamples;
    }
    return audio.samples;
  }, [audio?.samples, spectrogramSource, processedPreviewSamples]);

  const stftFrames = useMemo(() => {
    if (!spectrogramSamples?.length) return null;
    return stft(spectrogramSamples, visualStftOptions);
  }, [spectrogramSamples, visualStftOptions]);

  const dbFrames = useMemo(() => {
    if (!stftFrames?.length) return null;
    return magnitudeToDb(stftFrames);
  }, [stftFrames]);

  useEffect(() => {
    if (!audio?.samples.length || !applyDenoise) return;

    const sourceSamples = audio.samples;
    const sourceRate = audio.sampleRate;
    const jobId = denoiseJobRef.current + 1;
    denoiseJobRef.current = jobId;

    let computeTimer: ReturnType<typeof window.setTimeout> | undefined;
    const debounceTimer = window.setTimeout(() => {
      if (denoiseJobRef.current !== jobId) return;
      setIsDenoiseProcessing(true);
      setDenoiseError(null);

      // Let status text paint first before heavy DSP work starts.
      computeTimer = window.setTimeout(() => {
        if (denoiseJobRef.current !== jobId) return;
        try {
          const out = computeDenoisedSamples(
            sourceSamples,
            sourceRate,
            DEFAULT_PROCESSING_STFT,
            noiseSeconds,
            denoiseAlpha
          );
          if (denoiseJobRef.current !== jobId) return;
          setDenoisedResult({ source: sourceSamples, samples: out });
        } catch (err) {
          if (denoiseJobRef.current !== jobId) return;
          setDenoiseError(
            err instanceof Error ? err.message : "Unknown denoise error"
          );
        } finally {
          if (denoiseJobRef.current === jobId) setIsDenoiseProcessing(false);
        }
      }, 0);
    }, DENOISE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounceTimer);
      if (computeTimer !== undefined) window.clearTimeout(computeTimer);
    };
  }, [
    audio?.samples,
    audio?.sampleRate,
    applyDenoise,
    noiseSeconds,
    denoiseAlpha,
  ]);

  // Playback source buffer: original or denoised. Muffle is applied live in AudioPlayer.
  const playbackSamples = useMemo(() => {
    if (!audio?.samples.length) return new Float32Array(0);
    if (bypassProcessing) return audio.samples;
    if (denoiseBaseSamples) return denoiseBaseSamples;
    return audio.samples;
  }, [
    audio?.samples,
    bypassProcessing,
    denoiseBaseSamples,
  ]);

  const playbackHighCutFrac = bypassProcessing ? 0 : highCutFrac;

  const playbackOutputGain = useMemo(() => {
    if (!audio?.samples.length || bypassProcessing || !loudnessMatch) return 1;
    if (!processedPreviewSamples) return 1;
    const hasProcessing = highCutFrac > 0 || (applyDenoise && denoiseReady);
    if (!hasProcessing) return 1;
    return computeLoudnessMatchGain(audio.samples, processedPreviewSamples);
  }, [
    audio?.samples,
    bypassProcessing,
    loudnessMatch,
    processedPreviewSamples,
    highCutFrac,
    applyDenoise,
    denoiseReady,
  ]);

  function handleDenoiseToggle(checked: boolean) {
    denoiseJobRef.current += 1;
    setApplyDenoise(checked);
    setDenoiseError(null);
    if (!checked) {
      setIsDenoiseProcessing(false);
      setDenoisedResult(null);
      return;
    }
    setIsDenoiseProcessing(true);
  }

  function handleNoiseSecondsChange(value: number) {
    setNoiseSeconds(value);
    if (applyDenoise) setIsDenoiseProcessing(true);
  }

  function handleDenoiseAlphaChange(value: number) {
    setDenoiseAlpha(value);
    if (applyDenoise) setIsDenoiseProcessing(true);
  }

  if (!audio) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
            <Link
              href="/"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Audio Lab
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Record &amp; Upload
              </Link>
              <Link href="/analyze" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Analyze
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-12">
          <p className="text-zinc-600 dark:text-zinc-400">
            No audio loaded.{" "}
            <Link href="/" className="font-medium text-zinc-900 underline dark:text-zinc-100">
              Upload a file on the home page
            </Link>{" "}
            first.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Audio Lab
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Record &amp; Upload
            </Link>
            <Link href="/analyze" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Analyze
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Analyze
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          1. Listen to your clip. 2. Look at the waveform and spectrogram. 3. Use the controls to change the sound or the view.
        </p>

        {/* ─── Listen ─── */}
        <section className="mb-8">
          <h2 className="mb-2 text-base font-medium text-zinc-800 dark:text-zinc-200">
            Listen
          </h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Muffle updates live while audio is playing. Use bypass for A/B checks and optionally loudness-match the processed signal.
          </p>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <AudioPlayer
              samples={playbackSamples}
              sampleRate={audio.sampleRate}
              highCutFrac={playbackHighCutFrac}
              outputGain={playbackOutputGain}
            />
          </div>
        </section>

        {/* ─── Visuals ─── */}
        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium text-zinc-800 dark:text-zinc-200">
            View
          </h2>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Waveform — amplitude over time</p>
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <WaveformCanvas
                  samples={audio.samples}
                  width={800}
                  height={160}
                  className="w-full"
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Spectrogram — frequency over time (brightness = energy)
                </p>
                <div className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setSpectrogramSource("original")}
                    className={`rounded px-2 py-1 text-[11px] ${
                      spectrogramSource === "original"
                        ? "bg-white text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpectrogramSource("processed")}
                    className={`rounded px-2 py-1 text-[11px] ${
                      spectrogramSource === "processed"
                        ? "bg-white text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    Processed
                  </button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                {dbFrames && dbFrames.length > 0 && (
                  <SpectrogramCanvas
                    dbFrames={dbFrames}
                    sampleRate={audio.sampleRate}
                    fftSize={visualStftOptions.fftSize}
                    hopLength={visualStftOptions.hopLength}
                    width={800}
                    height={240}
                    className="w-full"
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Change the sound ─── */}
        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium text-zinc-800 dark:text-zinc-200">
            Change the sound
          </h2>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            These controls define the processed version. Use bypass to quickly compare with the original.
          </p>
          <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bypassProcessing}
                  onChange={(e) => setBypassProcessing(e.target.checked)}
                  className="rounded border-zinc-300 accent-zinc-700"
                />
                <span>Bypass processing (A/B)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={loudnessMatch}
                  disabled={bypassProcessing}
                  onChange={(e) => setLoudnessMatch(e.target.checked)}
                  className="rounded border-zinc-300 accent-zinc-700 disabled:opacity-50"
                />
                <span className={bypassProcessing ? "opacity-50" : ""}>
                  Loudness match
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {bypassProcessing
                ? "Bypass active: playback uses original audio without muffle/denoise."
                : loudnessMatch
                  ? `Loudness match gain: ${playbackOutputGain.toFixed(2)}x`
                  : "Loudness match disabled."}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800/50 dark:bg-blue-900/10">
              <h3 className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Muffled (high-cut)</h3>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Slide right → fewer high frequencies → sound like behind a wall.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={highCutFrac}
                  onChange={(e) => setHighCutFrac(Number(e.target.value))}
                  className="h-2 flex-1 rounded accent-blue-600"
                />
                <span className="w-10 text-right text-xs text-zinc-500">{Math.round(highCutFrac * 100)}%</span>
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-900/10">
              <h3 className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Denoised</h3>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                Uses the start of the clip as &quot;noise&quot; and subtracts it. Best when the start is silence or room tone.
              </p>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={applyDenoise}
                  onChange={(e) => handleDenoiseToggle(e.target.checked)}
                  className="rounded border-zinc-300 accent-amber-600"
                />
                <span className="text-sm">Apply denoising</span>
              </label>
              {applyDenoise && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-4">
                    <label className="flex flex-col gap-0.5 text-xs">
                      <span className="text-zinc-500">Noise from first (s)</span>
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.1}
                        value={noiseSeconds}
                        onChange={(e) => handleNoiseSecondsChange(Number(e.target.value))}
                        className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-xs">
                      <span className="text-zinc-500">Strength (α)</span>
                      <input
                        type="number"
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={denoiseAlpha}
                        onChange={(e) => handleDenoiseAlphaChange(Number(e.target.value))}
                        className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {denoiseError
                      ? `Denoise failed: ${denoiseError}`
                      : isDenoiseProcessing
                        ? "Processing denoise..."
                        : denoiseReady
                          ? "Denoised buffer ready (updates as settings change)."
                          : "Using original audio until denoise is ready."}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    Processing STFT is fixed at 1024 FFT / 256 hop / Hann window.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── Spectrogram settings ─── */}
        <section className="mb-8">
          <h2 className="mb-2 text-base font-medium text-zinc-800 dark:text-zinc-200">
            Spectrogram settings
          </h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            These are visual-only STFT settings for the spectrogram. They do not affect playback processing.
          </p>
          <div className="flex flex-wrap gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                FFT size
                <button
                  type="button"
                  onClick={() => setHelpOpen((h) => (h === "fftSize" ? null : "fftSize"))}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-600 hover:bg-zinc-400 dark:bg-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-500"
                  aria-label="Explain FFT size"
                >
                  i
                </button>
              </span>
              <select
                value={visualStftOptions.fftSize}
                onChange={(e) =>
                  setVisualStftOptions((o) => ({ ...o, fftSize: Number(e.target.value) }))
                }
                className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {FFT_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                Hop length
                <button
                  type="button"
                  onClick={() => setHelpOpen((h) => (h === "hopLength" ? null : "hopLength"))}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-600 hover:bg-zinc-400 dark:bg-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-500"
                  aria-label="Explain hop length"
                >
                  i
                </button>
              </span>
              <select
                value={visualStftOptions.hopLength}
                onChange={(e) =>
                  setVisualStftOptions((o) => ({ ...o, hopLength: Number(e.target.value) }))
                }
                className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {HOP_LENGTHS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                Window
                <button
                  type="button"
                  onClick={() => setHelpOpen((h) => (h === "window" ? null : "window"))}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-600 hover:bg-zinc-400 dark:bg-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-500"
                  aria-label="Explain window type"
                >
                  i
                </button>
              </span>
              <select
                value={visualStftOptions.windowType}
                onChange={(e) =>
                  setVisualStftOptions((o) => ({
                    ...o,
                    windowType: e.target.value as WindowType,
                  }))
                }
                className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {WINDOW_TYPES.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </label>
          </div>
          {helpOpen && (
            <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {HELP_TEXT[helpOpen]}
            </p>
          )}
        </section>

       
      </main>
    </div>
  );
}

function computeDenoisedSamples(
  input: Float32Array,
  sampleRate: number,
  stftOptions: STFTOptions,
  noiseSeconds: number,
  denoiseAlpha: number
): Float32Array {
  const { magnitudes, phases } = stftComplex(input, stftOptions);
  const noiseFrames = Math.max(
    1,
    Math.floor((noiseSeconds * sampleRate) / stftOptions.hopLength)
  );
  const n = Math.min(noiseFrames, magnitudes.length);
  const noiseProfile = estimateNoiseProfile(magnitudes, n);
  const cleaned = spectralSubtraction(magnitudes, noiseProfile, denoiseAlpha, 0.01);

  let out = istft(cleaned, phases, stftOptions);
  if (out.length > input.length) out = out.subarray(0, input.length);

  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    if (a > max) max = a;
  }
  if (max > 0) {
    for (let i = 0; i < out.length; i++) out[i]! /= max;
  }
  return out;
}

function computeLoudnessMatchGain(
  reference: Float32Array,
  processed: Float32Array
): number {
  const refRms = computeRms(reference);
  const procRms = computeRms(processed);
  if (refRms <= 1e-8 || procRms <= 1e-8) return 1;
  const gain = refRms / procRms;
  return Math.max(0.25, Math.min(4, gain));
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    sum += x * x;
  }
  return Math.sqrt(sum / samples.length);
}
