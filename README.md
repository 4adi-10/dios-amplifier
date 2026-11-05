# DIOS Amplifier

Mic booster for Discord: up to **100,000x (+100 dB)** and still clear.

## Web app (`index.html`)

Open the site, press **Start**, allow the mic, pick a preset.

- **Loud and clear engine** (default): rumble cut, voice compressor, makeup gain, brick-wall limiter. Tested at 100,000x: 0% clipped samples, peaks held at -0.5 dBFS.
- **Presets**: Clean, Loud and clear, Max clear, Bass boost, Radio, Distorted.
- **Noise gate**: quiet sounds under the threshold (fans, keyboard) are muted before the boost.
- **3-band EQ**: bass, presence, treble.
- **Browser noise suppression** toggle.
- **Live mic and output switching**, monitor (hear yourself).
- **Hotkeys** (while the tab is focused): `M` mute, hold `Space` push-to-talk, `R` record a 5 second test.
- **Test recorder**: hear exactly what Discord gets.
- Live spectrum and waveform, peak meter with peak hold and clip counter. Settings are saved.

**Discord desktop app:** install [VB-Cable](https://vb-audio.com/Cable/), set Output to "CABLE Input", then in Discord set Input Device to "CABLE Output" and turn off automatic gain control.

## Chrome extension (`extension/`)

Boosts your mic inside Discord in the browser, same engine and EQ. Load it from `chrome://extensions` with Developer mode on, using "Load unpacked". Reload Discord and rejoin voice.

Use headphones to avoid feedback.
