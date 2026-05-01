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
import { extractLogMelFeatures } from "@/lib/dsp/features";

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
const MEL_BAND_COUNT = 32;

type HelpKey = "fftSize" | "hopLength" | "window" | null;

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
  const [helpOpen, setHelpOpen] = useState<HelpKey>(null);
  const [applyDenoise, setApplyDenoise] = useState(false);
  const [noiseSeconds, setNoiseSeconds] = useState(0.5);
  const [denoiseAlpha, setDenoiseAlpha] = useState(1.2);
  const [highCutFrac, setHighCutFrac] = useState(0);
  const [bypassProcessing, setBypassProcessing] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const [eiLabel, setEiLabel] = useState("speech");
  const [eiCategory, setEiCategory] = useState<"training" | "testing">(
    "training"
  );
  const [isEiUploading, setIsEiUploading] = useState(false);
  const [eiUploadMessage, setEiUploadMessage] = useState<string | null>(null);
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

  const analysisSamples = useMemo(() => {
    if (!audio?.samples.length) return null;
    return processedPreviewSamples ?? audio.samples;
  }, [audio?.samples, processedPreviewSamples]);

  const stftFrames = useMemo(() => {
    if (!analysisSamples?.length) return null;
    return stft(analysisSamples, visualStftOptions);
  }, [analysisSamples, visualStftOptions]);

  const dbFrames = useMemo(() => {
    if (!stftFrames?.length) return null;
    return magnitudeToDb(stftFrames);
  }, [stftFrames]);

  const logMelResult = useMemo(() => {
    if (!stftFrames?.length || !audio?.sampleRate) return null;
    return extractLogMelFeatures(
      stftFrames,
      audio.sampleRate,
      visualStftOptions.fftSize,
      {
        numBands: MEL_BAND_COUNT,
        minHz: 40,
        maxHz: Math.min(audio.sampleRate / 2, 7600),
      }
    );
  }, [stftFrames, audio?.sampleRate, visualStftOptions.fftSize]);

  const meanLogMelBands = useMemo(() => {
    if (!logMelResult?.dbFrames.length) return null;
    return computeMeanBands(logMelResult.dbFrames);
  }, [logMelResult]);

  const strongestMelBand = useMemo(() => {
    if (!logMelResult || !meanLogMelBands?.length) return null;
    let bestIndex = 0;
    for (let i = 1; i < meanLogMelBands.length; i++) {
      if ((meanLogMelBands[i] ?? -Infinity) > (meanLogMelBands[bestIndex] ?? -Infinity)) {
        bestIndex = i;
      }
    }
    return {
      index: bestIndex,
      hz: logMelResult.centerHz[bestIndex] ?? 0,
      db: meanLogMelBands[bestIndex] ?? 0,
    };
  }, [logMelResult, meanLogMelBands]);

  const meanLogMelBandPreview = useMemo(() => {
    if (!meanLogMelBands?.length) return [];
    return normalizeVector(meanLogMelBands);
  }, [meanLogMelBands]);

  useEffect(() => {
    if (!audio?.samples.length || !applyDenoise) return;

    const sourceSamples = audio.samples;
    const sourceRate = audio.sampleRate;
    const jobId = denoiseJobRef.current + 1;
    denoiseJobRef.current = jobId;

    let computeTimer: ReturnType<typeof setTimeout> | undefined;
    const debounceTimer = setTimeout(() => {
      if (denoiseJobRef.current !== jobId) return;
      setIsDenoiseProcessing(true);
      setDenoiseError(null);

      computeTimer = setTimeout(() => {
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
      clearTimeout(debounceTimer);
      if (computeTimer !== undefined) clearTimeout(computeTimer);
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

  function handleDownloadMfeCsv() {
    if (!logMelResult?.dbFrames.length || !audio?.sampleRate) return;

    const csv = buildEdgeImpulseCsv(
      logMelResult.dbFrames,
      visualStftOptions.hopLength,
      audio.sampleRate
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = buildEdgeImpulseFileName(eiLabel);
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function handleSendToEdgeImpulse() {
    if (!logMelResult?.dbFrames.length || !audio?.sampleRate) return;

    const label = sanitizeLabel(eiLabel);
    if (!label) {
      setEiUploadMessage("Add a label before sending to Edge Impulse.");
      return;
    }

    setIsEiUploading(true);
    setEiUploadMessage(null);

    try {
      const csv = buildEdgeImpulseCsv(
        logMelResult.dbFrames,
        visualStftOptions.hopLength,
        audio.sampleRate
      );
      const fileName = buildEdgeImpulseFileName(label);
      const response = await fetch("/api/edge-impulse/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: eiCategory,
          csv,
          fileName,
          label,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Edge Impulse upload failed.");
      }

      setEiUploadMessage(
        `Sent ${fileName} to Edge Impulse ${eiCategory} data.`
      );
    } catch (error) {
      setEiUploadMessage(
        error instanceof Error ? error.message : "Unknown upload error."
      );
    } finally {
      setIsEiUploading(false);
    }
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
    <div className="min-h-screen overflow-x-hidden text-[var(--ui-ink)]">
      <AppTopNav active="analyze" />

      <main className="mx-auto w-full max-w-[1440px] px-4 pb-5 pt-3 sm:px-6 xl:h-[calc(100vh_-_68px)]">
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,310px)_minmax(0,1fr)] xl:h-full">
          <aside className="soft-scroll min-h-0 overflow-visible rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 sm:p-5 xl:overflow-y-auto">
            <section>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ui-muted)]">
                Session
              </p>
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
            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                Current Analysis Signal
              </p>
              <p className="mt-1 text-xs text-[var(--ui-muted)]">
                The waveform and spectrogram always show the current processing chain.
                If denoise or high-cut is active, you see the enhanced signal; if not,
                the analysis signal is the original clip.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-lg font-semibold">Waveform</h2>
                <InfoTip text="Shows amplitude over time. Taller spikes mean louder signal; flat areas are quiet." />
              </div>
              <div className="h-[220px] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)]">
                <WaveformCanvas
                  samples={analysisSamples ?? audio.samples}
                  width={1400}
                  height={220}
                  className="h-full w-full"
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-lg font-semibold">Spectrogram</h2>
                <InfoTip text="Shows frequency over time. Bottom is low pitch, top is high pitch. Brighter colors mean stronger energy." />
              </div>
              <div className="h-[220px] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] sm:h-[250px] lg:h-[300px]">
                {dbFrames && dbFrames.length > 0 && (
                  <SpectrogramCanvas
                    dbFrames={dbFrames}
                    sampleRate={audio.sampleRate}
                    fftSize={visualStftOptions.fftSize}
                    hopLength={visualStftOptions.hopLength}
                    width={1400}
                    height={300}
                    className="h-full w-full"
                  />
                )}
                {(!dbFrames || dbFrames.length === 0) && (
                  <p className="px-3 py-2 text-xs text-[var(--ui-muted)]">
                    Clip is too short for this FFT size. Try lower FFT size.
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs text-[var(--ui-muted)]">
                The analysis view reflects the active preprocessing and enhancement
                steps. Bypass only affects playback so you can still A/B listen.
              </p>
              <p className="mt-2 text-xs text-[var(--ui-muted)]">
                Tip: use Harmonic sweep or Step pattern to see clearer time-frequency changes.
              </p>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-lg font-semibold">MFE Features</h2>
                <InfoTip text="MFE means log-mel filterbank energies. Each frame is compressed from many FFT bins into 32 perceptual bands, which is a compact feature vector for later machine learning." />
              </div>
              <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
                    <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 text-[var(--ui-muted)]">
                      {logMelResult?.dbFrames.length ?? 0} frames
                    </span>
                    <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 text-[var(--ui-muted)]">
                      {logMelResult?.numBands ?? 0} mel bands
                    </span>
                    <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 text-[var(--ui-muted)]">
                      {stftFrames?.[0]?.length ?? 0} FFT bins to 32 features
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadMfeCsv}
                    disabled={!logMelResult?.dbFrames.length}
                    className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--ui-ink)] transition hover:bg-[var(--ui-surface-muted)] disabled:opacity-45"
                  >
                    Download EI CSV
                  </button>
                </div>
                <p className="mt-3 text-xs text-[var(--ui-muted)]">
                  This is the first real feature-extraction step in the project: the
                  STFT is grouped into mel-spaced bands, converted to log energy, and
                  exported frame by frame for ML-ready analysis.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_220px]">
                  <label className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Edge Impulse label
                    </span>
                    <input
                      type="text"
                      value={eiLabel}
                      onChange={(e) => setEiLabel(e.target.value)}
                      placeholder="speech"
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                    />
                  </label>
                  <label className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Dataset split
                    </span>
                    <select
                      value={eiCategory}
                      onChange={(e) =>
                        setEiCategory(
                          e.target.value === "testing" ? "testing" : "training"
                        )
                      }
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                    >
                      <option value="training">Training</option>
                      <option value="testing">Testing</option>
                    </select>
                  </label>
                  <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Edge Impulse
                    </span>
                    <button
                      type="button"
                      onClick={handleSendToEdgeImpulse}
                      disabled={!logMelResult?.dbFrames.length || isEiUploading}
                      className="mt-1 w-full rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3.5 py-2 text-sm font-semibold text-[var(--ui-ink)] transition hover:bg-[var(--ui-surface-muted)] disabled:opacity-45"
                    >
                      {isEiUploading ? "Sending..." : "Send to Edge Impulse"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--ui-muted)]">
                  The app keeps doing preprocessing and MFE extraction locally, then
                  sends one EI-compatible CSV sample per clip to the selected dataset
                  split.
                </p>
                {eiUploadMessage && (
                  <p className="mt-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs text-[var(--ui-muted)]">
                    {eiUploadMessage}
                  </p>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Frame size
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {logMelResult?.numBands ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">
                      values per frame
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Strongest band
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {strongestMelBand ? `${Math.round(strongestMelBand.hz)} Hz` : "n/a"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">
                      mean log energy peak
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Mean level
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {meanLogMelBands
                        ? `${computeVectorMean(meanLogMelBands).toFixed(1)} dB`
                        : "n/a"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ui-muted)]">
                      across mel bands
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                      Mean Band Profile
                    </p>
                    <p className="text-xs text-[var(--ui-muted)]">
                      32 normalized mel-band means
                    </p>
                  </div>
                  <div className="mt-3 flex h-20 items-end gap-1">
                    {meanLogMelBandPreview.length > 0 ? (
                      meanLogMelBandPreview.map((value, index) => (
                        <div
                          key={index}
                          className="flex-1 rounded-t-sm bg-[linear-gradient(180deg,var(--ui-accent-2),var(--ui-accent))]"
                          style={{ height: `${Math.max(8, value * 100)}%` }}
                          title={`Band ${index + 1}: ${meanLogMelBands?.[index]?.toFixed(1) ?? "0.0"} dB`}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-[var(--ui-muted)]">
                        No MFE frames available for this clip.
                      </p>
                    )}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-[var(--ui-muted)]">
                    <span>Low mel bands</span>
                    <span>High mel bands</span>
                  </div>
                </div>
              </div>
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

function computeMeanBands(frames: Float32Array[]): Float32Array {
  const numBands = frames[0]?.length ?? 0;
  const out = new Float32Array(numBands);
  if (!frames.length || numBands === 0) return out;

  for (let t = 0; t < frames.length; t++) {
    const frame = frames[t]!;
    for (let band = 0; band < numBands; band++) {
      out[band] += frame[band] ?? 0;
    }
  }

  for (let band = 0; band < numBands; band++) {
    out[band] /= frames.length;
  }
  return out;
}

function computeVectorMean(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] ?? 0;
  return sum / values.length;
}

function normalizeVector(values: Float32Array): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = Math.max(1e-6, max - min);
  return Array.from(values, (value) => ((value ?? 0) - min) / range);
}

function buildEdgeImpulseCsv(
  dbFrames: Float32Array[],
  hopLength: number,
  sampleRate: number
): string {
  const numBands = dbFrames[0]?.length ?? 0;
  const headers = ["timestamp"];
  for (let i = 0; i < numBands; i++) {
    headers.push(`mel_${String(i + 1).padStart(2, "0")}`);
  }

  const rows = [headers.join(",")];
  for (let frameIndex = 0; frameIndex < dbFrames.length; frameIndex++) {
    const timeMs = Math.round((frameIndex * hopLength * 1000) / sampleRate);
    const row = [String(timeMs)];
    const frame = dbFrames[frameIndex]!;
    for (let band = 0; band < frame.length; band++) {
      row.push((frame[band] ?? 0).toFixed(4));
    }
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

function buildEdgeImpulseFileName(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sanitizeLabel(label) || "sample"}-${stamp}.csv`;
}

function sanitizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
