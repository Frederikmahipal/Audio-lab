# Audio Lab

For a full Danish walkthrough of the app, DSP pipeline, `lib/` files, features, and course-objective mapping, see [README.da.md](./README.da.md).

A Next.js web app for **signal processing on audio**: record or upload audio, view waveform and spectrogram, apply denoising and filtering, and extract compact audio features for later machine learning. Built for a course on signal processing for interactive systems.

---

## What is signal processing (in this project)?

The audio is a **list of numbers** (samples). **Signal processing** means we:

- **Analyse** them — e.g. Short-Time Fourier Transform (STFT) → spectrogram (time vs frequency).
- **Clean** them — e.g. estimate noise and subtract it (denoising).
- **Change** them — e.g. cut high frequencies (low-pass filter) so the sound gets muffled.

The course focuses on **analysis + noise reduction + feature extraction** for use with machine learning (e.g. MFCC for speech/music). This app implements the pipeline: get audio → visualise → denoise / filter → extract log-mel features → export features.

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **Record & Upload** to load audio, then **Analyze** to view and process it.

### Optional: Edge Impulse upload

To send extracted MFE samples directly to Edge Impulse from the Analyze page, add a project API key to `.env.local`:

```bash
EDGE_IMPULSE_API_KEY=your_edge_impulse_project_api_key
```

The app will then upload one EI-compatible CSV sample per clip through the built-in server route.

---

## Pages

### `/` — Record & Upload (home)

- **Purpose:** Get audio into the app.
- **Features:**
  - **Upload audio (WAV/MP3):** File is decoded in the browser (Web Audio API), converted to mono, resampled to 16 kHz, and peak-normalised.
  - **Record from mic:** Uses `MediaRecorder`; when you stop, the recording is decoded the same way as uploads.
  - **Generate test signal:** Two DSP-focused synthetic signals at 16 kHz for clear waveform/spectrogram demonstrations.
- **After loading:** An **Open Analyze →** link appears; one click takes you to the analysis workspace with the same clip.

### `/analyze` — Analysis workspace

- **Purpose:** Visualise, process, and extract features from the loaded clip.
- **Playback:** One realtime player with optional **Bypass processing** and **Loudness match** for A/B listening.
- **High cut (low-pass filter):** Slider 0–100%. Cuts high frequencies so the sound gets muffled.
- **Denoising:** Checkbox + “Noise (s)” + “Strength (a)”. Estimates noise from the first N seconds and applies spectral subtraction.
- **STFT controls:** FFT size (512 / 1024 / 2048), hop length (128 / 256 / 512), window (Hann / Hamming / Rectangular). These affect the analysis views.
- **Waveform:** Amplitude over time (time-domain view).
- **Spectrogram (STFT):** Time–frequency view (frequency vs time, brightness = energy).
- **MFE Features:** 32-band log-mel filterbank energies derived from the STFT, shown as a compact feature matrix and exportable as CSV.

---

## Project structure

```
app/
  layout.tsx          # Root layout, metadata, wraps with ClientProviders
  page.tsx            # Home: Record & Upload (server component, renders HomeClient)
  analyze/
    page.tsx          # Analysis workspace (client: playback, denoise, filter, STFT, waveform, spectrogram, MFE)

components/
  ClientProviders.tsx # Wraps app with AudioLabProvider (client)
  HomeClient.tsx      # Home client block: AudioInput + TestSignalGenerator
  AudioInput.tsx      # Upload button + Record from mic + status + link to Analyze
  TestSignalGenerator.tsx  # Dropdown (signal type) + duration + Generate button
  AudioPlayer.tsx     # Transport: play/pause, seek, progress; single Web Audio context
  WaveformCanvas.tsx  # Canvas: draws waveform (amplitude vs time)
  SpectrogramCanvas.tsx # Canvas: draws spectrogram from dB magnitude frames

context/
  AudioLabContext.tsx # React context: { audio, setAudio, clearAudio } (samples, sampleRate, durationSeconds)

lib/
  audio.ts            # Decode file/stream → mono float array, resample, normalise
  dsp/
    windows.ts        # Window functions (Hann, Hamming, rectangular)
    fft.ts            # FFT: magnitude, magnitude+phase, build complex, inverse
    stft.ts           # STFT (magnitude only), STFT complex (mag+phase), ISTFT, magnitudeToDb
    denoise.ts        # Noise profile (median), spectral subtraction
    filter.ts         # High-cut (low-pass) filter via STFT
    features.ts       # Log-mel filterbank energy (MFE) extraction and mel filterbank creation
    signals.ts        # Synthetic demo signals: harmonic_sweep, step_pattern, buildTestSignal
```

