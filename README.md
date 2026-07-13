# Boggle Solver with NWL2023

This is a local, static Boggle solver modeled after the dark Word Smuggler-style UI in the reference screenshot.

It uses `data/nwl2023.txt`, a one-entry-per-line NWL2023 word/definition file fetched from:

https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words/North-American/NWL2023.txt

NASPA lists NWL2023 as the current competitive United States/Canada Scrabble lexicon, effective February 29, 2024:

https://scrabbleplayers.org/w/NWL2023

NASPA also notes that official electronic word-list access is licensed/member-gated. The bundled file is a public mirror with definitions and no visible license file in its source repository; replace it with a properly licensed copy before publishing commercially or broadly distributing the app.

## Run

```sh
npm start
```

Then open:

```text
http://localhost:5173
```

## Test

```sh
npm test
```

## Camera OCR

The `scan board` button opens the device camera on HTTPS-capable browsers, captures the centered square guide area, and detects individual die faces before using a photo-trained glyph fingerprint matcher. The matcher combines red-ink threshold variants, silhouette overlap, row/column shape profiles, enclosed-region topology, and 0/90/180/270-degree rotation checks. Uncertain tiles alone fall back to Tesseract.js, loaded from jsDelivr and run client-side.

While a scan runs, the app prints the active extraction and OCR stages below the status line so it is clear whether the photo fingerprint matcher or Tesseract fallback is in use.

The compact badge beside the NWL2023 label at the top shows the loaded OCR build. Use its `update` button to clear same-origin browser caches and reload through a fresh URL when checking for a newer local version. The live scan-method console is visible only while OCR is running and clears when the scan finishes. The bundled local server also sends no-store headers for app code. If an older page is already stuck in browser cache, open `/latest-ocr22.html` once.

Camera OCR is best-effort. Good lighting, a square-on board photo, and reviewing the filled letters before solving will matter.
