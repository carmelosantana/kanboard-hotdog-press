# Changelog

## Unreleased

- **Ink saver** for the print PDF: white paper with no page backgrounds and dark ink, even from a dark look, for
  printers without an ink-saving setting. Photos, shapes, stickers and ink keep their colours.
## 0.1.1 — 2026-11-25

### Security
- An image asset's `file_id` must be a positive integer and never sits beside `data`; the editor URL-encodes it and fetches only valid ids, so a saved zine can no longer steer viewers' browsers to other routes.
- A zine holds at most 500 assets, and the editor loads only the assets its pages use.
- The editor fetches and decodes each image source once, however many asset ids name it, so a zine cannot make viewers repeat one credentialed fetch hundreds of times.
- Importing a `.hotdog` file refuses more than 500 assets (or a non-object `assets`) before decoding, sniffing or keeping any inline image, so a file of thousands of tiny images cannot burn CPU and memory first.

## 0.1.0 — 2026-11-24

- Zines in a project: a **Zines** page (from the project menu) to make, rename, remove, download and import zines,
  and **My zines** on the dashboard. Viewers open and export; members make and edit; managers remove.
- The editor: eight pages by hand (text typed in place, photos, shapes, stickers, ink), move, resize, rotate, lock,
  undo and redo; nine page layouts and three looks; Pages, Sheet and Booklet views; phone-width friendly.
- **Write in Mustard**: the zine as markdown with front matter, applied in the browser (hand-made and locked items
  stay); warnings and errors by line. **Import Mustard file** and **Download Mustard** carry `.mustard.md` files.
- Autosave two seconds after the last change, a tab buffer that survives a reload, a beacon when the tab closes, and
  a choice when someone else saved meanwhile (**Reload** or **Keep mine**). Errors a retry cannot fix (an ended
  session, a zine too large or not valid) stop saving and keep the edits in the tab.
- `.hotdog` files: a portable zine with its photos inlined, downloaded and imported (up to 16 MB).
- Exports made in the browser: the 300 dpi print PDF on Letter or A4 with fold and cut guides, in colour or black
  and white, saved to the project files if you like; social files (carousel ZIP at 3:4 or 4:5, cover, pin, story,
  sheet picture, Bluesky set of four, LinkedIn PDF) with the share sheet on phones.
- Spanish (es_ES) translation of the pages and the editor.
- Private by design: fonts, stickers and scripts ship in the plugin; nothing is requested from another site.
