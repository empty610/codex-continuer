# Third-party notices

The Rhine signal animation `public/rhine-signal-loop.svg` is adapted from
[empty610/rhine_ui_clash-verge](https://github.com/empty610/rhine_ui_clash-verge),
commit `a298150dbbd13a217bf48fe574f8fd27bfec2b80`, file
`src/assets/image/rhine-signal-loop.svg`. The repository is licensed under
GPL-3.0-only. The complete license is included in `LICENSE`.

Local modifications simplify interpolated keyframes (at most 0.18 SVG units of
coordinate error at original sample times), consolidate 48 particle animations
into three phase groups, simplify nested glow filters and texture noise, and
remove the square outer frame and out-of-disc particles. The original 60-second
sequence and motion stages are retained.

Modified locally on 2026-10-22 through 2026-10-25. The original files and their
GPL license at the recorded commit are retained in `third_party/rhine/`, with
upstream paths and SHA-256 checksums in `UPSTREAM.json`. The files were exported
directly from the recorded local Git objects; the checkout's remote origin
matches the repository URL above. This verifies the recorded source bytes, not
any separate trademark rights or the upstream author's rights to other assets.

The numeric pixel glyphs in `public/rhine-readout.js` are adapted from the same
repository's `src/components/home/rhine-overview.tsx`, with additional countdown
glyphs. The integrated plugin is distributed under GPL-3.0-only, with its source
files included. This is an independent Codex companion, not an official Rhine
or Clash Verge product.

Public releases must accompany the binary archive with its matching source
archive, including build/install scripts and this notice. No claim is made
about later upstream commits. All unchanged upstream notices remain in the
retained original files. Copyright in original Continuer code belongs to its
contributors; the integrated distribution is GPL-3.0-only.

Electron's bundled license and third-party notices remain in its `dist` directory.
