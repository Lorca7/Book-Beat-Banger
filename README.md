# Book Beat Banger

A boutique, book‑themed 4‑track sampling drum machine for macOS (built for **macOS Sonoma 14.6**, runs on Apple Silicon and Intel).

The interface is styled like a private library. The header is an oxblood book spine. The sequencer is a parchment ledger, and each track is a numbered chapter. The sample editor, effects and modulation sections are gold‑tooled leather volumes. Labels are in Petit Formal Script, an 18th‑century‑style formal hand, and figures in Cormorant Garamond; both fonts are bundled, so the app works offline.

![tracks](build/icon.png)

**Kick · Snare · Hi‑Hat · Granular Synth**: each track has a 16‑step sequencer, and you can record your own sound into any of them from the microphone. The recorded sound is trimmed automatically and is ready to play as soon as you stop recording.

## Features

| | |
|---|---|
| **4 tracks** | Kick, Snare and Hi‑Hat are sample players with Level, Pan, Tune, Decay and Start. The fourth track is a full **granular synthesizer** (see below). |
| **16‑step sequencer** | Click or drag to paint steps. Option‑drag ↕ on a step sets its velocity. ‹ › shift the pattern and ✕ clears it. Swing is global. |
| **Granular synthesis** | **Cloud:** Position, Scan (playback speed through the sample, ±2×), Spray (position randomness), Density (1–120 grains/s), Jitter (timing randomness, from regular to cloud‑like), Freeze. **Grain:** Size (5 ms–1 s), Size ± randomness, seven window shapes (Hann, Gauss, Triangle, Plateau, Pluck, Swell, Gate), Skew, Reverse probability. **Pitch:** Pitch, Fine, Scatter (random pitch up to ±24 semitones), quantized to Free, Semitone, Fifths, Octaves, Pentatonic or Minor. **Envelope:** a full ADSR per voice. **Filter:** a per‑voice low‑pass with Cutoff, Resonance and an envelope amount of ±6 octaves. **Output:** Level, Pan, Stereo spread, Amp ± randomness, and a live count of sounding grains. Every control can be modulated by the LFOs and automated. The waveform view draws the live **grain cloud** (each grain as an ink mote, reversed grains in red) over the sample. |
| **Chromatic granular sequencer** | A piano roll (16 steps × 2 octaves, scrollable). Click to add a note and drag right to lengthen it. Drag a note to move it, or drag its right edge to resize. Click a note to delete it. Polyphonic. The keys A–K play it live. |
| **Record your own samples** | Press ● on any track. With **AUTO‑START** on, recording begins when you make a sound (adjustable threshold, with pre‑roll so the attack isn't cut off). Press again to stop: the sample is auto‑trimmed, normalized, assigned to the track and auditioned. |
| **Waveform editor** | Live waveform while recording. Afterwards: drag the start/end triangles to trim, drag the white squares to set fade‑in/out, drag across the waveform to pick a new region, scroll to zoom, click to audition. Normalize, Reverse, Gain, Auto‑Trim, Load file, Factory reset and Save WAV are all there. Every edit is non‑destructive and audible immediately. You can also drop an audio file onto a track or the waveform. |
| **Effects** | Drive, Filter (LP/BP/HP), Tempo‑synced Delay and Reverb, each with its own **dry/wet knob for every track**. |
| **4 LFOs** | Sine, Triangle, Saw, Square, Sample & Hold and Drift shapes. Each is tempo‑synced (8 bars down to 1/32, with triplets) or free‑running in Hz, with a phase offset. **Drag an LFO's ◉ handle onto any knob** to modulate it. Knobs show the modulation range and the live value. Drag a target chip ↔ to set its depth (bipolar), or right‑click a knob for more options. |
| **Automation** | Arm **AUTO** and play: knob moves are recorded into automation lanes that loop over 1, 2, 4 or 8 bars. Pads and keys are also recorded into the pattern, quantized. Automated knobs show an **A** badge. Right‑click a knob to clear its automation, or use CLR to clear everything. |
| **Record & export** | **REC** records the live master output (your performance, tweaks and mutes) to a 24‑bit WAV file. **EXPORT WAV** renders 1–32 bars offline (16/24/32‑bit float, 44.1 or 48 kHz, optional effect tails), including all automation and LFO movement. |
| **Projects** | Save and open `.bbb` project files. Recorded samples are embedded in them. |

### Keyboard

| Key | Action |
|---|---|
| Space | Play / stop |
| 1 · 2 · 3 | Kick / snare / hi‑hat |
| A W S E D F T G Y H U J K | Granular synth, chromatic (Z / X = octave) |
| R | Record into the selected track |
| P | Preview the selected sample |
| Esc | Cancel recording |
| ⌘S · ⌘O · ⌘E · ⌘N | Save · Open · Export WAV · New |

## Install on your Mac

### Option A: download the built app
1. On GitHub, open **Actions → Build macOS app**, pick the latest run, and download the **Book-Beat-Banger-macOS** artifact.
2. Unzip it, open the `.dmg`, and drag **Book Beat Banger** to Applications.
3. The app is ad‑hoc signed, not notarized with an Apple Developer ID. The first time, **right‑click the app → Open → Open**.
   If macOS says the app "is damaged", run this once in Terminal:
   `xattr -dr com.apple.quarantine "/Applications/Book Beat Banger.app"`
4. Allow microphone access when asked. You can change it later in System Settings → Privacy & Security → Microphone.

### Option B: build it yourself
Requires [Node.js](https://nodejs.org) 20 or newer.
```bash
git clone https://github.com/lorca7/book-beat-banger.git
cd book-beat-banger
npm install
npm start          # run it right away
npm run dist       # build dist/Book Beat Banger-1.0.0-universal.dmg
```
Apps you build locally aren't quarantined, so they open without the Gatekeeper prompt.

## Project layout

```
electron/        main process (window, mic permission, native save dialogs, menu) + preload bridge
app/index.html   UI shell (plain HTML/CSS/JS, no build step)
app/js/core.js       utilities, event bus, WAV encoder
app/js/params.js     parameters, tracks, LFO maths, modulation matrix, automation lanes
app/js/sounds.js     factory sounds synthesized at start-up
app/js/sample.js     sample slots (non-destructive edits, auto-trim), audio capture, mic recorder
app/js/engine.js     Web Audio engine: look-ahead scheduler, drum voices, granular grains,
                     per-track FX chain with dry/wet, sample-accurate modulation, offline render
app/js/ui-*.js       knob, step sequencer / piano roll, granular panel, sample editor, LFO panel
app/fonts/           bundled OFL fonts
scripts/smoke-test.js  headless end-to-end test (Playwright)
```

The same engine runs for live playback and for offline WAV export, so an export sounds the same as what you hear when playing back.

## Fonts

Petit Formal Script and Cormorant Garamond are bundled in `app/fonts` under the SIL Open Font License 1.1 (licence texts are alongside).

## Tests

```bash
npm install --no-save playwright && npx playwright install chromium
npm test
```
The smoke test drives the real UI in Chromium. It covers playback, LFO drag and drop, automation recording, piano roll, step painting, recording from a fake microphone, sample editing, every grain window, reversed and randomized grains, pitch quantization, the voice filter and envelope, offline export, live REC and a project save/load round‑trip.
