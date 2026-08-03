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
| Self-hosted LiveSync | 0.25.83 (`977d5056…`) | MIT | Pinned source fork; Journal replication, local database, chunking, checkpoints and conflict primitives |
| livesync-commonlib | `bbf2539d…` | MIT | Pinned submodule source used by the selected LiveSync browser graph |
| AWS SDK for JavaScript v3 / Smithy | 3.1097.0 / 5.6.12 | Apache-2.0 | Cloudflare R2 SigV4 client and mobile-compatible HTTP boundary |
| PouchDB | 9.0.0 | Apache-2.0 | Persistent IndexedDB document/chunk database |
| fflate | 0.8.2 | MIT | LiveSync Journal compression |
| octagonal-wheels | 0.1.51 | MIT | LiveSync common utilities |
| diff-match-patch | 1.0.5 | Apache-2.0 | Adopted LiveSync conflict primitives |
| idb | 8.0.3 | ISC | Browser IndexedDB helper used by the adopted graph |
| minimatch | 10.2.5 | BlueOak-1.0.0 | Adopted LiveSync path matching |
| transform-pouch | 2.0.0 | Apache-2.0 | Adopted PouchDB transformation layer |

dnd-kit and Framer Motion are consumed only as bundled UI libraries: they receive pointer/layout state inside the Obsidian renderer and add no network, filesystem, telemetry, or code-execution surface. Exact resolved versions and integrity hashes are locked in `package-lock.json`; `npm audit` reported zero known vulnerabilities when adopted. Their MIT licenses permit redistribution in the plugin bundle, and no upstream source was copied into this repository. Maintenance conclusion: dnd-kit's stable sensor API is sufficient for the bounded six-card interaction despite its slower release cadence; Framer Motion is pinned to the same `12.42.2` line as `motion-dom` to prevent cross-version export drift. The pure kos layout model remains independent of both packages, so either UI dependency can be replaced without migrating persisted layouts.

The complete resolved dependency graph, exact versions and integrity hashes are recorded in `package-lock.json`. Production transitive packages retain their upstream licenses (MIT, ISC, BSD-2-Clause, Apache-2.0 or Zlib-compatible); no source has been copied from the surveyed Obsidian Reader plugins.

Source and license references:

- React: <https://github.com/facebook/react/tree/v18.3.1>
- dnd-kit: <https://github.com/clauderic/dnd-kit/tree/%40dnd-kit/core%406.3.1>
- Framer Motion: <https://github.com/motiondivision/motion/tree/v12.42.2>
- epub.js: <https://github.com/futurepress/epub.js/tree/v0.3.93>
- xmldom: <https://github.com/xmldom/xmldom/tree/0.8.13>
- Doto: <https://github.com/google/fonts/tree/main/ofl/doto> (`assets/fonts/Doto-OFL.txt`)
- Self-hosted LiveSync: <https://github.com/vrtmrz/obsidian-livesync/tree/0.25.83>
- livesync-commonlib: <https://github.com/vrtmrz/livesync-commonlib/tree/bbf2539d00af4846e3e1640e72460fb7ed930ca5>

The release includes the pinned LiveSync and livesync-commonlib MIT texts plus
the Apache-2.0 license used by AWS SDK/Smithy, PouchDB, diff-match-patch and
transform-pouch under `THIRD_PARTY_LICENSES/`.

PDF rendering is loaded from the Obsidian host through its public `loadPdfJs()` API. PDF.js is not installed or redistributed as a separate plugin dependency.
