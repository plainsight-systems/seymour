# Design: Seymour — The Game

**Status:** Confirmed, ready to build  
**Owner:** Andy Hunter  
**Product + implementation:** Codex  
**Date:** 2026-10-01

## Feature summary

Seymour — The Game is a desktop-first, NES-inspired serving game for software and infrastructure engineers who are new to inference performance. Plants arrive with workload orders; the player configures each order, feeds the plant, and keeps the dining room moving without blowing three power fuses.

The game is a new interface over Seymour's deterministic analytical model. It must teach real tradeoffs through pressure and consequences rather than memorized quiz answers or fabricated game rules. A complete five-shift campaign should take roughly 15–20 minutes and unlock an endless mode.

## Primary user action

Read a plant's workload, configure the right serving strategy, and feed it before patience or hardware runs out.

## Product decisions

- Live pressure, with generous early patience and an explicit pause control.
- Every plant is configured individually.
- A later batch tray groups compatible configured tickets for a throughput bonus without turning the beginner experience into a global scheduler.
- Three blown power fuses end a shift.
- The game must be playable cold, without completing the Seymour story first.
- Five authored teaching shifts unlock an endless lunch rush.
- Desktop/laptop keyboard and pointer are the first-release targets.
- The route is static and compatible with the existing GitHub Pages build.

## Core loop

1. A plant enters one of three depth lanes and approaches the counter.
2. Its ticket shows requirements such as context size, response-time target, quality tolerance, reusable prefix, and memory demand.
3. The player selects that individual plant and its ticket drops onto the serving console.
4. The player adjusts only the implementation knobs available in the current shift.
5. Pressing **Feed order** evaluates the configuration with Seymour's model.
6. The machine visibly processes weights and KV state while compute and memory activity race.
7. A successful plant eats, celebrates, and walks to a table.
8. An incorrect setup produces a specific failure: too slow, out of memory, unnecessary recomputation, or state placed too far away.
9. Expired customers and severe failures blow a fuse. Three blown fuses end the shift.

The clock pauses explicitly, when the browser loses focus, and while essential tutorial explanations are open.

## Individual orders and batching

Every plant owns its ticket and proposed configuration. Beginning in Shift 2, compatible tickets can be placed on a **batch tray** before feeding. Grouping them shares a model read and earns a throughput multiplier. Incompatible orders refuse to batch and explain why.

This is intentionally simpler than presenting one global serving configuration while still teaching why compatible token steps are scheduled together.

## Campaign

### Shift 1 — Opening Shift: Feed the machine

One plant at a time. Learn tickets, patience, the serving console, and the difference between prompt work and generated-token work.

### Shift 2 — Lunch Rush: Share the read

Multiple plants arrive. Unlock the batch tray and learn why throughput increases when compatible token steps run together.

### Shift 3 — The Long Lunch: Memory fills up

Long-context plants arrive. Unlock KV precision and confront accelerator-memory capacity.

### Shift 4 — The Regulars: Don't repeat yourself

Plants begin ordering shared prompts. Unlock prefix reuse and distinguish reused prompt work from KV that still must be stored and read.

### Shift 5 — Closing Time: Put it somewhere

Active and idle sessions compete for space. Unlock placement and learn why active KV cannot live in object storage, while parking idle sessions can make sense when restoring is cheaper than recomputing.

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

Every failed feed names the actual boundary and the recovery:

- “The model read missed the patience target. Move fewer weight bytes.”
- “KV pushed 18 GB past accelerator memory. Store each cached token in fewer bits.”
- “Active state is waiting on object storage. Keep it beside the GPU.”
- “This prompt was already available. Reuse it instead of recomputing it.”
- “These orders cannot share a batch because their active step differs.”

Score combines correct service, remaining patience, resource efficiency, successful batching, consecutive satisfied plants, and unused fuses. A shift report shows actual modeled numbers and one concise teaching takeaway.

Progress and high scores remain local in the browser. There is no account, network leaderboard, or backend.

## Interaction model

- Mouse selects plants and operates the console.
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
- side-on serving bar with three faux-depth lanes;
- sprite scaling, shadows, foreground occlusion, and parallax for a 2.5D effect;
- distinct plant silhouettes that communicate temperament and workload while tickets remain the authoritative explanation;
- the accelerator behind the counter acts as the kitchen;
- satisfied plants accumulate at tables so success changes the room;
- fuse failures use one strong electrical flash and screen shake, with a reduced-motion alternative.

The memorable image is a huge plant receiving glowing memory blocks while the accelerator kitchen strains behind the counter.

## Layout strategy

The game occupies a framed, wide arcade stage beneath the persistent Seymour navigation. The game world is the dominant surface, using an 8:3 playfield so the active ticket and implementation knobs begin within the same laptop viewport. A compact status marquee sits above it; an order console sits beneath or beside it according to available width. The console is semantic DOM layered around a canvas world, not text painted into the canvas.

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
- Shift complete: actual results, teaching takeaway, next shift.
- Shift failed: score summary and retry.
- Campaign complete: endless mode unlocked.
- Desktop required: explains the first-release input and viewport requirement.

## Technical approach

- New `#/game` route and **The Game** navigation item.
- Static TypeScript/Vite implementation.
- Canvas-rendered game world with an accessible DOM HUD and control console.
- Fixed-timestep deterministic game-state engine.
- Seeded order generation for reproducible endless runs.
- Existing Seymour calculations remain the source of truth.
- Authored orders are tested to ensure every shift is solvable.
- Pure tests cover timing, pause behavior, scoring, batching, fuses, and progression.
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
