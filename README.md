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
