# Gameplay simulation, traps, doors, quests & anti-cheat (current state)

System-level overview of the jungle gameplay mechanics. Read the root
`AGENTS.md` first. Implementation detail per workspace lives in
`apps/web/AGENTS.md`, `apps/server/AGENTS.md`, and `packages/shared/AGENTS.md`;
one-file-per-bug root causes live in `discoveries/`.

---

## Gameplay simulation & anti-cheat (current state)

The player simulation is **client-side**: the client runs the collision and
run/jump physics every frame with `packages/shared/src/physics/` (tile
collision: 57 solid, 65 folds into 57, 110/109/262/287/288/289/290 slopes,
464 dead-zone pits, 315 interaction tiles) and renders its own prediction
with no server round-trip. Slope contacts: 110/109 landings rest on the flat
top lip
(never hoist an under-runner walking below a chamfer); 262 climbing rides the
ramp's surface at the box's leading edge; 287 is the half-height 2:1 ramp
(16px run, 8px rise — solid below the bottom-left-corner→right-edge-
midpoint line, base flush with the tile's bottom edge, so a walker steps
straight onto it from the floor; a solid back column under the apex;
underside is a flat ceiling); 290 is that ramp flipped left-right (solid
below the bottom-right-corner→left-edge-midpoint line, 2·dy − dx ≥ 16 —
the flush foot is now the bottom-RIGHT corner, so a walker steps onto it
by walking LEFT, and the solid back column sits under the apex on the
left); 288 is the staircase tile — the mirror of 287
(2px treads stepping down from the top-right to the bottom-left) with a
full-height right wall, a left wall from mid-height down, and a solid base
row, hollow between the treads and the base (a pixel mask, not an analytic
wedge), so a 287 + 288 pair forms one continuous ramp to the top of 288 —
its seam binds the walker at 287's apex (dy 8) onto 288's left tread (dy 7)
through a 1px-deep support allowance; see collision/masks.ts's `STAIRS_MASK`) —
and 289 is 288 flipped left-right (the mirror staircase: treads stepping
down from the top-LEFT to the bottom-right, a full-height LEFT wall and a
right wall from mid-height down — see `STAIRS_MIRROR_MASK` — so a 289 left
of a 290 continues that shallow mirror ramp down, and the landing/support
surface binds at the box's leftmost column, the mirror of 288's rightmost) —
documented in
`discoveries/jungle-slope-climb-buries-player-kicks-teleport.md` and
`discoveries/shallow-ramp-tile-287-half-height-diagonal.md`. 464 is the
dead-zone pit (a pixel-mask OPEN basin — a 3px solid base at the cell's
bottom, nothing else, so a player walks off the mouth and sinks to the
floor; adjacent 464s merge into one continuous trench and a body inside is
blocked laterally only by the solid walls beside the run, so falling in is a
trap — a one-way door: reaching the basin floor kills the player, who
**cannot leave the pit unless it answers a death question correctly**. The
web client probes its own simulated position against the pits every frame
(`isBoxInDeadZone` on the shared grid — the AABB must overlap the pit cell
with its bottom at/within 1px above the basin-floor base, so a player
standing on it, or falling into it, touches, while a player on the ground
beside a pit, or flying high over the mouth, never touches) and, on touch,
**kills the player** — the scene hands the kill to `onDead`
(`apps/web/src/game/death.ts`, dispatched per `DeathCause`; the update loop
only calls it once per death via the `dead` guard), which freezes the body
where it fell (`state.dead` gates movement input + the E/R keys, like the
quest modal, and gates the pit probe so the kill doesn't re-fire) and asks
the room for a death question (`PLAYER_DEATH_MESSAGE`; the room sends a
random question with `kind: "death"` on the same `quest:question` channel,
unlike a showquest press it never touches the completion gate — grading
stays server-side with the key in the player's pending slot). The quest box
then runs the retry loop: a **wrong** answer holds "Wrong" on screen for 3
seconds (movement stays frozen — the modal is still up; death questions
carry no tile, so no question tablet animates) before the box closes and
the update loop's self-heal re-requests a fresh
death question
(throttled to 1/s), **repeating until a correct answer**, which sends
`quest:result {correct:true}` and revives through the exact
`PLAYER_CHECKPOINT_MESSAGE` flow the debug R key uses (teleport locally,
freeze reconciliation until the server confirms, and let the room
re-baseline at the spawn so the jump isn't a teleport violation — reports
sent from the pit before the revive are ordered before the checkpoint
message on the wire, so the re-baselined server never sees them as a
teleport). The death-behavior switch in `onDead` and the death-mode branch
in the quest box (`quest-box.ts`, `kind === "death"`) are the extension
points for future death behaviors and causes. If the WebSocket blips while a
checkpoint return is in flight (a correct death answer just sent
`player:checkpoint`), the update loop re-sends it once on the first frame
back (`state.connectionWasDown`, see update.ts) — otherwise the server
stays baselined at the pit and the first post-reconnect report reads as a
teleport violation. The
Colyseus room no longer probes or logs the pits, and the web
debug overlay draws the pit outline RED (`hazard` collision segments). 315
is the first **interaction tile** (a signpost in the map at tile (17, 11),
stood on from the floor below): interaction gids are NOT collision geometry
– `buildTileGrid` folds them to 0 (never into a `TileKind`, or the
penetration fallthrough would turn the new kind into a slope wedge) and
they live in a separate `InteractionGrid` (`buildInteractionGrid`, built
from the same `layer1`) that only the E-key feet probe reads. Standing on
one and pressing E (edge-triggered, grounded only) sends
`PLAYER_INTERACTION_MESSAGE` with the gid the client's feet probe found;
the room does NOT trust that gid alone — it re-probes its OWN last accepted
position with the same shared rule (`probeInteractionTile`, which also
walks up the cell above the feet when they sit at/within 2px of a cell
boundary, because the signpost's base is flush with the standing floor's
top, i.e. in the cell above the feet — and returns the tile's OWN cell,
the identity the completion gate keys on) and only runs the action when the
gids agree AND the accepted report is grounded, so a forged or stale press
is a no-op. Actions resolve from the shared `INTERACTION_TILE_ACTIONS`
registry (315 → `"showquest"`): `runInteraction` in
`apps/server/src/rooms/jungle/interactions.ts` sends the player a random
question from `Assets/question.json` with its choices **shuffled and
unlabeled** — see the quest bullet below.
**Movable traps**: the map's `trap` objectgroup (a container shared by
future trap types) holds one rectangle per instance, named
`Trap_Spike_Run` (the same name as the sprite sheet; the object's own
Tiled id distinguishes the instances), with
`speedMin`/`speedMax`/`time2change_speed` custom props —
`buildTrapSpikeRuns` in
`packages/shared/src/physics/trap-spike-run.ts` recognizes them by exact
name (the
numeric props
are coerced because Tiled may type them as strings, e.g. `speedMax:
"100"; misconfigured objects are skipped) into `TrapSpikeRunEntity`s
whose rect is the
patrol area. The web client renders each trap as a sprite from the
`Assets/trap/Trap_Spike_Run.png` sheet (a 32×48 image — a 2×3 grid of
16×16 cells, one frame per cell, row-major like the jump sheet; frames
0–4 are the spike strip, the last cell is a stray sliver, so the looping
idle animation uses 5 of 6 and skips it) that sweeps the rect back and
forth along its horizontal axis (`stepTrapSpikeRun`: bounce at the rect's edges,
and every `time2change_speed` seconds roll a new random speed in
[speedMin, speedMax], direction kept — RNG injectable for determinism)
via a dedicated trap layer (a transform twin of room 0, above the rooms,
under the player layer). The scene preloads the sheet (`scene/create.ts`,
served via the `public/trap` symlink), registers its frames + idle anim
(`registerTrapSpikeRunAnimations` in
`apps/web/src/game/trap/trap-spike-run-render.ts`)
and passes it as the default `trapSpikeRunTexture` —
`JungleGameOptions.trapSpikeRunTexture`
(web) can still swap each marker for a different caller-loaded sheet
(rendered as a static frame 0; only the built-in sheet has its 2×3
layout registered). Without a texture the marker falls back to a red
circle. With `NEXT_PUBLIC_DEBUG` on, a red **attack-radius box** outlines
 each marker's lethal AABB — the exact `isBoxTouchingTrapSpikeRun`
 `trap.height`-square kill zone — and follows it as it sweeps
 (`createTrapSpikeRunDebug` in
 `apps/web/src/game/trap/trap-spike-run-render.ts`, redrawn every frame
 after `updateTrapSpikeRunViews`; runtime toggle
 `__jungleTrapSpikeRunDebug`).
**Touching a trap marker kills**: the web update loop
probes its own simulated AABB against every marker each frame
(`isBoxTouchingTrapSpikeRun` in the shared trap model) and, on contact,
hands the
kill to `onDead` with cause `"trap"` — exactly the dead-zone flow
(freeze, death question, checkpoint return; the body is teleported out of
 the hazard at kill time so the revive can't re-kill it). All of this is
 per-type: a future `Trap_Saw` gets its own entity/model/view module
 beside `trap-spike-run.ts`, sharing the `trap` objectgroup and the
 scene's trap layer, with its own `state.trapSaw*` fields. Client-side
 only
— no server state; the shared motion model is the seam for future
validation.
**Moving platforms (`move_platform`, the first non-lethal trap type)**: its
OWN objectgroup named `move_platform` (not the shared `trap` group — the
group name IS the type and every object inside it is one platform
instance; the real map's object is unnamed, its rect the patrol lane):
`buildMovePlatforms` in `packages/shared/src/physics/move-platform.ts`
(optional `speed` prop, default 45 px/s — below the 55 px/s run speed, so
a slab that never carries the player can always be walked onto/followed;
missing `speed` → default, explicit junk speed → object skipped) and
`stepMovePlatform` sweeps a fixed 32×16 slab (`MOVE_PLATFORM_WIDTH`/
`HEIGHT`) back and forth along the lane, bouncing at its edges at a
constant speed (no random re-roll — a platform must be predictable). The
web client renders each slab from `Assets/trap/movePlatformF.png` (a
256×16 sheet of eight 32×16 frames in one row, all 8 in the looping
idle — the slab top is constant while a lower tooth retracts/regrows in
a symmetric 0–3/7–4 cycle; each frame is already the full 32×16
footprint, so no scaling; see
`apps/web/src/game/trap/move-platform-render.ts`) and **standing on the
slab grants ground support WITHOUT carrying**: every frame, after the
player step, `scene/update.ts` probes the local simulated box with the
shared `isBoxOnMovePlatform` (feet at/within 6px above the top — sized
above a max-fall frame so a falling player never tunnels; feet below the
top never catch, so the slab never hoists a player under it — and
horizontal overlap of the 32×16 surface) and, while `vy >= 0` (the gate
that stops a jump press being cancelled by the next support snap) and not
dead, applies `supportPlayerOnMovePlatform`: grounded, feet snapped onto
the top, vy zeroed, coyote refilled — but `x`/`vx` are deliberately never
touched: the player must walk manually and falls like any ledge the
moment the slab slides out from under the feet (`state.standingMovePlatformId`
tracks which slab currently supports them). It is support, not a kill:
the dead-zone/trap `onDead` flow is untouched, and because the reports it
produces are ordinary grounded positions nothing in the server's
anti-cheat changes (the slab itself is client-side, like the spike traps).
The debug overlay (NEXT_PUBLIC_DEBUG, `__jungleMovePlatformDebug`) draws
each platform's patrol lane + its current 32×16 slab in light blue; the
sheet is served via the `public/trap` symlink and shares the scene's trap
layer (created when either trap type exists) with the spike run.
**Door entities**: a door is a 1×2 stack of door tiles — a top gid
(375) above a bottom gid (401) — forming one **door** Entity with
two states (open/closed) — `buildDoorEntities` in
`packages/shared/src/physics/door.ts` greedily recognizes each
non-overlapping top-over-bottom stack of door gids as a single door
(default state
`closed`). A closed door is **solid**: `buildTileGrid` folds the door
gids into the single `TILE_DOOR` kind (a full block — the web client's
local prediction and the server's report validation share that same
grid), so the player cannot walk through it. Doors are also
**non-sticky**: the wall-cling grab refuses any probe that touches a
`TILE_DOOR` cell (`grabableWallBeside` in the shared collision code) —
not just the door cell itself: the 2px grab strip spans the player's full
height, so beside the door's bottom row it also overlaps the wall the
door sits flush on, and the wall cell alone used to make the strip
"grabable" (the player grabbed the door's face right at the seam and
hung there). The veto covers the whole strip, so a door's side faces are
smooth all the way to their edges and a player jumping into a closed
 door slides off instead of hanging; the wall beside a door only becomes
grabable once the strip fully clears the door's edge. The web debug overlay
draws each
door's own full perimeter in **purple** — door edges
never merge with or get hidden by other collision types, mirroring the
464 pit outline. Each door's lines live on their own graphics (keyed by
`doorKey(tx, ty)`, see `CollisionGeometry.doors` in
`apps/web/src/game/collision/collision-geometry.ts`), so the overlay can
hide them per door once the door opens (see below) — the per-room slices are stored in a sparse array indexed by room (a 1×2 door always fits one room, so earlier rooms are `undefined` holes), which `hideDoor`/`setEnabled`/`destroy` must and do skip (`if (overlay)`), else `.setVisible` on a hole throws. **Opening a door is room-level puzzle progress**: the
room's `QuestGate` (`apps/server/src/rooms/jungle/quest-gate.ts`) flips a
door's entity state to `open` when every showquest interaction linked to
it (same room-objectgroup name group, see the door-links bullet) has been
answered correctly. Opening must make the doorway passable on BOTH sides:
`clearDoorFromGrid` (shared `physics/door.ts`) zeroes the door's two
cells in the room's validation grid (reports from inside the doorway must
not read as buried-in-geometry) and in every client's prediction grid
(`apps/web/src/game/door/door-open.ts`, driven by the synced
`JungleState.doors` schema), drops the door's purple debug-collision
perimeter (`CollisionDebug.hideDoor` in
`apps/web/src/game/collision/collision-debug.ts`,
which draws each door's lines on its own graphics precisely so an opened
door's lines can be removed individually), and plays the door's one-shot
opening animation. The door's art is NOT tileset tiles: the web renderer
skips the door gids and draws each door from the dedicated
`Assets/door.png` sheet instead (`apps/web/src/game/door/door-render.ts`,
served via the `public/door.png` symlink) — a 3×3 grid of 64×64 cells
whose frames 0–8 trace the panel lifting out (frame 0 idle/closed, start
sliding at 5, doorway revealed by 8). The square cell maps onto the
door's 1×2-tile (16×32 map-px) stack at a quarter/half scale. Frame 0
shows while closed; when the
schema reports the door open the frames play once at 12 fps and the sprite
hides on completion, so the doorway ends visually empty. A client that
joins after the door opened spawns the sprite hidden instead of replaying
it. Because the state is
schema-synced, a player who joins after the door opened still finds it
open.

**Door links (room objectgroup)**: each rectangle in the Tiled map's `room`
objectgroup is a named region; a tile entity belongs to it when its
**center** falls inside the rectangle (`groupRoomObjectsByName` in
`packages/shared/src/physics/door-links.ts`), and objects that share a
**name** form one gate linking the showquest interactions to the doors those
rectangles contain. No extra map objects: the real map has a single room
object named `room1` — a whole-map bounds rect (0,0,496×272, hidden in
Tiled) containing the signpost at tile (17,11) and the door at tile (29,8)
by center — so the signpost and the door are linked directly under the
shared name — counts are 1 showquest × 1 door
for `room1` (proved by loader/quest-gate tests over synthetic maps —
nothing reads the live map file, see the `bun test` row); the
server's `loadJungleMap` exposes `roomObjects` + `doors`, and the room's
quest gate reads the very same groups to open doors once their showquests
are all answered correctly (`QuestGate` in
`apps/server/src/rooms/jungle/quest-gate.ts`). The
`NEXT_PUBLIC_DOOR_DEBUG`
("1"/"true", runtime toggle `__jungleDoorDebug`) debug overlay draws cyan lines from
every showquest to every door in the same-name group
(`apps/web/src/game/door/door-debug.ts`) and logs each group's counts. The
Colyseus
room does **no simulation** — it only
validates the client's movement reports (malformed / flood / teleport /
abnormal speed / buried-in-geometry via `validatePositionReport`) and
broadcasts the last accepted report. A failing report **stops the player**
(the broadcast freezes at the last accepted position, velocity zeroed) while
violations count toward a kick. `PlayerInfo` position/velocity fields come
from accepted client reports only (velocity clamped to the physics max) — a
raw client-supplied position is never trusted, and after a stop the player
only moves again once a report passes validation. Wall cling (a grab):
airborne next to a wall, moving into it, pressing jump grabs the wall and
hangs the player (no gravity, no lateral drift) until jump again launches
them up+away (wall jump), the wall face ends below them, or they land —
steering away from the wall does NOT release the cling; the only way to
detach while the wall remains beside them is to jump — the shared
stepPlayer state
machine + `clinging` in the wire reports/broadcast drive it deterministically
on both sides. Details live in the `shared`, `server`, and `web` workspace
guides. **Debug** (`NEXT_PUBLIC_DEBUG`,
off unless "1"/"true"): the collision-debug overlay renders, and R teleports
the player back to its checkpoint (starting at the spawn point) through a
`PLAYER_CHECKPOINT_MESSAGE` the room always accepts (its target is the
server-chosen spawn, so it can't bypass the anti-cheat) — only the R key
itself is debug-gated, on the web side. `NEXT_PUBLIC_DOOR_DEBUG`
("1"/"true") is a separate web-only gate for the cyan door-link lines
(see the door-links bullet above).

**Touch controls (mobile)**: on a coarse-pointer device (the same
`(pointer: coarse)` check the GameGate uses), the playing screen overlays
on-screen controls on the canvas: a bottom-left left/right move pad and a
bottom-right action cluster (interact + jump), anchored with safe-area
insets (`apps/web/src/components/touch-controls.tsx`). The HUD writes into
a shared `TouchControlsState` (`apps/web/src/game/touch/touch-input.ts`,
one instance per game) and the scene's update loop merges it into the
keyboard input every frame (`scene/update.ts`): left/right are held states,
jump/interact are tap edges consumed exactly like `Keyboard.JustDown`
(one tap = one jump/interact, buffered under the quest modal/death freeze
like a key press, mid-air taps consumed on landing) — there is no separate
touch code path in the player physics, so the run/jump/wall-cling
simulation and the anti-cheat reports behave identically to keyboard. The
interact button drives the same `PLAYER_INTERACTION_MESSAGE` flow as the E
key (grounded gate included). The buttons are `pointer-events-auto` inside
a `pointer-events-none` overlay, so taps anywhere else still reach the
Phaser canvas (quest-box rows, etc.); Phaser needs no extra pointers
because the HUD is DOM, not game objects.

**Quest questions (showquest)**: pressing E on the 315 signpost (see the
interaction bullet above) no longer logs — the server sends that player a
question. The room loads `Assets/question.json` at creation
(`apps/server/src/game/quest-bank.ts`; env `JUNGLE_QUESTIONS_PATH` override),
`showquest` picks a uniform-random question (`pickRandomQuestion`) and
shuffles its choices with a Fisher–Yates that tracks the correct index
(`shuffleChoices`) — the key stays server-side in the player's
`pendingQuest` slot (one unanswered question per player at a time: repeat
presses are dropped until the answer is graded, and `onReconnect` clears a
stale slot, so a reloaded player's signpost still works). The pending slot
also records the interaction tile the question came from. The client only
ever receives `quest:question` `{question, choices, tx, ty}` — the raw
plain-text strings, never the answer key — shows them in a screen-fixed
modal box
(`apps/web/src/game/quest/quest-box.ts`, click a row — mouse only, the
row order is the shuffle) and
reports `quest:answer` `{choice}`; the room sanitizes + bounds the index by
the sent `choiceCount`, grades it against the secret `correctIndex`, and
replies `quest:result` `{correct}`. On the verdict the box **lowers its
window immediately** (the panel had been covering the signpost) and the
in-world **question tablet** plays the answer — tile 315 in `layer1` IS
the tablet: the map renderer skips the 315 tileset art
(`isQuestionTabletTileGid`), and `apps/web/src/game/quest/question-tablet.ts`
(from the `Assets/QuestionTablet.png` sheet served via the
`public/question-tablet.png` symlink) renders one 16×32 sprite per
signpost from a 7×4 grid of 16×32 frames, at native 1:1 size (never
scaled shorter) on the SAME world layer as the doors (the doorLayer
container — under the lifted `out_tile` rim art and under the player
layer); the `tx`/`ty` from `quest:question` pick the ONE signpost that
asked, so `playVerdict` animates only that tablet — frame 0 is the idle
tablet shown while the
question is up and unanswered, a correct answer plays frames 1–9 and holds
on frame 9 (the check stays), a wrong answer plays frames 10–22 and returns
to frame 0 — then the box closes (it also closes itself 3s after an
unanswered answer so a blip can't wedge the player). A **correct** answer
completes the interaction tile that asked
it (`QuestGate.markCompleted`): that signpost can NEVER be asked again (a
repeat press — or a forged one — is a silent no-op), and once every
showquest interaction linked to a door is completed, the room opens that
door for the whole room (see the door-entities/door-links bullets). The choices are displayed unlabeled and in the shuffled order,
so no visual number or position leaks the file's answer key. The client
typesets the ASCII math (`d((x^5))/dx`, `5x^4`, `1/e^x`) with the shared
parser (`packages/shared/src/math/`, pure + unit-tested) walking into a
Phaser layout engine (`apps/web/src/game/quest/math-format.ts`, malformed
strings fall back to plain text): fractions render as numerator over a rule
over the denominator, `^` as a raised superscript, `-` as −, an explicit
`*` as a middle dot, and implicit multiplication as juxtaposition. The box
is modal: `state.questOpen` freezes the player's movement input and the E
key while it's up.

**Endgame (404 finish tile)**: tile gid 404 in `layer1` (a decoration tile
just left of the signpost at tile (7, 11), sitting on the same solid floor)
is the **finish point** — the second registered interaction tile, bound to
the `"finish"` action in the shared `INTERACTION_TILE_ACTIONS` registry
(315 is "showquest"; 404 is not a showquest, so the `room1` door-link group
still counts 1 showquest × 1 door — `groupRoomObjectsByName` collects only
`"showquest"`-action tiles, so the finish tile never gates a door). Standing
on it and pressing E runs the exact same validated interaction flow as the
signpost (client feet probe → `PLAYER_INTERACTION_MESSAGE` → the room
re-probes its own last accepted position with the shared rule and requires
it grounded, so only a real, on-tile press finishes). The `finish` handler
(`apps/server/src/rooms/jungle/interactions.ts`) is once-per-run and is not
gated by a pending question — an unfinished showquest doesn't block
finishing. The room then stamps the **server wall-clock finish moment** on
the synced `PlayerInfo.finishedAt` and records the run to its **SQLite
store** (`apps/server/src/game/run-results.ts`, file
`apps/server/data/jungle-runs.sqlite`, env `JUNGLE_RUN_RESULTS_PATH` — one
row per session, `time_ms` = `runCompletionTimeMs`: finish − joinedAt + 10s
per death the room counted, the same penalty the live HUD applies, so the
saved time equals the readout that stopped). The web client reads the
synced `finishedAt` and, the next frame, **freezes the top-right run timer**
(`updateRunTimer` stops ticking and commits to `finishedAt − startedAt`) and
shows a screen-fixed **RUN COMPLETE** overlay with the formatted completion
time (`apps/web/src/game/finish/finish-overlay.ts`); `state.finished` then
freezes movement/jump/E/R input (like the quest box) and disables the
trap/pit kills, so the monkey stands where it finished until it leaves. The
overlay and frozen timer both survive a page reload: `finishedAt` rides the
re-synced schema entry, so a reconnected finisher re-sees its result and the
timer never resumes ticking. A repeat press — or a forged one — is a silent
no-op (`player.finished` server-side; the upsert `ON CONFLICT(session_id)`
backstops a restarted room that lost its sim map).

**Reconnection**: a dropped client (page reload, tab close, network blip)
holds its seat + world entry for `RECONNECT_GRACE_SECONDS` (default 30,
`JUNGLE_RECONNECT_SECONDS`): the room's `onDrop` calls Colyseus
`allowReconnection()`, so the session rejoins with the **same sessionId** via
`client.reconnect(token)` and its name/last position survive. The web client
stores the reconnect token in sessionStorage and silently resumes after a
reload; mid-session blips are auto-reconnected by the Colyseus SDK's retry
loop while the client freezes its local simulation (no movement reports pile
up to look like a speed hack). `onReconnect` resets the report `seq` gate and
the speed clock, since a reloaded page restarts its `seq` at 0. An explicit
