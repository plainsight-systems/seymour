# Design: Seymour — The Game

**Status:** Implemented, refinement checkpoint
**Owner:** Andy Hunter  
**Product + implementation:** Codex  
**Date:** 2026-10-01

## Feature summary

Seymour — The Game is a desktop-first, NES-inspired serving game for software and infrastructure engineers who are new to inference performance. Plants arrive with workload orders; the player configures the serving rig, feeds each plant or compatible tray, and keeps the dining room moving without blowing three power fuses.

The game is a new interface over Seymour's deterministic analytical model. It must teach real tradeoffs through pressure and consequences rather than memorized quiz answers or fabricated game rules. A complete five-shift campaign should take roughly 15–20 minutes and unlock an endless mode.

## Primary user action

Read a plant's workload, configure the right serving strategy, and feed it before patience or hardware runs out.

## Product decisions

- Live pressure, with generous early patience and an explicit pause control.
- The serving rig keeps its configuration between plants, so players must read each new ticket instead of starting from a solved blank slate.
- A later batch tray groups compatible tickets under one shared configuration. Each ticket remains individually valid; the real advantage is serving several orders during one modeled GPU-occupancy window.
- Three blown power fuses end a shift.
- The game must be playable cold, without completing the Seymour story first.
- Five authored teaching shifts unlock an endless lunch rush.
- Desktop/laptop keyboard and pointer are the first-release targets.
- The route is static and compatible with the existing GitHub Pages build.

## Core loop

1. A plant enters one of three depth lanes and approaches the counter.
2. Its ticket shows requirements such as context size, response-time target, quality tolerance, reusable prefix, and memory demand.
3. The player selects that plant and its ticket drops onto the serving console. The rig retains the previous order's configuration.
4. The player turns only the implementation knobs available in the current shift. The knobs are physical stations behind the serving bar; Seymour walks to the chosen station and turns it.
5. Pressing **Feed order** evaluates the configuration with Seymour's model.
6. The machine visibly processes weights and KV state while compute and memory activity race. The counter remains busy for a gameplay-scaled duration derived from the modeled pass time.
7. A successful plant eats, celebrates, and walks to a table.
8. An incorrect setup produces a specific failure: too slow, out of memory, unnecessary recomputation, or state placed too far away.
9. Expired customers and severe failures blow a fuse. Three blown fuses end the shift.

The clock pauses explicitly, when the browser loses focus, and while essential tutorial explanations are open.

## Orders, rig state, and batching

Every plant owns its workload and requirements; the counter owns the persistent serving-rig configuration. Beginning in Shift 2, compatible tickets can be placed on a **batch tray** before feeding. The player configures that tray once, all tray members share the configuration, and the group shares a model read and GPU-service window. A ticket never fails merely because it was served alone; instead, individual service consumes one window per ticket and makes the rush harder to clear efficiently. Incompatible orders refuse to batch and explain why.

Authored shifts vary context, concurrency, latency, policy, and quality floors. Every non-batch arrival requires a meaningful configuration change. Familiar-looking decoy orders in all applicable shifts deliberately make the previous optimization wrong, teaching the player to read the requirement instead of memorizing a knob position. Endless mode emits batch-capable work only in overlapping groups of three, even though each order can still be served alone.

## Campaign

### Shift 1 — Opening Shift: Feed the machine

One plant at a time. Learn tickets, patience, the serving console, and the difference between generated-token work and prompt work. The memory-bound token order arrives first so changing matrix precision cannot masquerade as useful work.

### Shift 2 — Lunch Rush: Share the read

Multiple plants arrive. Unlock the batch tray and learn why throughput increases when compatible token steps run together.

### Shift 3 — The Long Lunch: Memory fills up

Long-context plants arrive. Unlock KV precision and confront accelerator-memory capacity.

### Shift 4 — The Regulars: Don't repeat yourself

Plants begin ordering shared prompts. Unlock prefix reuse, then encounter a private unique prompt where reuse is explicitly wrong.