---

## Features (by area)

| Feature | Where | What it does |
|--------|--------|----------------|
| Upload WAV/MP3 | Home | Decode → mono, 16 kHz, peak normalise → store in context |
| Record from mic | Home | `getUserMedia` + `MediaRecorder` → blob → same decode path |
| Generate test signal | Home | Harmonic sweep / step pattern at 16 kHz → store in context |
| Playback compare | Analyze | One realtime player with optional bypass and loudness match |
| High cut slider | Analyze | Realtime low-pass preview for playback plus STFT-domain processed analysis view |
| Denoising | Analyze | Noise profile from first N s → spectral subtraction → ISTFT |
| STFT controls | Analyze | Change FFT size, hop, window → spectrogram and frame count update |
| Waveform | Analyze | Time-domain amplitude plot |
| Spectrogram | Analyze | STFT magnitude in dB, time vs frequency |
| MFE extraction | Analyze | 32 log-mel filterbank energies per frame + CSV export |

---

## Signal processing: modules and functions

### `lib/audio.ts`

- **`decodeAudioToMono(arrayBuffer, targetSampleRate?)`**  
  Decodes an audio file (WAV, MP3, etc.) in the browser via `AudioContext.decodeAudioData`. Converts to mono (average of channels), resamples to `targetSampleRate` (default 16 kHz) with linear interpolation, and peak-normalises to [-1, 1]. Returns `{ samples, sampleRate, durationSeconds }`. Must run in the browser (uses Web Audio).

- **`resample(input, fromRate, toRate)`** (internal)  
  Linear interpolation resampling.

---

### `lib/dsp/windows.ts`

- **`createWindow(type, size)`**  
  Returns a `Float32Array` of length `size`: **Hann**, **Hamming**, or **rect** (rectangular, all ones). Used to window each frame before the FFT to reduce spectral leakage.

---

### `lib/dsp/fft.ts`

Uses the `fft.js` library (real FFT).

- **`fftMagnitude(realInput)`**  
  Real FFT → magnitude only (positive frequencies). Used for spectrogram.

- **`fftMagnitudeAndPhase(realInput)`**  
  Real FFT → `{ magnitude, phase }` (positive frequencies). Used for denoise/filter (we need phase to reconstruct).

- **`buildComplexFromMagnitudePhase(magnitude, phase, size)`**  
  Builds the full complex spectrum (interleaved real/imag) from magnitude and phase, and fills negative frequencies via conjugate symmetry. Used before inverse FFT.

- **`inverseReal(complexSpectrum, size)`**  
  Inverse FFT of a full complex spectrum → real time-domain signal (extracts real part). Used in ISTFT.

---

### `lib/dsp/stft.ts`

- **`stft(signal, options)`**  
  Short-Time Fourier Transform: windows the signal with given `fftSize`, `hopLength`, `windowType`; for each frame computes FFT magnitude only. Returns an array of `Float32Array` (one per frame), each of length `fftSize/2 + 1`. Used for the spectrogram.

- **`stftComplex(signal, options)`**  
  Same as STFT but keeps magnitude and phase per frame. Returns `{ magnitudes, phases }`. Used for denoising and filtering (modify magnitude, keep phase, then invert).

- **`istft(magnitudes, phases, options)`**  
  Inverse STFT: for each frame builds complex spectrum from magnitude and phase, inverse FFT, applies the same window, overlap-adds into a time-domain signal. Normalises by overlap. Used to get back a playable signal after denoise/filter.

