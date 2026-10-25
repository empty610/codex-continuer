# Animation audit — 2026-10-22

The widget retains its SVG renderer. It does not add frame-image caches, canvas
buffers, forced compositor layers, or new renderer processes.

Changes:

- Reduce animation source from 132,813 to 68,202 bytes. Remove redundant motion
  samples with a coordinate error bound of 0.18 SVG units and opacity error below
  0.008 at all original samples. At 160 px this is roughly 0.1 screen pixel.
- Consolidate 48 independently animated dust particles into three phase groups;
  simplify nested glow filters, full-center blur, and texture noise.
- Skip unchanged desktop state messages and redundant always-on-top calls.
  Defer hidden panel rendering until expansion and skip hidden gauge updates.
- Share one native menu between right-click and the tray. Remove the native
  thick frame, opaque default canvas, SVG square frame, and square focus outline.

Validation used a single Electron 45 window, 160×160 DIP, an offscreen target of
60 Hz, the same quota fixture, and four 3.5-second samples covering wave, launch,
planet, and scan phases. Main and renderer garbage collection was requested for
memory snapshots to exclude discarded test paint images. This is a local
comparison, not a guarantee of frame rate under every desktop load.

| Metric | Before | After |
| --- | ---: | ---: |
| Mean requestAnimationFrame rate | 59.1 fps | 59.9 fps |
| Frames longer than 25 ms | 10 | 2 |
| Sum of renderer task time across samples | 7,786 ms | 3,135 ms |
| Sum of style recalculation time | 1,437 ms | 515 ms |
| Total private memory at final snapshot | 182.3 MiB | 182.5 MiB |
| Renderer private memory at final snapshot | 65.0 MiB | 62.9 MiB |

Total memory was effectively flat (about 0.1% difference, within run-to-run
variation), rather than an exact byte-for-byte invariant. Earlier alternating
runs also showed variable GPU/working-set snapshots; no fixed memory reduction
is claimed. CPU and frame-time results vary with machine load.

Native integration checks cover all six menu commands being present, transparent
corner pixels, no square CSS outline, stationary hold, jitter, movement delta,
drag-release suppression, and ordinary click expansion. Existing automated
regression tests also pass.

## Window dragging follow-up

Dragging uses a separate main-process loop from the SVG animation. The former
16 ms interval was reaching approximately 31 ms between native position updates
on this Windows host. Sampling now uses 4–8 ms based on the starting monitor's
refresh rate, with one existing timer that is stopped at release/cancellation.
The last requested position replaces per-sample OS bounds queries, so DPI-rounded
readback cannot cause repeat moves. Tracker callbacks update the anchor but skip
window/state/diagnostic work during a drag; positions are persisted at release.

A 4-second synthetic cursor trajectory against the same hidden native Electron
window on the 60 Hz display produced:

| Drag metric | Before | After |
| --- | ---: | ---: |
| Native position updates per second | 31.25 | 52.25 |
| Median interval between updates | 31.2 ms | 16.1 ms |
| 95th percentile interval | 35.4 ms | 31.1 ms |
| Native bounds reads | 126 | 1 |

These are window-position call timings, not presented-frame measurements. No new
render surfaces, frame queues, or processes are used. All 43 regression tests and
the native click/hold/drag/menu checks pass after this follow-up.

## Release position and faster sampling

Further native testing reproduced size growth in `BrowserWindow.setPosition` on
this fractional-DPI Windows host: a 160×160 DIP window reached approximately
302×304 DIP after 138 position updates. The next tracker pass restored the
configured compact size, producing the visible relocation on release.

Dragging now calls `setBounds` with the original width and height on every move.
Pointer release only stops sampling and saves the displayed position; it never
samples the later cursor position. Unchanged tracker passes preserve an explicit
manual drop, including one partly outside the work area. Mode, size, follow-target
changes, display changes, and explicit position reset can still recompute layout.

The active drag timer now requests 1 ms rather than 4–8 ms intervals. A local
2.5-second native-window comparison measured approximately 55.2 position updates
per second before and 64.8 after, with the 95th percentile interval falling from
31.8 to 16.7 ms. This remains a position-call measurement, not a display FPS claim.
The fixed-size path ended at 161×161 DIP, within the existing one-DIP readback
tolerance, rather than accumulating size on each move.

All 46 regression tests pass. A native integration test also made repeated moves,
dropped the window at x=-40, changed the cursor before release handling, and then
waited 1.8 seconds across tracker cycles: both position and dimensions stayed
unchanged. Click expansion, right-click menu, and transparent corners still pass.

## Expand/collapse position restoration

The manual-drop guard was retaining a compact-mode context across an expansion.
On collapse it could skip layout while the native window still had panel-sized
bounds. A subsequent drag could then save those bounds into the compact slot.

Every mode switch now invalidates that guard, cancels an outstanding transition,
and records the departing mode only when its layout is stable. Both the panel and
compact card keep independent positions. Restoring a saved mode also preserves a
deliberately parked edge position if its display remains available.

All 50 regression tests pass, including executing the production layout code with
a controlled animation clock. A hidden native Electron check expanded from
(730,310,161,161), observed intermediate animation geometry, moved the panel, and
collapsed back to exactly (730,310,161,161). Five rapid reverse toggles also ended
at that same position and size with no outstanding transition.

## Fixed-size mode fades

Continuous native resizing was still forcing layout, raster, and transparent
window surface changes on each timer tick. Desktop transitions now fade the
outgoing view for 120 ms, change native bounds once, and fade the incoming view
for 160 ms. The renderer acknowledges opacity at or below 0.001 before the native
change. A guarded 240 ms fallback completes transitions for hidden/reloading
renderers. Old acknowledgements cannot commit a cancelled transition.

The outgoing mode remains displayed until the geometry change; there are no new
frame images, snapshot caches, or extra windows. Reduced motion acknowledges the
switch immediately. Hidden windows switch directly.

In an identical, prewarmed, 60 Hz offscreen render harness, six alternating
expand/collapse samples produced mean requestAnimationFrame rates of 37.2 fps
before and 52.2 fps after. Native geometry calls per transition fell from 11–14
to exactly one; frames longer than 25 ms fell from 33 to 17. All observed fade
acknowledgements were at opacity 0–0.00041. These are local render-harness
measurements with variable host load, not a guarantee of presented desktop FPS.

All 52 tests pass. Native integration also confirms that collapse and repeated
rapid reversals still return to the original compact position and size, and that
the detailed panel retains its separate position.