### Shift 5 — Closing Time: Put it somewhere

Active and idle sessions compete for space. Unlock placement and learn why active KV cannot live in object storage, why idle KV can be parked in system memory, and when active state should remain on a GPU peer.

Completing Shift 5 unlocks **Endless Lunch Rush**, which combines every archetype and gradually increases arrival pressure.

## Inputs and tickets

A plant ticket may expose:

- prompt/context length;
- requested output length;
- time-per-token or first-token target;
- quality tolerance for lower-bit weights;
- KV capacity pressure;
- a reusable-prefix marker;
- whether state is active or idle;
- batch compatibility.

Player controls are implementation choices, not workload mutations:

- model representation;
- KV representation;
- shared-prefix reuse;
- active or idle KV placement;
- batch-tray grouping;
- Feed order.

## Feedback and scoring

The modeled preview shows actual numeric values without pre-grading the player's answer. Boolean and policy checks remain undisclosed until feed time because “yes · target yes” is itself a verdict. On a first failed feed, feedback names the actual limiting boundary. A repeated miss adds the concrete recovery so the game teaches diagnosis before prescription:

- “The model read missed the patience target. Move fewer weight bytes.”
- “KV pushed 18 GB past accelerator memory. Store each cached token in fewer bits.”
- “Active state is waiting on object storage. Keep it beside the GPU.”
- “This prompt was already available. Reuse it instead of recomputing it.”
- “These orders cannot share a batch because their active step differs.”

Score combines correct service, remaining patience, shared GPU windows, consecutive satisfied plants, and unused fuses. Failed feeds deduct points and cap the available grade. Targets are calibrated so accurate batching is required for an A in the lunch rush. A shift report shows only metrics requested by that shift's order phases, plus one concise teaching takeaway. Campaign completion shows the total score and overall grade.

Progress and high scores remain local in the browser. There is no account, network leaderboard, or backend.

## Interaction model

- Mouse selects plants and operates the physical control board behind the bar.
- Number keys select waiting plants.
- Arrow keys move between controls and values.
- `Space` feeds the selected order.
- `B` toggles the selected order on the batch tray.
- `Esc` pauses.
- All actions remain operable without precise pointer movement.
- Audio begins disabled and can be enabled by the player.

## Visual direction

Translate Seymour's screenprint world into intentional NES-era pixel art rather than a generic pixel RPG:

- warm cream, deep green, mustard, vermilion, and near-black palette;
- a fixed-screen, faux-isometric serving bar with three receding service lanes;
- an original Seymour operator sprite with a green technician cap and white apron who visibly walks between control stations and turns each knob;
- a 6 × 4 Seymour sprite sheet covering idle, ticket reading, walking, knob turning, tray service, celebration, and fuse reaction poses;
- a 6 × 3 plant sheet with one column per species and patient, impatient, and satisfied reaction rows;
- sprite scaling, shadows, foreground occlusion, and parallax for a 2.5D effect;
- distinct plant silhouettes that communicate temperament and workload while tickets remain the authoritative explanation;
- the accelerator behind the counter acts as the kitchen;
- satisfied plants accumulate at tables so success changes the room;
- fuse failures use one strong electrical flash and screen shake, with a reduced-motion alternative.

The memorable image is a huge plant receiving glowing memory blocks while the accelerator kitchen strains behind the counter.

## Layout strategy

The game occupies a framed, wide arcade stage beneath the persistent Seymour navigation. The game world is the dominant surface, using an 8:3 playfield so the active ticket, patience, and implementation knobs remain in the same laptop viewport. A compact in-scene ticket keeps the urgent request visible, and the keyboard strip lives in the status marquee. The implementation controls are semantic DOM styled as physical rotary stations inside the canvas world; the detailed ticket and modeled result remain in the console below. The period influence is fixed-screen service games and NES-era faux-isometric staging, not copied characters, sprites, or assets.

Information hierarchy:

