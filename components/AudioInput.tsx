"use client";

import { useRef, useState } from "react";
import { useAudioLab } from "@/context/AudioLabContext";
import { decodeAudioToMono } from "@/lib/audio";
import Link from "next/link";

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
    if (recorder && status === "recording") {
      recorder.stop();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="audio/wav,audio/mpeg,audio/mp3,audio/x-wav,.wav,.mp3"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status === "loading" || status === "recording"}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {status === "loading" ? "Decoding…" : "Upload audio (WAV/MP3)"}
        </button>
        {status !== "recording" ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={status === "loading"}
            className="rounded-lg border border-red-500 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-400 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800"
          >
            Record from mic
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Stop recording
          </button>
        )}
        {audio && (
          <Link
            href="/analyze"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Open Analyze →
          </Link>
        )}
      </div>
      {status === "recording" && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Recording… Click &quot;Stop recording&quot; when done.
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
