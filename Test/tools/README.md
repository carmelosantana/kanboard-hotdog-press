# Test tools

## Versioned imports

`node Test/tools/version-imports.mjs` puts `?v=<plugin.json version>` on every relative import in `Assets/js`. Run it
after bumping the version (plugin.json, `Plugin::VERSION`): an upgrade then changes every module URL, so no browser
mixes new modules with week-old cached ones. `Test/js/versioned-imports.test.mjs` fails until it has run.

## Print probe

`node Test/tools/print-probe.mjs [out-dir]` writes `print-probe-letter.pdf` and `print-probe-a4.pdf`
(default: a new temp dir; the paths are printed). Print at 100% / "actual size", then photocopy the print.

Each sheet carries the real cut/fold guides, page ticks and the 10 mm check square (measure it: 10 mm means
no scaling). Every one of the 8 panels repeats the same probe in its reading orientation (the top row is upside
down, as on a real zine), so you can compare the sheet's edges with its centre. The probe starts at the panel's
reading top (the centre line), counted **left to right**:

| Row (top to bottom) | Mark | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Vertical lines, stroke width (mm) | 0.1 | 0.15 | 0.2 | 0.3 | 0.5 | 0.75 | 1.0 | |
| 2 | Solid blocks on one baseline, height = cap height of (pt) | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14 |
| 3 | 50% gray patch, then a hatch of 0.25 mm lines with 0.25 mm gaps | | | | | | | | |

Cap height is taken as 0.7 of the font size. Read off the first line and the first block that still print solid
and unbroken after the photocopy ("the 3rd line" = 0.2 mm, "the 2nd block" = 6 pt): those set the layouts'
minimum stroke and font size. The gray patch shows whether the copier keeps midtones or blows them to black or
white; a hatch that turns into a flat gray or moiré means fine texture will not survive copying.

## Plant Medicine sample (dev stack only)

`node Test/tools/seed-plant-medicine.mjs` seeds the **Plant Medicine (sample)** project (identifier `PMSAMPLE`) on the
:8081 dev stack over JSON-RPC: eight tasks carrying the page plan of `hotdogpress-plant-medicine.md`, and a
`zine-viewer` user with the project viewer role (dev-only password `zine-viewer-dev-only`, or `ZINE_VIEWER_PASSWORD`
when the user is first created). It refuses any URL that isn't localhost. Re-runnable: it adds only what is missing,
and a run that finds everything in place prints `already seeded: nothing changed`. Env: `KB_URL`, `KB_USER`,
`KB_PASSWORD` (default `http://localhost:8081`, `admin`, `admin`).

`node HotDogPress/Test/e2e/sample.e2e.mjs [out-dir]` (from the harness root) runs the seed, then makes the two sample
zines in that project through the editor (zine A from `Test/fixtures/mustard/plant-medicine.mustard.md` via
Write in Mustard; zine B by hand), checks reload, the two-tab prompt and the viewer, and writes the print and social
exports, page-1 PNG previews (`pdftoppm`) and a `manifest.json` of measured sizes to `out-dir`
(default `reports/hotdogpress-p1/` in the harness). Each run replaces the sample project's zines.
