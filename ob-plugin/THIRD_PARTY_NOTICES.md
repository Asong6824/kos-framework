# Third-party notices

The kos Obsidian plugin bundles the following direct runtime dependencies into `main.js`:

| Package | Version | License | Provenance and use |
|---|---:|---|---|
| React | 18.3.1 | MIT | Meta; dashboard layout shell and Reader component lifecycle |
| React DOM | 18.3.1 | MIT | Meta; independent dashboard and Reader `ItemView` roots |
| @dnd-kit/core | 6.3.1 | MIT | Clauderic Demers; dashboard pointer sensor, drag lifecycle, overlay and accessibility announcements |
| Framer Motion | 12.42.2 | MIT | Framer; dashboard transform-based layout transitions and reduced-motion handling |
| epub.js | 0.3.93 | BSD-2-Clause | FuturePress; EPUB parsing, CFI navigation, selection, and scrolled/paginated rendition |
| @xmldom/xmldom | 0.8.13 | MIT | Security override for epub.js's XML DOM dependency |
| Doto | v3, 700 | SIL OFL 1.1 | Google Fonts; bundled local display font for the dashboard dot-matrix clock |

dnd-kit and Framer Motion are consumed only as bundled UI libraries: they receive pointer/layout state inside the Obsidian renderer and add no network, filesystem, telemetry, or code-execution surface. Exact resolved versions and integrity hashes are locked in `package-lock.json`; `npm audit` reported zero known vulnerabilities when adopted. Their MIT licenses permit redistribution in the plugin bundle, and no upstream source was copied into this repository. Maintenance conclusion: dnd-kit's stable sensor API is sufficient for the bounded six-card interaction despite its slower release cadence; Framer Motion is pinned to the same `12.42.2` line as `motion-dom` to prevent cross-version export drift. The pure kos layout model remains independent of both packages, so either UI dependency can be replaced without migrating persisted layouts.

The complete resolved dependency graph, exact versions and integrity hashes are recorded in `package-lock.json`. Production transitive packages retain their upstream licenses (MIT, ISC, BSD-2-Clause, Apache-2.0 or Zlib-compatible); no source has been copied from the surveyed Obsidian Reader plugins.

Source and license references:

- React: <https://github.com/facebook/react/tree/v18.3.1>
- dnd-kit: <https://github.com/clauderic/dnd-kit/tree/%40dnd-kit/core%406.3.1>
- Framer Motion: <https://github.com/motiondivision/motion/tree/v12.42.2>
- epub.js: <https://github.com/futurepress/epub.js/tree/v0.3.93>
- xmldom: <https://github.com/xmldom/xmldom/tree/0.8.13>
- Doto: <https://github.com/google/fonts/tree/main/ofl/doto> (`assets/fonts/Doto-OFL.txt`)

PDF rendering is loaded from the Obsidian host through its public `loadPdfJs()` API. PDF.js is not installed or redistributed as a separate plugin dependency.
