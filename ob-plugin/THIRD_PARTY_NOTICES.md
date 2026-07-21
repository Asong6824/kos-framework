# Third-party notices

The kos Obsidian plugin bundles the following direct runtime dependencies into `main.js`:

| Package | Version | License | Provenance and use |
|---|---:|---|---|
| React | 18.3.1 | MIT | Meta; Reader component lifecycle and rendering |
| React DOM | 18.3.1 | MIT | Meta; independent Reader `ItemView` root |
| epub.js | 0.3.93 | BSD-2-Clause | FuturePress; EPUB parsing, CFI navigation, selection, and scrolled/paginated rendition |
| @xmldom/xmldom | 0.8.13 | MIT | Security override for epub.js's XML DOM dependency |

The complete resolved dependency graph, exact versions and integrity hashes are recorded in `package-lock.json`. Production transitive packages retain their upstream licenses (MIT, ISC, BSD-2-Clause, Apache-2.0 or Zlib-compatible); no source has been copied from the surveyed Obsidian Reader plugins.

Source and license references:

- React: <https://github.com/facebook/react/tree/v18.3.1>
- epub.js: <https://github.com/futurepress/epub.js/tree/v0.3.93>
- xmldom: <https://github.com/xmldom/xmldom/tree/0.8.13>

PDF rendering is loaded from the Obsidian host through its public `loadPdfJs()` API. PDF.js is not installed or redistributed as a separate plugin dependency.
