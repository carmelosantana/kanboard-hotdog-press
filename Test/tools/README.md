# Test tools

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
