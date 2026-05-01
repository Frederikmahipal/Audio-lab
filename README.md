# Audio Lab

Audio Lab is a browser-based signal-processing workspace for audio data, built as an exam project for **Signal Processing for Interactive Systems (SPIS)**. It demonstrates a preprocessing pipeline that turns raw audio into compact, ML-ready features and uploads them to Edge Impulse.

The full technical write-up is in the accompanying report. This README only covers what the app does and how to run it.

Deployed version: [audio-lab-ruddy.vercel.app](https://audio-lab-ruddy.vercel.app)

## What The App Does

- Upload WAV/MP3 audio or record from the microphone
- Generate deterministic test signals
- Convert audio to mono, 16 kHz, peak-normalized samples
- Inspect the waveform and STFT spectrogram
- Tune FFT size, hop length, and analysis window
- Apply spectral-subtraction denoising
- Apply a high-cut filter
- Extract 32-band log-mel filterbank energy features
- Download the feature matrix as CSV
- Upload one feature CSV sample to an Edge Impulse project

## Getting Started

### Requirements

- Node.js
- npm

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Edge Impulse Setup

The Edge Impulse upload route requires a project API key. Add it to `.env`:

```bash
EDGE_IMPULSE_API_KEY=
```

Without this key the rest of the app still works; only the upload action is disabled.
