"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAudioLab } from "@/context/AudioLabContext";
import { WaveformCanvas } from "@/components/WaveformCanvas";
import { SpectrogramCanvas } from "@/components/SpectrogramCanvas";
import { AudioPlayer } from "@/components/AudioPlayer";
import { AppTopNav } from "@/components/AppTopNav";
import {
  stft,
  stftComplex,
  istft,
  magnitudeToDb,
  type STFTOptions,
} from "@/lib/dsp/stft";
import type { WindowType } from "@/lib/dsp/windows";
import { estimateNoiseProfile, spectralSubtraction } from "@/lib/dsp/denoise";
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
    "How many samples each FFT frame analyzes. Bigger FFT gives clearer frequency detail, smaller FFT gives sharper timing detail.",
  hopLength:
    "How far the analysis window moves each step. Smaller hop gives denser time tracking but costs more computation.",
  window:
    "Window shape before each FFT frame. Hann and Hamming reduce spectral leakage; rectangular is more raw but can show more artifacts.",
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
  }, [audio?.samples, audio?.sampleRate, denoiseBaseSamples, highCutFrac]);

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

  const playbackSamples = useMemo(() => {
    if (!audio?.samples.length) return new Float32Array(0);
    if (bypassProcessing) return audio.samples;
    if (denoiseBaseSamples) return denoiseBaseSamples;
    return audio.samples;
  }, [audio?.samples, bypassProcessing, denoiseBaseSamples]);

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
      <div className="min-h-screen text-[var(--ui-ink)]">
        <AppTopNav active="analyze" />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-10 sm:px-6">
          <div className="panel p-7">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ui-muted)]">
              No Audio Loaded
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              Open Capture first and load a signal.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[var(--ui-muted)]">
              Analyze needs an active clip in memory. Upload, record, or generate a
              signal on the capture page.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex rounded-full bg-[var(--ui-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105"
            >
              Go to Capture
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-[var(--ui-ink)]">
      <AppTopNav active="analyze" />

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-4 pt-3 sm:px-6 xl:h-[calc(100vh_-_68px)]">
        <div className="grid gap-4 xl:h-full xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="soft-scroll min-h-0 overflow-y-auto rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5">
            <section>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ui-muted)]">Session</p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight">
                Analyze clip
              </h1>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
                <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3 py-1.5 text-[var(--ui-muted)]">
                  {audio.sampleRate} Hz
                </span>
                <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3 py-1.5 text-[var(--ui-muted)]">
                  {formatDuration(audio.durationSeconds)}
                </span>
                <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3 py-1.5 text-[var(--ui-muted)]">
                  High cut {Math.round(highCutFrac * 100)}%
                </span>
              </div>
            </section>

            <section className="mt-5 border-t border-[var(--ui-border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Playback
              </h2>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">
                Realtime preview with optional A/B and gain matching.
              </p>
              <div className="mt-3">
                <AudioPlayer
                  samples={playbackSamples}
                  sampleRate={audio.sampleRate}
                  highCutFrac={playbackHighCutFrac}
                  outputGain={playbackOutputGain}
                />
              </div>
            </section>

            <section className="mt-4 border-t border-[var(--ui-border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Compare
              </h2>
              <div className="mt-3 space-y-2">
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
                  <span className="text-sm">Bypass processing</span>
                  <input
                    type="checkbox"
                    checked={bypassProcessing}
                    onChange={(e) => setBypassProcessing(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--ui-border)] accent-[var(--ui-accent)]"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
                  <span
                    className={`text-sm ${
                      bypassProcessing ? "text-[var(--ui-muted)]/65" : ""
                    }`}
                  >
                    Loudness match
                  </span>
                  <input
                    type="checkbox"
                    checked={loudnessMatch}
                    disabled={bypassProcessing}
                    onChange={(e) => setLoudnessMatch(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--ui-border)] accent-[var(--ui-accent)] disabled:opacity-45"
                  />
                </label>
              </div>
              <p className="mt-3 text-xs text-[var(--ui-muted)]">
                {bypassProcessing
                  ? "Bypass active: original signal only."
                  : loudnessMatch
                    ? `Matched gain: ${playbackOutputGain.toFixed(2)}x`
                    : "Loudness match disabled."}
              </p>
            </section>

            <section className="mt-4 border-t border-[var(--ui-border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Muffle
              </h2>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">
                Realtime high-cut filter.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={highCutFrac}
                  onChange={(e) => setHighCutFrac(Number(e.target.value))}
                  className="h-2 flex-1 cursor-pointer rounded-lg accent-[var(--ui-accent)]"
                />
                <span className="w-12 text-right font-mono text-xs text-[var(--ui-muted)]">
                  {Math.round(highCutFrac * 100)}%
                </span>
              </div>
            </section>

            <section className="mt-4 border-t border-[var(--ui-border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Denoise
              </h2>
              <label className="mt-2 flex cursor-pointer items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
                <span className="text-sm">Enable denoise</span>
                <input
                  type="checkbox"
                  checked={applyDenoise}
                  onChange={(e) => handleDenoiseToggle(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--ui-border)] accent-[var(--ui-accent)]"
                />
              </label>
              {applyDenoise && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Noise (s)
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={noiseSeconds}
                      onChange={(e) => handleNoiseSecondsChange(Number(e.target.value))}
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                    />
                  </label>
                  <label className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Strength (a)
                    </span>
                    <input
                      type="number"
                      min={0.5}
                      max={3}
                      step={0.1}
                      value={denoiseAlpha}
                      onChange={(e) => handleDenoiseAlphaChange(Number(e.target.value))}
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                    />
                  </label>
                </div>
              )}
              <p className="mt-3 text-xs text-[var(--ui-muted)]">
                {denoiseError
                  ? `Denoise failed: ${denoiseError}`
                  : isDenoiseProcessing
                    ? "Processing denoise..."
                    : denoiseReady
                      ? "Denoise buffer ready."
                      : "Using original until denoise is ready."}
              </p>
            </section>

            <section className="mt-4 border-t border-[var(--ui-border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Spectrogram Lens
              </h2>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">
                Visual-only STFT settings. Playback processing stays fixed.
              </p>
              <div className="mt-3 space-y-2">
                <label className="block rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2">
                  <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                    FFT size
                    <button
                      type="button"
                      onClick={() => setHelpOpen((h) => (h === "fftSize" ? null : "fftSize"))}
                      className="h-5 w-5 rounded-full border border-[var(--ui-border)] text-[10px]"
                    >
                      i
                    </button>
                  </span>
                  <select
                    value={visualStftOptions.fftSize}
                    onChange={(e) =>
                      setVisualStftOptions((o) => ({
                        ...o,
                        fftSize: Number(e.target.value),
                      }))
                    }
                    className="mt-1 w-full bg-transparent text-sm outline-none"
                  >
                    {FFT_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2">
                  <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                    Hop length
                    <button
                      type="button"
                      onClick={() =>
                        setHelpOpen((h) => (h === "hopLength" ? null : "hopLength"))
                      }
                      className="h-5 w-5 rounded-full border border-[var(--ui-border)] text-[10px]"
                    >
                      i
                    </button>
                  </span>
                  <select
                    value={visualStftOptions.hopLength}
                    onChange={(e) =>
                      setVisualStftOptions((o) => ({
                        ...o,
                        hopLength: Number(e.target.value),
                      }))
                    }
                    className="mt-1 w-full bg-transparent text-sm outline-none"
                  >
                    {HOP_LENGTHS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2">
                  <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                    Window
                    <button
                      type="button"
                      onClick={() => setHelpOpen((h) => (h === "window" ? null : "window"))}
                      className="h-5 w-5 rounded-full border border-[var(--ui-border)] text-[10px]"
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
                    className="mt-1 w-full bg-transparent text-sm outline-none"
                  >
                    {WINDOW_TYPES.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {helpOpen && (
                <p className="mt-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs text-[var(--ui-muted)]">
                  {HELP_TEXT[helpOpen]}
                </p>
              )}
            </section>
          </aside>

          <section className="flex min-h-0 flex-col gap-5">
            <div className="min-h-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Waveform</h2>
                  <InfoTip text="Shows amplitude over time. Taller spikes mean louder signal; flat areas are quiet." />
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ui-muted)]">
                  {spectrogramSource === "processed"
                    ? "Processed signal"
                    : "Original signal"}
                </span>
              </div>
              <div className="h-[220px] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)]">
                <WaveformCanvas
                  samples={spectrogramSamples ?? audio.samples}
                  width={1400}
                  height={220}
                  className="h-full w-full"
                />
              </div>
            </div>

            <div className="min-h-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Spectrogram</h2>
                  <InfoTip text="Shows frequency over time. Bottom is low pitch, top is high pitch. Brighter colors mean stronger energy." />
                </div>
                <div className="inline-flex rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-1">
                  <button
                    type="button"
                    onClick={() => setSpectrogramSource("original")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                      spectrogramSource === "original"
                        ? "bg-[var(--ui-accent)] text-white"
                        : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
                    }`}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpectrogramSource("processed")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                      spectrogramSource === "processed"
                        ? "bg-[var(--ui-accent)] text-white"
                        : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
                    }`}
                  >
                    Processed
                  </button>
                </div>
              </div>
              <p className="mb-2 text-xs text-[var(--ui-muted)]">
                Processed view = denoise (if enabled) + muffle slider. Bypass only affects playback.
              </p>
              <div className="h-[420px] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)]">
                {dbFrames && dbFrames.length > 0 && (
                  <SpectrogramCanvas
                    dbFrames={dbFrames}
                    sampleRate={audio.sampleRate}
                    fftSize={visualStftOptions.fftSize}
                    hopLength={visualStftOptions.hopLength}
                    width={1400}
                    height={420}
                    className="h-full w-full"
                  />
                )}
                {(!dbFrames || dbFrames.length === 0) && (
                  <p className="px-3 py-2 text-xs text-[var(--ui-muted)]">
                    Clip is too short for this FFT size. Try lower FFT size.
                  </p>
                )}
              </div>
              <p className="mt-2 text-xs text-[var(--ui-muted)]">
                Tip: use Chirp or Tone+Noise to see clearer time-frequency changes.
              </p>
            </div>
          </section>
        </div>
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[11px] text-[var(--ui-muted)]"
        aria-label="Info"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 py-2 text-xs font-normal leading-relaxed text-[var(--ui-muted)] shadow-sm group-hover:block">
        {text}
      </span>
    </span>
  );
}