- **`magnitudeToDb(frames, eps?)`**  
  Converts each magnitude frame to dB: `20*log10(max(magnitude, eps))`. Used for spectrogram display (so we see log scale).

---

### `lib/dsp/denoise.ts`

- **`estimateNoiseProfile(magnitudeFrames, noiseFrames)`**  
  Computes a noise spectrum by taking the **median** magnitude per frequency bin over the first `noiseFrames` frames. Assumes those frames are “noise only.”

- **`spectralSubtraction(magnitudeFrames, noiseProfile, alpha?, floorFrac?)`**  
  For each frame and each bin: `newMagnitude = max(magnitude - alpha*noiseProfile, floorFrac*noiseProfile)`. Defaults: `alpha = 1.2`, `floorFrac = 0.01`. Returns modified magnitude frames (phase is kept elsewhere for ISTFT).

---

### `lib/dsp/filter.ts`

- **`highCutFilter(samples, sampleRate, stftOptions, cutFrac)`**  
  Applies a low-pass (high-cut) filter in the frequency domain: runs `stftComplex`, zeros bins above a cutoff frequency, then `istft`. Cutoff mapping is matched with playback so processed visualization and playback stay consistent. `cutFrac` 0 = no change; 1 = very muffled. Output is peak-normalised.

---

### `lib/dsp/features.ts`

- **`extractLogMelFeatures(magnitudeFrames, sampleRate, fftSize, options?)`**  
  Converts STFT magnitude frames into **log-mel filterbank energies (MFE)**. The FFT bins are grouped into mel-spaced triangular bands, energy is summed per band, then converted to dB. Returns `{ dbFrames, centerHz, numBands }` for display or export.

---

### `lib/dsp/signals.ts`

Synthetic test signals (peak-normalised to [-1, 1], fixed sample rate).

- **`generateHarmonicSweep(sampleRate, durationSeconds)`**  
  Fundamental glides upward with harmonics. Produces clear diagonal harmonic bands in the spectrogram.

- **`generateStepPattern(sampleRate, durationSeconds)`**  
  Stepped harmonic notes with short broadband transition bursts. Produces horizontal stacks plus vertical transients.

- **`buildTestSignal(type, options)`**  
  UI dispatcher for `harmonic_sweep` or `step_pattern`.

---

## Context: `AudioLabContext`

- **State:** `audio: { samples, sampleRate, durationSeconds } | null`.
- **Actions:** `setAudio(state)`, `clearAudio()`.
- **Usage:** The home page (upload / record / generate) calls `setAudio`; the analyze page reads `audio` and derives waveform, spectrogram, denoised and filtered signals from it. All processing is client-side; no backend.

---

## Signal processing summary (for the report)

| Concept | Where in the app |
|--------|-------------------|
| **Sampling / resampling** | `lib/audio.ts`: everything is resampled to 16 kHz. |
| **Windowing** | `windows.ts`: Hann, Hamming, rectangular; applied per frame in STFT. |
| **Fourier transform** | `fft.ts`: real FFT for magnitude (and magnitude+phase for reconstruction). |
| **STFT / spectrogram** | `stft.ts`: frame-based FFT, magnitude to dB for display. |
| **Noise estimation** | `denoise.ts`: median over first N frames. |
| **Spectral subtraction** | `denoise.ts`: subtract estimated noise with floor. |
| **Filtering** | `filter.ts`: high-cut (low-pass) by zeroing high bins in STFT domain. |
| **Feature extraction (MFE)** | `features.ts`: compress STFT bins into 32 mel bands and export per-frame log energies. |
| **Synthetic signals** | `signals.ts`: harmonic_sweep and step_pattern (for clear DSP demos). |

---

## Tech stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS**
- **fft.js** for FFT / inverse FFT
- **Web Audio API** for decode and playback; **MediaRecorder** for mic recording
- All DSP runs in the browser (no API routes for audio)

---

## Possible next steps (course / project)

- MFCC on top of the current MFE pipeline → cepstral coefficients + compare against raw MFE
- Metrics: feature stability vs SNR, speech-band energy ratio, runtime
- Optional: small classifier (e.g. speech vs music) using exported feature CSV
