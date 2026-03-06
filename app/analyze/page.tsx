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
import { extractFeatures, type FeatureSummary } from "@/lib/dsp/features";
import {
  logSpectralDistanceDb,
  snrDb,
  spectralConvergence,
  timed,
} from "@/lib/dsp/eval";
import { analyzeLpc } from "@/lib/dsp/lpc";

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
const DEFAULT_FEATURE_STFT: STFTOptions = {
  fftSize: 1024,
  hopLength: 256,
  windowType: "hann",
};
const DENOISE_DEBOUNCE_MS = 220;

type HelpKey = "fftSize" | "hopLength" | "window" | null;
type SpectrogramSource = "original" | "processed";
type AnalyzePanel = "visualization" | "evaluation";
type LpcSummary = ReturnType<typeof analyzeLpc>;

interface ValidationChecks {
  featureFinite: boolean;
  lpcStable: boolean;
  processedChanged: boolean;
}

interface AnalysisReport {
  generatedAt: string;
  clip: {
    sampleRate: number;
    durationSeconds: number;
    samples: number;
  };
  settings: {
    highCutFrac: number;
    applyDenoise: boolean;
    denoiseAlpha: number;
    noiseSeconds: number;
    lpcOrder: number;
    visualStft: STFTOptions;
  };
  metrics: {
    snrDb: number;
    logSpectralDistanceDb: number;
    spectralConvergence: number;
    hasProcessing: boolean;
    runtimesMs: {
      denoise: number;
      muffle: number;
      featuresOriginal: number;
      featuresProcessed: number;
      lpcOriginal: number;
      lpcProcessed: number;
    };
  };
  features: {
    original: FeatureSummary;
    processed: FeatureSummary;
  };
  lpc: {
    original: LpcSummary;
    processed: LpcSummary;
  };
  validation: ValidationChecks | null;
  segmentExperiment: {
    segmentCount: number;
    snr: { mean: number; std: number };
    lsd: { mean: number; std: number };
    convergence: { mean: number; std: number };
  } | null;
  discussion: string[];
}

const HELP_TEXT: Record<NonNullable<HelpKey>, string> = {
  fftSize:
    "How many samples each FFT frame analyzes. Bigger FFT gives clearer frequency detail, smaller FFT gives sharper timing detail.",
  hopLength:
    "How far the analysis window moves each step. Smaller hop gives denser time tracking but costs more computation.",
  window:
    "Window shape before each FFT frame. Hann and Hamming reduce spectral leakage; rectangular is more raw but can show more artifacts.",
};

const METRIC_HELP = {
  snr: "Signal-to-noise ratio. Higher is usually better and means processed audio stays cleaner relative to unwanted difference.",
  lsd: "Log spectral distance. Lower is usually better and means the frequency content changed less from the original.",
  spectralConvergence:
    "How close processed and original spectra are frame-by-frame. Lower means closer.",
  denoiseRuntime:
    "How long denoising computation took for this clip. Lower is faster.",
  muffleRuntime:
    "How long the high-cut (muffle) computation took for this clip. Lower is faster.",
  featureRuntime:
    "Time spent extracting DSP features. Useful when comparing computational cost.",
  lpcRuntime:
    "Time spent fitting the LPC/AR parametric model. Useful for efficiency comparison.",
  featureFinite:
    "Checks that feature values are valid numbers (not NaN or Infinity).",
  lpcStable:
    "Checks LPC output is numerically valid enough for interpretation.",
  processedDiffers:
    "Checks processing actually changed the signal compared to the original.",
  segments:
    "How many short clip segments were analyzed for batch-style statistics.",
  snrMeanStd:
    "Average SNR across segments and how much it varies. Lower variation means more consistent behavior.",
  lsdMeanStd:
    "Average spectral distance across segments and its variation.",
  convMeanStd:
    "Average spectral convergence across segments and its variation.",
  frames:
    "Number of short analysis windows used to compute features.",
  centroid:
    "Spectral centroid is brightness: higher values usually sound brighter/sharper.",
  bandwidth:
    "How spread out energy is around the spectral centroid. Higher means broader frequency spread.",
  rolloff:
    "Frequency below which most energy is contained. Often rises with brighter signals.",
  flux: "How quickly the spectrum changes over time.",
  rms: "Average signal energy (a loudness-like measure).",
  zcr: "Zero-crossing rate: how often waveform crosses zero. Often higher for noisy or high-frequency signals.",
  mfcc: "MFCCs are compact timbre descriptors often used as ML input features.",
  lpcOrder: "Model order controls LPC complexity. Higher can fit more detail but may be less robust.",
  lpcError: "Prediction error of the LPC model. Lower means better prediction fit.",
  residualRms:
    "Energy left after LPC prediction. Lower often means the model explains more of the signal.",
  lpcGain: "Overall gain term of the LPC model.",
  lpcCoeff: "First LPC coefficients of the AR model. They describe the learned filter shape.",
} as const;

