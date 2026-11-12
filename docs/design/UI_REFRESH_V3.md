# CameraAI — light workspace and interactive AI scenarios

Branch locked to `feat/3d-camera-showcase`.

Reference direction: white panels, lavender workspace, vivid purple actions, restrained pale blue/green/orange. Inter provides a compact readable typeface with Vietnamese coverage and a Helvetica Neue fallback. Font files and OFL license are local.

Antigravity generated the top-header and metric-card CSS, plus advice for persistent navigation selection. Codex reviewed and integrated these contributions and implements the surrounding layout, active border, semantic icon colors, model detailing and interactive scenes. Antigravity works generation-only with source excerpts; no branch changes or unreviewed file edits.

The active page retains a thin purple border and pale fill while the shared hover pill moves. AI icons use strong semantic colors. Main workspace is light; the local 3D stage stays dark to keep white hardware, scan volumes and blue chip borders readable.

Four user-triggered simulations: fire with scan volume/flame, a fall with a person and detection bounds, face recognition with scan corners and a sweep, and a monitored polygon with a person entering it. Hardware pivots toward each scene. These are labeled simulations and do not create events, notify Telegram, or change surveillance data. Real emergency attention remains a separate existing workflow.

Hardware enhancements include micro fasteners, underside vents, optical ticks, PCB standoffs, miniature components, rear connector details and a smaller AI processor with cyan edge lighting. Static opaque details remain batched per independently moving assembly.

Validation completed on 2026-11-12:

- 42 web test files / 223 tests passed, including the login pre-hydration regression.
- Production Docker image built successfully with Node 22, type checking and lint (0 errors; existing complexity/length warnings remain). Local font files are copied into the production runtime.
- Browser review passed 17 desktop/mobile layouts at 1440, 768, 375 and 320 px, actual mesh click, explode/reassemble, zoom/reset, the shared sliding indicator, persistent active border and readable text, four distinct simulations, reduced motion and WebGL fallback. The suite checks that demonstrations emit no API mutation requests.
- Real backend smoke passed at localhost:3000: login, exploded camera, fire simulation and camera management, with no JavaScript or API errors. Historical snapshot failures use the existing image fallback.
- Corrected pale status labels, the fire event row and placeholder icons for the light palette. A disabled server-rendered login submit button and POST fallback prevent native GET submission while JavaScript is still loading.

Screenshots and the browser report are under `artifacts/ui-refresh-v3/`; run `node tools/scripts/ui-browser-review.mjs http://localhost:3000` against the local web server to repeat the isolated fixture review. The script uses the existing optional Playwright installation under `artifacts/m3/browser-qa` and Chrome. Backend smoke uses a separate browser session without fixtures.

Only the web service was recreated. The temporary production review container and host preview were stopped after verification. Branch remains `feat/3d-camera-showcase`.