1. waiting plants, patience, and the currently selected order;
2. the Feed order action and power fuses;
3. configuration controls and modeled result preview;
4. score, shift progress, and optional explanations.

Narrow screens receive an intentional desktop-required state rather than a broken compressed game.

## Key states

- Title / first-run: start campaign, continue, endless locked or unlocked, sound setting.
- Shift briefing: one concept, one new mechanic, explicit goal.
- Playing with no selected plant: instruct how to select an order.
- Playing with a selected plant: ticket, available knobs, predicted fit and limit.
- Paused: clock and simulation frozen; resume and restart actions.
- Feeding: short, purposeful machine sequence with controls temporarily disabled.
- Success: plant celebrates and moves to a table; score breakdown is brief.
- Recoverable failure: clear cause, correction, and time penalty.
- Fuse failure: cause, remaining fuses, reduced-motion-safe flash.
- Shift cleared: every order served, actual results, teaching takeaway, next shift.
- Shift survived: the player may advance after losing orders, but a C report explicitly invites a replay for a clean clear.
- Shift failed: score summary and retry.
- Campaign complete: endless mode unlocked.
- Desktop required: explains the first-release input and viewport requirement.

## Technical approach

- New `#/game` route and **The Game** navigation item.
- Static TypeScript/Vite implementation.
- Canvas-rendered game world with an accessible DOM HUD and control console.
- Transparent, palette-limited sprite atlases rendered with nearest-neighbor scaling; procedural silhouettes remain as a load-safe fallback.
- Fixed-timestep deterministic game-state engine.
- Seeded order generation for reproducible endless runs.
- Existing Seymour calculations remain the source of truth.
- A live session that changes placement pays a one-time full-KV transfer cost before its first usable next token; steady-state token time remains visible separately.
- Tangle is deliberately a one-token routing decision: reading live KV from its owning peer wins only because there is no longer response over which to amortize a move into local HBM.
- GPU service windows use monotonic logarithmic time compression so long jobs remain playable without collapsing distinct modeled costs into one hard cap.
- Scoring weights correct service and batching more heavily than remaining patience. A clean 1.08× target earns S; an unhurried no-miss clear can still earn A.
- Authored orders are tested to ensure every shift is solvable.
- Effective matrix precision is never presented independently of model representation: 16-bit weights force and visibly lock 16-bit math.
- Endless generation is exhaustively sampled across 800 deterministic rounds; every order must be individually servable and every generated batch family must arrive as an overlapping trio.
- Pure tests cover timing, pause behavior, scoring, batching, fuses, and progression.
- Repeated steps on one physical knob extend a single turn animation instead of replaying a walk cycle for every detent.
- `localStorage` stores progress, accessibility settings, and local high scores.
- Pixel sound effects are synthesized in-browser after explicit audio enablement.
- No external game framework is required.

## Accessibility and resilience

- Keyboard and pointer parity.
- Visible focus states and semantic form labels.
- Pausing never consumes patience.
- Browser visibility loss pauses automatically.
- Reduced motion disables camera shake and spatial celebrations while preserving state feedback.
- Status messages use a polite live region; fuse failures use an assertive live region.
- Color is never the only success, warning, or failure signal.
- Game progress survives reloads.

## Anti-goals

The game is not:

- a quiz with animated decorations;
- the playground wearing an NES skin;
- a twitch game where reaction time matters more than understanding;
- a framework-specific serving trainer;
- a full GPU scheduler simulation;
- a generic endless runner or pixel RPG.

## Acceptance criteria

1. All five authored shifts are solvable using only modeled controls.
2. Every intentional wrong configuration yields a specific, truthful explanation.
3. Pause and browser visibility freeze all game time.
4. Three fuse losses end the shift; successful service never loses a fuse.
5. Campaign completion unlocks a deterministic endless mode.
6. The game is fully operable by keyboard and pointer at desktop widths.
7. Reduced-motion mode removes screen shake and nonessential spatial motion.
8. The site continues to build as a static GitHub Pages artifact.
9. Story and lookup routes continue to work unchanged.