export default function AnalyzePage() {
  const { audio } = useAudioLab();
  const [visualStftOptions, setVisualStftOptions] =
    useState<STFTOptions>(DEFAULT_VISUAL_STFT);
  const [spectrogramSource, setSpectrogramSource] =
    useState<SpectrogramSource>("original");
  const [analyzePanel, setAnalyzePanel] = useState<AnalyzePanel>("visualization");
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
  const [denoiseRuntimeMs, setDenoiseRuntimeMs] = useState<number | null>(null);
  const [lpcOrder, setLpcOrder] = useState(12);
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

  const processedPreview = useMemo(() => {
    if (!audio?.samples.length || !denoiseBaseSamples) return null;
    if (highCutFrac <= 0) {
      return {
        samples: denoiseBaseSamples,
        filterRuntimeMs: 0,
      };
    }
    const { value: filtered, durationMs } = timed(() =>
      highCutFilter(
      denoiseBaseSamples,
      audio.sampleRate,
      DEFAULT_PROCESSING_STFT,
      highCutFrac
      )
    );
    return {
      samples: filtered,
      filterRuntimeMs: durationMs,
    };
  }, [audio?.samples, audio?.sampleRate, denoiseBaseSamples, highCutFrac]);

  const processedPreviewSamples = processedPreview?.samples ?? null;

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

  const analysisProcessedSamples = useMemo(() => {
    if (!audio?.samples.length) return null;
    return processedPreviewSamples ?? audio.samples;
  }, [audio?.samples, processedPreviewSamples]);

  const originalFeatureEval = useMemo(() => {
    if (!audio?.samples.length) return null;
    return timed(() =>
      extractFeatures(audio.samples, audio.sampleRate, DEFAULT_FEATURE_STFT)
    );
  }, [audio?.samples, audio?.sampleRate]);

  const processedFeatureEval = useMemo(() => {
    if (!analysisProcessedSamples || !audio?.sampleRate) return null;
    return timed(() =>
      extractFeatures(
        analysisProcessedSamples,
        audio.sampleRate,
        DEFAULT_FEATURE_STFT
      )
    );
  }, [analysisProcessedSamples, audio?.sampleRate]);

  const originalLpcEval = useMemo(() => {
    if (!audio?.samples.length) return null;
    return timed(() => analyzeLpc(audio.samples, lpcOrder));
  }, [audio?.samples, lpcOrder]);

  const processedLpcEval = useMemo(() => {
    if (!analysisProcessedSamples) return null;
    return timed(() => analyzeLpc(analysisProcessedSamples, lpcOrder));
  }, [analysisProcessedSamples, lpcOrder]);

  const evaluationMetrics = useMemo(() => {
    if (!audio?.samples.length || !analysisProcessedSamples) return null;
    return {
      snrDb: snrDb(audio.samples, analysisProcessedSamples),
      logSpectralDistanceDb: logSpectralDistanceDb(
        audio.samples,
        analysisProcessedSamples,
        DEFAULT_FEATURE_STFT
      ),
      spectralConvergence: spectralConvergence(
        audio.samples,
        analysisProcessedSamples,
        DEFAULT_FEATURE_STFT
      ),
      hasProcessing: highCutFrac > 0 || (applyDenoise && denoiseReady),
    };
  }, [
    audio?.samples,
    analysisProcessedSamples,
    highCutFrac,
    applyDenoise,
    denoiseReady,
  ]);

  const segmentExperiment = useMemo(() => {
    if (!audio?.samples.length || !analysisProcessedSamples) return null;
    const minLen = Math.min(audio.samples.length, analysisProcessedSamples.length);
    const segmentLength = Math.max(
      DEFAULT_FEATURE_STFT.fftSize * 4,
      Math.floor(0.8 * audio.sampleRate)
    );
    const maxSegments = 20;
    const snrVals: number[] = [];
    const lsdVals: number[] = [];
    const convVals: number[] = [];

    for (
      let start = 0;
      start + segmentLength <= minLen && snrVals.length < maxSegments;
      start += segmentLength
    ) {
      const ref = audio.samples.subarray(start, start + segmentLength);
      const proc = analysisProcessedSamples.subarray(start, start + segmentLength);
      snrVals.push(snrDb(ref, proc));
      lsdVals.push(logSpectralDistanceDb(ref, proc, DEFAULT_FEATURE_STFT));
      convVals.push(spectralConvergence(ref, proc, DEFAULT_FEATURE_STFT));
    }

    if (snrVals.length === 0) return null;
    return {
      segmentCount: snrVals.length,
      snr: meanStd(snrVals),
      lsd: meanStd(lsdVals),
      convergence: meanStd(convVals),
    };
  }, [audio?.samples, audio?.sampleRate, analysisProcessedSamples]);

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
      setDenoiseRuntimeMs(null);

      computeTimer = setTimeout(() => {
        if (denoiseJobRef.current !== jobId) return;
        try {
          const t0 = performance.now();
          const out = computeDenoisedSamples(
            sourceSamples,
            sourceRate,
            DEFAULT_PROCESSING_STFT,
            noiseSeconds,
            denoiseAlpha
          );
          const t1 = performance.now();
          if (denoiseJobRef.current !== jobId) return;
          setDenoisedResult({ source: sourceSamples, samples: out });
          setDenoiseRuntimeMs(t1 - t0);
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
      setDenoiseRuntimeMs(null);
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

  const validationChecks = useMemo(() => {
    if (!audio?.samples.length || !analysisProcessedSamples) return null;
    const featureFinite =
      !!originalFeatureEval &&
      !!processedFeatureEval &&
      allFinite(originalFeatureEval.value.mfccMean) &&
      allFinite(processedFeatureEval.value.mfccMean);
    const lpcStable =
      !!originalLpcEval &&
      !!processedLpcEval &&
      originalLpcEval.value.predictionError > 0 &&
      processedLpcEval.value.predictionError > 0 &&
      allFinite(originalLpcEval.value.coefficients) &&
      allFinite(processedLpcEval.value.coefficients);
    const processedChanged =
      Math.abs(snrDb(audio.samples, analysisProcessedSamples)) < 120;

    return {
      featureFinite,
      lpcStable,
      processedChanged,
    };
  }, [
    audio?.samples,
    analysisProcessedSamples,
    originalFeatureEval,
    processedFeatureEval,
    originalLpcEval,
    processedLpcEval,
  ]);

  const reportData = useMemo(() => {
    if (
      !audio?.samples.length ||
      !analysisProcessedSamples ||
      !evaluationMetrics ||
      !originalFeatureEval ||
      !processedFeatureEval ||
      !originalLpcEval ||
      !processedLpcEval
    ) {
      return null;
    }
    return {
      generatedAt: new Date().toISOString(),
      clip: {
        sampleRate: audio.sampleRate,
        durationSeconds: audio.durationSeconds,
        samples: audio.samples.length,
      },
      settings: {
        highCutFrac,
        applyDenoise,
        denoiseAlpha,
        noiseSeconds,
        lpcOrder,
        visualStft: visualStftOptions,
      },
      metrics: {
        ...evaluationMetrics,
        runtimesMs: {
          denoise: denoiseRuntimeMs ?? 0,
          muffle: processedPreview?.filterRuntimeMs ?? 0,
          featuresOriginal: originalFeatureEval.durationMs,
          featuresProcessed: processedFeatureEval.durationMs,
          lpcOriginal: originalLpcEval.durationMs,
          lpcProcessed: processedLpcEval.durationMs,
        },
      },
      features: {
        original: originalFeatureEval.value,
        processed: processedFeatureEval.value,
      },
      lpc: {
        original: originalLpcEval.value,
        processed: processedLpcEval.value,
      },
      validation: validationChecks,
      segmentExperiment,
      discussion: [
        "Spectral subtraction assumes early frames contain mostly noise.",
        "High-cut filtering improves robustness for low-frequency cues but removes high-frequency detail.",
        "STFT settings trade time resolution against frequency resolution.",
      ],
    };
  }, [
    audio?.samples,
    audio?.sampleRate,
    audio?.durationSeconds,
    analysisProcessedSamples,
    evaluationMetrics,
    highCutFrac,
    applyDenoise,
    denoiseAlpha,
    noiseSeconds,
    lpcOrder,
    visualStftOptions,
    denoiseRuntimeMs,
    processedPreview?.filterRuntimeMs,
    originalFeatureEval,
    processedFeatureEval,
    originalLpcEval,
    processedLpcEval,
    validationChecks,
    segmentExperiment,
  ]);

  function handleExportJson() {
    if (!reportData) return;
    const text = JSON.stringify(reportData, null, 2);
    downloadText("spis-analysis-report.json", "application/json", text);
  }

  function handleExportCsv() {
    if (!reportData) return;
    const csv = reportDataToCsv(reportData);
    downloadText("spis-analysis-report.csv", "text/csv;charset=utf-8", csv);
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
            <div className="flex justify-center sm:justify-start">
              <div className="inline-flex rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-1">
                <button
                  type="button"
                  onClick={() => setAnalyzePanel("visualization")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                    analyzePanel === "visualization"
                      ? "bg-[var(--ui-accent)] text-white"
                      : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
                  }`}
                >
                  Visualization
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyzePanel("evaluation")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                    analyzePanel === "evaluation"
                      ? "bg-[var(--ui-accent)] text-white"
                      : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
                  }`}
                >
                  Evaluation
                </button>
              </div>
            </div>

            {analyzePanel === "visualization" ? (
              <div className="flex min-h-0 flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] px-3 py-2.5">
                  <p className="text-xs text-[var(--ui-muted)]">
                    Visualization source (applies to waveform + spectrogram)
                  </p>
                  <div className="inline-flex rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1">
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

                <div className="min-h-0">
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Waveform</h2>
                    <InfoTip text="Shows amplitude over time. Taller spikes mean louder signal; flat areas are quiet." />
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
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Spectrogram</h2>
                      <InfoTip text="Shows frequency over time. Bottom is low pitch, top is high pitch. Brighter colors mean stronger energy." />
                    </div>
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
                  <p className="mt-2 text-xs text-[var(--ui-muted)]">
                    Processed view = denoise (if enabled) + muffle slider. Bypass only affects playback.
                  </p>
                  <p className="mt-2 text-xs text-[var(--ui-muted)]">
                    Tip: use Harmonic sweep or Step pattern to see clearer time-frequency changes.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-5">
                <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                      Quick Evaluation
                    </h3>
                    <InfoTip text="Start with these four numbers. Open Advanced only when you want deeper DSP details." />
                  </div>
                  {evaluationMetrics ? (
                    <>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <MetricRow
                          label="SNR vs original"
                          value={
                            evaluationMetrics.hasProcessing
                              ? `${formatMetric(evaluationMetrics.snrDb, 2)} dB`
                              : "No processing active"
                          }
                          hint={METRIC_HELP.snr}
                        />
                        <MetricRow
                          label="Log spectral distance"
                          value={`${formatMetric(evaluationMetrics.logSpectralDistanceDb, 2)} dB`}
                          hint={METRIC_HELP.lsd}
                        />
                        <MetricRow
                          label="Denoise runtime"
                          value={`${formatMetric(denoiseRuntimeMs ?? 0, 2)} ms`}
                          hint={METRIC_HELP.denoiseRuntime}
                        />
                        <MetricRow
                          label="Muffle runtime"
                          value={`${formatMetric(processedPreview?.filterRuntimeMs ?? 0, 2)} ms`}
                          hint={METRIC_HELP.muffleRuntime}
                        />
                      </div>
                      <p className="mt-3 text-xs text-[var(--ui-muted)]">
                        Higher SNR and lower spectral distance usually indicate cleaner
                        processing with less distortion.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--ui-muted)]">
                      Evaluation appears when signal analysis is ready.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                      Export
                    </h3>
                    <InfoTip text="Download your evaluation results so you can include them in a report, portfolio, or further analysis." />
                  </div>
                  <p className="mt-2 text-xs text-[var(--ui-muted)]">
                    Download report data for your notes, figures, or course write-up.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleExportJson}
                      disabled={!reportData}
                      className="rounded-md bg-[var(--ui-accent)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white disabled:opacity-55"
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      disabled={!reportData}
                      className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ui-ink)] disabled:opacity-55"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                <details className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                    Advanced Metrics (Optional)
                  </summary>
                  <p className="mt-2 text-xs text-[var(--ui-muted)]">
                    Open this when you want deeper diagnostics for feature extraction,
                    parametric modeling, and batch behavior.
                  </p>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]/55 p-4">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                          Diagnostics
                        </h4>
                        <InfoTip text="Extra checks about signal similarity, numerical stability, and compute cost." />
                      </div>
                      <div className="mt-3 space-y-2 text-sm">
                        <MetricRow
                          label="Spectral convergence"
                          value={formatMetric(evaluationMetrics?.spectralConvergence ?? 0, 4)}
                          hint={METRIC_HELP.spectralConvergence}
                        />
                        <MetricRow
                          label="Feature runtime (orig/proc)"
                          value={`${formatMetric(originalFeatureEval?.durationMs ?? 0, 2)} / ${formatMetric(
                            processedFeatureEval?.durationMs ?? 0,
                            2
                          )} ms`}
                          hint={METRIC_HELP.featureRuntime}
                        />
                        <MetricRow
                          label="LPC runtime (orig/proc)"
                          value={`${formatMetric(originalLpcEval?.durationMs ?? 0, 2)} / ${formatMetric(
                            processedLpcEval?.durationMs ?? 0,
                            2
                          )} ms`}
                          hint={METRIC_HELP.lpcRuntime}
                        />
                        {validationChecks && (
                          <>
                            <MetricRow
                              label="Feature values finite"
                              value={validationChecks.featureFinite ? "Pass" : "Fail"}
                              hint={METRIC_HELP.featureFinite}
                            />
                            <MetricRow
                              label="LPC stable"
                              value={validationChecks.lpcStable ? "Pass" : "Fail"}
                              hint={METRIC_HELP.lpcStable}
                            />
                            <MetricRow
                              label="Processed differs"
                              value={validationChecks.processedChanged ? "Pass" : "Fail"}
                              hint={METRIC_HELP.processedDiffers}
                            />
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]/55 p-4">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                          Dataset Experiment
                        </h4>
                        <InfoTip text="Runs the same metrics across multiple short segments to show average behavior and consistency." />
                      </div>
                      {segmentExperiment ? (
                        <div className="mt-3 grid gap-2">
                          <MetricRow
                            label="Segments analyzed"
                            value={segmentExperiment.segmentCount.toString()}
                            hint={METRIC_HELP.segments}
                          />
                          <MetricRow
                            label="SNR mean ± std"
                            value={`${formatMetric(segmentExperiment.snr.mean, 2)} ± ${formatMetric(
                              segmentExperiment.snr.std,
                              2
                            )} dB`}
                            hint={METRIC_HELP.snrMeanStd}
                          />
                          <MetricRow
                            label="LSD mean ± std"
                            value={`${formatMetric(segmentExperiment.lsd.mean, 2)} ± ${formatMetric(
                              segmentExperiment.lsd.std,
                              2
                            )} dB`}
                            hint={METRIC_HELP.lsdMeanStd}
                          />
                          <MetricRow
                            label="Conv mean ± std"
                            value={`${formatMetric(
                              segmentExperiment.convergence.mean,
                              4
                            )} ± ${formatMetric(segmentExperiment.convergence.std, 4)}`}
                            hint={METRIC_HELP.convMeanStd}
                          />
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-[var(--ui-muted)]">
                          Clip is too short for segment-level batch analysis.
                        </p>
                      )}
                      <p className="mt-3 text-xs text-[var(--ui-muted)]">
                        Tradeoff note: denoise assumes early noise-only frames; high-cut
                        improves robustness but removes high-frequency detail.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]/55 p-4">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                          Feature Summary
                        </h4>
                        <InfoTip text="A compact description of the signal's characteristics (brightness, energy, change rate, and ML-friendly descriptors)." />
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <FeatureSummaryCard
                          title="Original"
                          summary={originalFeatureEval?.value ?? null}
                        />
                        <FeatureSummaryCard
                          title="Processed"
                          summary={processedFeatureEval?.value ?? null}
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]/55 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--ui-muted)]">
                          Parametric LPC/AR
                        </h4>
                        <InfoTip text="A classic parametric model that predicts each sample from previous samples using AR coefficients." />
                        <label className="flex items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--ui-muted)]">
                            Order
                          </span>
                          <input
                            type="number"
                            min={4}
                            max={24}
                            step={1}
                            value={lpcOrder}
                            onChange={(e) => setLpcOrder(Number(e.target.value))}
                            className="w-12 bg-transparent text-sm outline-none"
                          />
                        </label>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <LpcSummaryCard
                          title="Original"
                          result={originalLpcEval?.value ?? null}
                        />
                        <LpcSummaryCard
                          title="Processed"
                          result={processedLpcEval?.value ?? null}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            )}
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

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--ui-border)]/50 bg-[var(--ui-surface)]/60 px-2.5 py-1.5">
      <span className="flex items-center gap-1 text-xs text-[var(--ui-muted)]">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      <span className="font-mono text-xs text-[var(--ui-ink)]">{value}</span>
    </div>
  );
}

