# Simple PDF Editor

A simple, open-source PDF editor that runs on **Windows**, **Linux** and in any modern **browser**.
Everything happens locally. Your files never leave your machine.

Built with [pdf.js](https://github.com/mozilla/pdf.js) for rendering and [pdf-lib](https://github.com/Hopding/pdf-lib) for writing, wrapped in [Electron](https://www.electronjs.org/) for the desktop builds.

## Features

**Pages**
- Open, view and zoom (Ctrl + scroll, Ctrl +/−)
- Merge: add more PDFs to the open document, or drop several files at once
- Reorder pages by dragging thumbnails
- Rotate, duplicate, delete, and insert blank pages
- Extract selected pages to a new PDF
- Split every page into its own file

**Editing**
- Add text (sans, serif or mono; any colour and size)
- Freehand drawing
- Highlight, rectangle/box, white-out and black-out
- Insert images (PNG, JPEG, WebP, GIF, …)
- Draw a signature and place it
- Move, resize, restyle and delete anything you add
- Undo / redo

**Forms and output**
- Fill text fields, checkboxes, dropdowns and radio groups
- Set the title and author, add page numbers or a watermark when saving

## Download

Grab the latest build from [Releases](https://github.com/LuckyStrix/simple-pdf-editor/releases):

| Platform | File |
| --- | --- |
| Windows | `Simple.PDF.Editor.Setup.x.y.z.exe` (installer) or `Simple.PDF.Editor.x.y.z.exe` (portable) |
| Linux | `Simple.PDF.Editor-x.y.z.AppImage` (any distro) or `simple-pdf-editor_x.y.z_amd64.deb` (Debian/Ubuntu) |

On Linux, make the AppImage executable first: `chmod +x Simple.PDF.Editor-*.AppImage`.

There is also a web version on GitHub Pages: <https://luckystrix.github.io/simple-pdf-editor/>.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl+O / Ctrl+S | Open / save |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| V, T, D, H, R, W | Select, text, draw, highlight, box, white-out tools |
| Delete | Delete the selected annotation |
| Esc | Back to the select tool |
| Double-click text | Edit it |

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm run dev         # web version with hot reload at http://localhost:5173
npm run app         # build and run the desktop app
npm test            # PDF export tests
npm run dist:win    # Windows installer + portable exe  -> release/
npm run dist:linux  # AppImage + .deb                    -> release/  (run on Linux)
```

Pushing a tag such as `v1.0.1` makes GitHub Actions build Windows and Linux packages and attach them to a release.

### Layout

| Path | What it does |
| --- | --- |
| `src/main.js` | UI: loading, rendering, tools, page operations, history |
| `src/export.js` | Builds the output PDF with pdf-lib (pages, annotations, forms) |
| `src/geometry.js` | Page rotation and size helpers |
| `electron/` | Desktop shell (window, "Open with" support) |

## Limitations

- **Black-out is visual only.** It covers content with a black box, but the text underneath is still in the file. Don't use it to redact sensitive information.
- Existing text in the PDF can't be edited in place. Use white-out and then add new text on top.
- Added text uses the standard PDF fonts, which cover Western European characters only. Other characters become `?`.
- Password-protected PDFs need the password removed before you can open them.
- Filled form fields are flattened when you save, so they're no longer editable.

## License

[MIT](LICENSE)
