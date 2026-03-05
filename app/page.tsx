import Link from "next/link";
import { HomeClient } from "@/components/HomeClient";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
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
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Record &amp; Upload
        </h1>
        <p className="mb-4 text-zinc-600 dark:text-zinc-400">
          Upload a WAV or MP3, record from the mic, or generate a test signal.
          Then open Analyze to play it back, see the waveform and spectrogram, and
          (soon) tweak FFT/denoise and export features.
        </p>
        <details className="mb-8 rounded-lg border border-zinc-200 bg-zinc-100/50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">
            What is this project about?
          </summary>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            The course is about <strong>signal processing for interactive systems</strong>:
            real-world sensor data (here, audio) is noisy and messy, so we need ways to
            analyse it (e.g. spectrogram), clean it (denoising), and pull out stable
            features (e.g. MFCC) for machine learning. This Audio Lab is a small
            tool to do that end-to-end: you get audio in, look at it in time and
            frequency, reduce noise, extract features, and compare how different
            settings affect the result. Playing the sound while you change
            settings helps you hear what the maths is doing.
          </p>
        </details>
        <HomeClient />
      </main>
    </div>
  );
}