function FeatureSummaryCard({
  title,
  summary,
}: {
  title: string;
  summary: FeatureSummary | null;
}) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-2 text-xs text-[var(--ui-muted)]">No features yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-2 space-y-1">
        <MetricRow
          label="Frames"
          value={summary.frameCount.toString()}
          hint={METRIC_HELP.frames}
        />
        <MetricRow
          label="Centroid mean"
          value={`${formatMetric(summary.spectralCentroidHz.mean, 1)} Hz`}
          hint={METRIC_HELP.centroid}
        />
        <MetricRow
          label="Bandwidth mean"
          value={`${formatMetric(summary.spectralBandwidthHz.mean, 1)} Hz`}
          hint={METRIC_HELP.bandwidth}
        />
        <MetricRow
          label="Rolloff mean"
          value={`${formatMetric(summary.spectralRolloffHz.mean, 1)} Hz`}
          hint={METRIC_HELP.rolloff}
        />
        <MetricRow
          label="Flux mean"
          value={formatMetric(summary.spectralFlux.mean, 4)}
          hint={METRIC_HELP.flux}
        />
        <MetricRow
          label="RMS mean"
          value={formatMetric(summary.rms.mean, 4)}
          hint={METRIC_HELP.rms}
        />
        <MetricRow
          label="ZCR mean"
          value={formatMetric(summary.zcr.mean, 4)}
          hint={METRIC_HELP.zcr}
        />
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ui-muted)]">
        <span>
          MFCC[0..4] mean:{" "}
          {summary.mfccMean.slice(0, 5).map((x) => formatMetric(x, 2)).join(", ")}
        </span>
        <InfoTip text={METRIC_HELP.mfcc} />
      </div>
    </div>
  );
}

