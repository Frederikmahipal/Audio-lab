"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useAudioLab } from "@/context/AudioLabContext";
import { decodeAudioToMono } from "@/lib/audio";

export function AudioInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const { setAudio, audio } = useAudioLab();
  const [status, setStatus] = useState<
    "idle" | "loading" | "done" | "error" | "recording"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("loading");
    setErrorMessage("");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await decodeAudioToMono(arrayBuffer);
      setAudio({
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
        durationSeconds: decoded.durationSeconds,
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Decode failed");
    }
    e.target.value = "";
  }

  async function startRecording() {
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (chunksRef.current.length === 0) {
          setStatus("error");
          setErrorMessage("No audio recorded.");
          return;
        }
        setStatus("loading");
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const decoded = await decodeAudioToMono(arrayBuffer);
          setAudio({
            samples: decoded.samples,
            sampleRate: decoded.sampleRate,
            durationSeconds: decoded.durationSeconds,
          });
          setStatus("done");
        } catch (err) {
          setStatus("error");
          setErrorMessage(
            err instanceof Error ? err.message : "Decode recording failed"
          );
        }
      };

      recorder.start(1000);
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Microphone access denied or failed"
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && status === "recording") recorder.stop();
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="audio/wav,audio/mpeg,audio/mp3,audio/x-wav,.wav,.mp3"
        onChange={handleFile}
        className="hidden"
      />

      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status === "loading" || status === "recording"}
          className="rounded-md bg-[var(--ui-accent)] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-55"
        >
          {status === "loading" ? "Decoding..." : "Upload WAV/MP3"}
        </button>
        {status !== "recording" ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={status === "loading"}
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--ui-ink)] transition hover:bg-[var(--ui-surface-muted)] disabled:opacity-55"
          >
            Record Mic
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-md bg-[var(--ui-accent)] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-105"
          >
            Stop Recording
          </button>
        )}
        {audio && (
          <Link
            href="/analyze"
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--ui-ink)] transition hover:bg-[var(--ui-surface-muted)]"
          >
            Open Analyze
          </Link>
        )}
      </div>

      <p className="text-xs text-[var(--ui-muted)]">
        {status === "recording"
          ? "Recording is active. Stop when you want to decode and load it."
          : status === "done" && audio
            ? `Loaded clip: ${formatDuration(audio.durationSeconds)} at ${audio.sampleRate} Hz`
            : "Tip: short clips process faster while tuning denoise parameters."}
      </p>

      {status === "error" && (
        <p className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2 text-sm text-[var(--ui-ink)]">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
