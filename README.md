# Hot Dog Press

A single-sheet zine maker inside Kanboard. Lay out eight pages by hand or in Mustard markdown, save the zine
with its project, and print one sheet on A4 or US Letter that folds into an eight-page booklet with a single cut.

## Install

Unzip the release into `plugins/HotDogPress` of your Kanboard install (the folder must be named exactly
`HotDogPress`).

- Kanboard >= 1.2.47
- PHP >= 8.4

## Use

Open a project's **Zines** page, make a zine, and edit it by hand or in Mustard. The editor saves as you go: two
seconds after your last change, and once more when you leave the page. A reload keeps unsaved edits. If someone
else saved the same zine meanwhile, you choose: **Reload** to see their copy, or **Keep mine** to save over it.

**Export** makes every file in your browser:

- **Export PDF**: one landscape sheet, 300 dpi, with fold and cut guides (or without) and in black and white if you
  like. Print it at **Actual size (100%)**, on the paper you chose, one side. **Save PDF to project files** keeps a
  copy with the project (members only).
- **Social**: a carousel ZIP (3:4, or 4:5), a cover, a pin, a story, a picture of the sheet, a Bluesky set of four
  and a LinkedIn PDF. On a phone the share sheet offers them to your apps. Nothing is ever posted for you.

## Files and privacy

- Photos you add to a zine are stored as **project files**. They stay in the project's files when the zine is
  deleted; remove them there if you no longer want them. Saved PDFs are project files too.
- The plugin makes no request to any other site: fonts, stickers and scripts ship in the plugin, and there are no
  analytics. A test scans the plugin for outside addresses.