function LpcSummaryCard({
  title,
  result,
}: {
  title: string;
  result: LpcSummary | null;
}) {
  if (!result) {
    return (
      <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-2 text-xs text-[var(--ui-muted)]">No LPC result yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-2 space-y-1">
        <MetricRow
          label="Order"
          value={result.order.toString()}
          hint={METRIC_HELP.lpcOrder}
        />
        <MetricRow
          label="Prediction error"
          value={formatMetric(result.predictionError, 6)}
          hint={METRIC_HELP.lpcError}
        />
        <MetricRow
          label="Residual RMS"
          value={formatMetric(result.residualRms, 6)}
          hint={METRIC_HELP.residualRms}
        />
        <MetricRow
          label="Gain"
          value={`${formatMetric(result.gainDb, 2)} dB`}
          hint={METRIC_HELP.lpcGain}
        />
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ui-muted)]">
        <span>
          a[1..4]:{" "}
          {result.coefficients.slice(0, 4).map((x) => formatMetric(x, 3)).join(", ")}
        </span>
        <InfoTip text={METRIC_HELP.lpcCoeff} />
      </div>
    </div>
  );
}

function formatMetric(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function allFinite(values: number[]): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

function meanStd(values: number[]): { mean: number; std: number } {
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

function downloadText(filename: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function reportDataToCsv(report: AnalysisReport): string {
  const rows: [string, string][] = [
    ["generatedAt", report.generatedAt],
    ["sampleRate", String(report.clip.sampleRate)],
    ["durationSeconds", String(report.clip.durationSeconds)],
    ["samples", String(report.clip.samples)],
    ["highCutFrac", String(report.settings.highCutFrac)],
    ["applyDenoise", String(report.settings.applyDenoise)],
    ["denoiseAlpha", String(report.settings.denoiseAlpha)],
    ["noiseSeconds", String(report.settings.noiseSeconds)],
    ["lpcOrder", String(report.settings.lpcOrder)],
    ["snrDb", String(report.metrics.snrDb)],
    ["logSpectralDistanceDb", String(report.metrics.logSpectralDistanceDb)],
    ["spectralConvergence", String(report.metrics.spectralConvergence)],
    ["runtimeDenoiseMs", String(report.metrics.runtimesMs.denoise)],
    ["runtimeMuffleMs", String(report.metrics.runtimesMs.muffle)],
    [
      "runtimeFeaturesOriginalMs",
      String(report.metrics.runtimesMs.featuresOriginal),
    ],
    [
      "runtimeFeaturesProcessedMs",
      String(report.metrics.runtimesMs.featuresProcessed),
    ],
    ["runtimeLpcOriginalMs", String(report.metrics.runtimesMs.lpcOriginal)],
    ["runtimeLpcProcessedMs", String(report.metrics.runtimesMs.lpcProcessed)],
    ["validationFeatureFinite", String(report.validation?.featureFinite ?? false)],
    ["validationLpcStable", String(report.validation?.lpcStable ?? false)],
    ["validationProcessedChanged", String(report.validation?.processedChanged ?? false)],
    ["featuresOriginalMfccMean", report.features.original.mfccMean.join(";")],
    ["featuresProcessedMfccMean", report.features.processed.mfccMean.join(";")],
    [
      "featuresOriginalCentroidMean",
      String(report.features.original.spectralCentroidHz.mean),
    ],
    [
      "featuresProcessedCentroidMean",
      String(report.features.processed.spectralCentroidHz.mean),
    ],
    ["lpcOriginalCoefficients", report.lpc.original.coefficients.join(";")],
    ["lpcProcessedCoefficients", report.lpc.processed.coefficients.join(";")],
    ["lpcOriginalGainDb", String(report.lpc.original.gainDb)],
    ["lpcProcessedGainDb", String(report.lpc.processed.gainDb)],
    [
      "segmentExperimentCount",
      String(report.segmentExperiment?.segmentCount ?? 0),
    ],
    [
      "segmentSNRMean",
      String(report.segmentExperiment?.snr.mean ?? 0),
    ],
    [
      "segmentSNRStd",
      String(report.segmentExperiment?.snr.std ?? 0),
    ],
    [
      "segmentLSDMean",
      String(report.segmentExperiment?.lsd.mean ?? 0),
    ],
    [
      "segmentLSDStd",
      String(report.segmentExperiment?.lsd.std ?? 0),
    ],
    [
      "segmentConvMean",
      String(report.segmentExperiment?.convergence.mean ?? 0),
    ],
    [
      "segmentConvStd",
      String(report.segmentExperiment?.convergence.std ?? 0),
    ],
    ["discussion", report.discussion.join(" | ")],
  ];

  const escaped = rows.map(([k, v]) => `${csvEscape(k)},${csvEscape(v)}`);
  return ["key,value", ...escaped].join("\n");
}

function csvEscape(input: string): string {
  if (input.includes(",") || input.includes("\n") || input.includes("\"")) {
    return `"${input.replaceAll("\"", "\"\"")}"`;
  }
  return input;
}
