# Audio Lab

Audio Lab is a browser-based signal-processing workspace for audio data. It was built as an exam project for **Signal Processing for Interactive Systems (SPIS)** and focuses on the pipeline before machine learning: capture, preprocessing, spectral analysis, enhancement, feature extraction, and export to Edge Impulse.

The project does not try to be a complete trained audio classifier. Instead, it demonstrates how raw audio clips can be turned into cleaner, more compact, ML-ready representations that can be used in a later model-training workflow.

## What The App Does

Audio Lab lets you:

- upload WAV/MP3 audio or record from the microphone
- generate deterministic test signals for controlled analysis
- convert audio to mono, 16 kHz, peak-normalized samples
- inspect the waveform and STFT spectrogram
- tune FFT size, hop length, and analysis window
- apply spectral-subtraction denoising
- apply a high-cut filter for frequency-domain filtering experiments
- extract 32-band log-mel filterbank energy features
- download the feature matrix as CSV
- upload one feature CSV sample to an Edge Impulse project

The intended use is to explore how signal-processing choices affect the data that would later be used for interaction recognition or other audio-based ML tasks.

## Edge Impulse Integration

Audio Lab includes a working Edge Impulse upload path for the extracted feature data. After a clip has been processed on the Analyze page, the app can send one CSV sample to an Edge Impulse project as either training or testing data.

The integration is deliberately placed after feature extraction:

```text
processed audio
  -> STFT
  -> 32-band log-mel feature matrix
  -> Edge Impulse compatible CSV
  -> Edge Impulse ingestion API
```

This means the repository represents the preprocessing and dataset-preparation part of an ML workflow. A later step would be to collect labeled samples in Edge Impulse, train a classifier or detector, and evaluate how the selected DSP settings affect model accuracy and latency.

## Pipeline

```text
Audio input
  -> decode in browser
  -> mix to mono
  -> resample to 16 kHz
  -> peak normalize
  -> optional denoising
  -> optional high-cut filtering
  -> STFT analysis
  -> log-mel feature extraction
  -> CSV download or Edge Impulse upload
```

Most processing runs in the browser. The only server route is the Edge Impulse upload proxy, which keeps the project API key out of client-side code.

## Course Relevance

This project is a practical representation of a SPIS-style preprocessing and analysis pipeline for sensor data. Audio is treated as the input sensor signal.

Covered areas:

- **Spectral analysis:** FFT, STFT, spectrograms, dB magnitude display, window selection.
- **Signal enhancement:** noise-profile estimation and spectral subtraction.
- **Filtering:** STFT-domain high-cut filtering.
- **Feature extraction:** log-mel filterbank energies for downstream ML.
- **Interactive-system pipeline:** capture, process, visualize, export, and upload data for later model training.

Areas intentionally left as future work:

- trained classification or detection model
- quantitative model evaluation
- parametric spectral analysis
- multichannel filtering
- larger labeled dataset collection workflow

## Getting Started

### Requirements

- Node.js
- npm

This project is a Next.js app and uses the scripts defined in `package.json`.

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

The app can upload extracted MFE/log-mel CSV samples to Edge Impulse through:

```text
POST /api/edge-impulse/upload
```

Configure the api key variable in `.env`:

```bash
EDGE_IMPULSE_API_KEY=
```


The Analyze page sends:

- `csv`: the generated feature matrix
- `fileName`: generated from the label and timestamp
- `label`: sanitized class label
- `category`: `training` or `testing`

The server route forwards the CSV to Edge Impulse ingestion:

```text
https://ingestion.edgeimpulse.com/api/{training|testing}/files
```

The current implementation uploads one CSV sample per clip. It prepares data for an Edge Impulse project, but it does not train or evaluate a model inside this repository.

## Feature CSV Format

The exported CSV contains one row per STFT frame:

```csv
timestamp,mel_01,mel_02,...,mel_32
0,-42.1031,-38.5542,...
16,-41.8870,-37.9024,...
```

- `timestamp` is in milliseconds.
- `mel_01` to `mel_32` are log-mel band energies in dB.
- The timestamp step is derived from `hopLength / sampleRate`.

## Project Structure

```text
app/
  page.tsx                         Capture page
  analyze/page.tsx                 Analysis workspace
  api/edge-impulse/upload/route.ts Edge Impulse upload route

components/
  AudioInput.tsx                   Upload and microphone recording
  AudioPlayer.tsx                  Playback and high-cut preview
  SpectrogramCanvas.tsx            Spectrogram rendering
  TestSignalGenerator.tsx          Synthetic signal generation UI
  WaveformCanvas.tsx               Waveform rendering

context/
  AudioLabContext.tsx              In-memory audio state

lib/
  audio.ts                         Decode, mono conversion, resampling, normalization
  dsp/
    denoise.ts                     Noise estimation and spectral subtraction
    features.ts                    Log-mel feature extraction
    fft.ts                         FFT wrapper around fft.js
    filter.ts                      STFT-domain high-cut filter
    signals.ts                     Synthetic test signals
    stft.ts                        STFT, ISTFT, magnitude-to-dB
    windows.ts                     Hann, Hamming, rectangular windows
```

## DSP Implementation Notes

### Audio Preparation

`lib/audio.ts` decodes uploaded or recorded audio with the Web Audio API, mixes all channels to mono, resamples to 16 kHz with linear interpolation, and peak-normalizes the result.

### STFT Analysis

`lib/dsp/stft.ts` splits the signal into overlapping frames, applies a selected window, and computes FFT magnitudes for spectrogram and feature extraction. The analysis page exposes:

- FFT size: `512`, `1024`, `2048`
- hop length: `128`, `256`, `512`
- window: Hann, Hamming, rectangular

### Denoising

`lib/dsp/denoise.ts` estimates a noise spectrum from the first `N` seconds of the clip. It uses the median magnitude per frequency bin, then applies spectral subtraction:

```text
cleanedMagnitude = max(magnitude - alpha * noiseProfile, floor)
```

The phase is preserved for reconstruction through ISTFT.

### High-Cut Filtering

`lib/dsp/filter.ts` performs a simple low-pass effect in the STFT domain by zeroing bins above a cutoff frequency, then reconstructing the signal with ISTFT. In the UI this is exposed as the **Muffle** control.

### Log-Mel Features

`lib/dsp/features.ts` groups FFT bins into triangular mel-spaced filters, sums energy per band, and converts each band to dB. The result is a compact 32-value feature vector per frame.

## Development Notes

- Audio state is kept in React context and is not persisted across reloads.
- Denoising and feature extraction run client-side.
- Edge Impulse upload runs server-side because it requires a private API key.
- Short clips are easier to work with while tuning denoise and STFT parameters.
- Very short clips may not produce spectrogram frames for large FFT sizes.

## Known Limitations

- The app currently processes mono audio only.
- Resampling uses linear interpolation rather than a high-quality resampler.
- Denoising assumes the beginning of the clip contains representative noise.
- ISTFT reconstruction is intended for experimentation, not production audio restoration.
- Edge Impulse integration uploads extracted CSV features, not raw audio clips.
- No trained model, dataset management, or accuracy evaluation is included yet.

## Future Work

Useful extensions would be:

- collect labeled audio clips for multiple interaction classes
- train an Edge Impulse classifier from uploaded samples
- compare preprocessing settings against model accuracy and latency
- add runtime measurements for different FFT/hop/window configurations
- add more feature families such as MFCCs, spectral centroid, bandwidth, or zero-crossing rate
- add batch export/upload for multiple clips
- add support for multichannel analysis or beamforming experiments
