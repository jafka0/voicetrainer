# Alto

A private, browser-based practice tool for feminine voice training, with adjustable pitch goals. It gives feedback on pitch, melody and resonance, with practice sentences in English and German.

All analysis runs on your device. Recordings stay in memory only for instant replay and are deleted when you move on. Only settings and measurements are saved, in that browser's local storage.

## Running it

It needs no build step or dependencies. Browsers only allow microphone access on `https://` or `localhost`.

- **Online:** serve this folder from any static host, such as GitHub Pages.
- **Locally:** run `npx serve` here and open `alto.html` at the address it prints.
- **On a phone:** open the online address, then use "Add to Home Screen".

## What it measures

| Measure | Method | Reliability |
|---|---|---|
| Pitch and melody | YIN pitch tracking | High |
| Resonance (F2, F3) | LPC formant estimates | Moderate; best for tracking your own change |
| F1 | LPC | Stored only. Too unreliable at these pitches to use |

Known limits:

- Resonance accuracy has been tested on synthetic voices, not on a range of real ones.
- Around 220 Hz and above, widely spaced harmonics can hide a real resonance change, so a "no change" reading can be wrong.
- A very dark "ah" can be misread, especially around 200 Hz, so "ee" is the more dependable vowel.
- Loud background noise can create false resonance changes, so practice somewhere quiet.
- Readings shift with the microphone and its distance, so keep both consistent.
- Tip thresholds in `js/analysis.js` and `js/resonance.js` are practical heuristics, not clinical cut-offs.
- There is deliberately no overall femininity score, because these measurements can't predict how a listener will hear a voice.
- Reference vowel averages are from Hillenbrand et al. (1995), American English.

This tool doesn't replace a speech-language pathologist. Stop if anything hurts, and get advice if pain or hoarseness keeps coming back.

## Tests

Requires Node 20 or later:

```
npm test
```

## Layout

- `js/pitch.js`, `js/formants.js`: signal analysis
- `js/analysis.js`, `js/resonance.js`: measurements and coaching tips
- `js/plan.js`, `js/content.js`: sessions, exercises and sentences
- `js/audio.js`, `js/capture-worklet.js`: microphone and playback
- `js/app.js`, `js/chart.js`, `js/ui.js`: interface (gauge, voiceprints, calendar, milestones)
- `js/spectrum.js`: voiceprints, stored as 32 coarse band levels, never audio
- `fonts/`: Geist and Geist Mono by Vercel, under the SIL Open Font License (`fonts/LICENSE.txt`)
- `sw.js`: offline support for the app's code
