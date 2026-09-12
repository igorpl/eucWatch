# Watch menus: the gaps, and the plan to close them

Everything below came out of the audit in [WatchMenus.md](WatchMenus.md), 2026-09-11,
plus the Inmotion pass on 2026-09-12. Each item says what is wrong, where, and what
closing it costs.

Begode, Kingsong, Veteran and Ninebot are in the numbered sections below.
**Inmotion is in its own `I-` block at the end**, because it has no test wheel behind it.

**Nothing here has been ridden.** The Begode work already in the tree
(`eucBegode` 1.84-1.87 — phase current scale, Alexovik frames, the settings lock, the
per-chunk allocation rework, the model banner) has **not been tested on a wheel yet**
either. Nothing in this plan should be started before that testing lands, because a
broken Begode connection would be blamed on the wrong change.

Priorities:

- **P1** — a tile that lies. It is drawn as working, it accepts the tap, and the wheel
  does not do what the tile says. These are the ones a rider trips over.
- **P2** — a tile that is drawn but inert, or a page that cannot be reached.
- **P3** — protocol support that exists with no way to reach it from the watch.
- **P4** — consistency and housekeeping.

---

## P1 — tiles that lie

### 1.1 Begode HORN does nothing

`P8-testing/dashBegode/dashBegodeOpt.js:130` toasts `SIDE BTN HORN >2KPH` and sets
`opt.horn.en`. `handler_btn.js:30` then calls `euc.wri("hornOn")` on a side-button press
above 2 kph. But `eucBegode.js` has **no `hornOn` / `hornOff` case** — `euc.cmd` returns
`[]` and `euc.wri` drops it at `if (!cob.length) return;`. Kingsong and Veteran both
handle the pair; Begode never did.

**Fix.** Begode has no horn, but it has `beep` (`b`, `[98]`). Map `hornOn` to a `beep`
and make `hornOff` a no-op, the way `eucVeteran.js:242` does with its pedal-mode beep:

```
}else if (n=="hornOn") { euc.is.horn=1; ...write euc.cmd("beep")... }
else if (n=="hornOff") { euc.is.horn=0; return; }
```

Then re-word the toast: the Begode "horn" is a single beep, not a held horn. Roughly 15
lines in `eucBegode.js`, one string in `dashBegodeOpt.js`.

### 1.2 NinebotE WATCH ALERTS tile is dead

`P8-testing/dashNinebotE/dashNinebotE.js:122-124`:

```js
}else if ( 120<=x && y<=100 ) { //watch alerts
    buzzer.nav([30,50,30]);
    return;                       // <- the face.go was never written
```

The hold branch at line 183 works (it toggles all four haptics), and the identical tile
in `dashNinebotS.js:124` navigates properly. One line:
`face.go("dashAlerts",0);` before the `return`.

### 1.3 Kingsong SENSOR LIFT: tap changes the wheel and not the watch

`dashKingsongOpt.js`, tap branch:

```js
face[0].ntfy(..., euc.dash.opt.snsr.lift);       // toasts the OLD state
euc.wri("setLiftOnOff", 1-euc.dash.opt.snsr.lift); // sends the NEW one
```

`opt.snsr.lift` is never updated and the tile is never redrawn, so the wheel and the
watch disagree until the next frame that carries the flag. The **hold** branch on the
same tile does it correctly (toggle the flag, redraw, send `lift`).

**Fix.** Make tap do what hold does, and drop the duplicated hold branch — or make tap a
no-op that toasts `HOLD -> SET`, which is what `dashKingsongAdvLimits` does for its
bottom two tiles. Prefer the first: two tiles on this page already toggle on tap.

The LED RIDE tile above it has the mirror-image problem and is harmless: tap resends the
value the wheel already has. Fold it into the same change.

---

## P2 — drawn but inert, or unreachable

### 2.1 Begode `INFO` — `NOT YET`

`dashBegodeOpt.js:130`. Everything it would show is already decoded and already drawn by
the garage info page (`dashGarage.js` — FIRM / SERL / DATE / ID off `euc.dash.info.get`).

**Fix.** Either point the tile at that page, or draw the same four rows locally plus the
Begode-specific latches worth seeing while connected: firmware banner (GW / JN / CF / BF),
PWM source (`alrt.pwm.hw` H or S), free-spin speed, pack cell count. The second is more
useful and is about 40 lines of `drawString`.

### 2.2 Begode `AUTO OFF` — read only, and does not say so

`dashBegodeOpt2.js`, top-left. It renders the wheel's idle timeout
(`eucBegode.js:346`, frame offset 8) and the tap handler is a bare `buzzer.nav(40)`.
This is **correct** — the Begode protocol has no set-idle-timeout command — but a tile
that draws a live value and silently refuses reads as broken.

**Fix.** One `ntfy("WHEEL SETTING","READ ONLY",...)` on tap. Two lines.

### 2.3 Begode on-connect / on-disconnect: the fourth tile is empty

`dashBegodeCon.js:30` and `dashBegodeDis.js:30` draw an empty grey tile where the
commented-out `VOICE MODE` tile used to be. Begode has no voice mode.

**Fix.** Put `VOLUME` there — Begode has `volume` (`W B <n> b`) and the value is already
edited on `dashBegodeOpt2`. `auto.onC.vol` / `auto.onD.vol`, applied in the connect and
disconnect sequences at `eucBegode.js:399` and `:419` next to `HL`, `beep` and `led`,
with 0 meaning NA the way `led` already does.

### 2.4 Kingsong Con2 / Dis2: five empty tiles

`dashKingsongCon2.js` (3 empty) and `dashKingsongDis2.js` (2 empty). The comments name
what was intended: auto ride, BT music, auto lift on Con2.

Auto lift already exists on `dashKingsongCon`, so Con2 has two real candidates, and the
commands for both are already in the table: `setBTMusicOnOff` and `setLedMagicOnOff` /
`setSpectrumOnOff`. Dis2's two empties have no obvious candidate.

**Fix.** Low value. Either wire BT music and magic LED into Con2, or shrink both pages to
the two tiles that exist and drop the second page from the swipe chain. Prefer shrinking:
a page that is three-quarters empty is worse than no page.

### 2.5 Kingsong `dashKingsongCharging` accepts no input

Its entire tap branch is inside a `/* ... */`. The screen is opened automatically by the
Simple ride face when charging starts, so a rider who taps it gets nothing at all —
not even a buzz.

**Fix.** Either delete the dead block and add a `buzzer.nav(40)` so it reads as
deliberate, or give it the one control that belongs there: a charge-current or
charge-limit readout. Begode and Veteran have nothing equivalent; this page is
Kingsong-only and is fine staying read-only, as long as it says so.

### 2.6 Inmotion V10 wheel-settings page is unreachable

`dashInmotionV10Opt2.js:144` navigates to `dashInmotionV1Adv`; `v2/apps.json` registers
the file as `dashInmotionV10Adv`. Same missing `0` in
`dashInmotionV10Adv.js:122` → `dashInmotionV1AdvCalibrate`. The limits and pass hops
below it are commented out as well.

**Superseded by [I-1.1](#i-11-the-v10-sub-page-chain-is-cut-in-half).** Inmotion was
audited on 2026-09-12 and the break turned out to be wider than three strings — nine
`face.go` names across four files, plus the mirror-image version of the same problem in
the Magic set. See the Inmotion block at the end of this document.

### 2.7 Ninebot Z: LIGHT and HORN toast `NOT YET`

`dashNinebotZ.js:110` and `:128`. Unlike 1.1 and 1.2 this is **not** a UI gap:
`eucNinebotZ.js` has only the four `live*` poll frames, no write commands at all. The
tiles are honest.

**Fix.** Protocol work, not menu work. Until someone decodes the Ninebot Z write frames,
grey the two tiles out rather than colouring them as live controls, so the page stops
advertising something it cannot do.

---

## P3 — protocol support with no way to reach it

| Maker | Command in the table | Reachable from a menu? |
| --- | --- | --- |
| Veteran | `setVolUp`, `setVolDn` | **no** — nothing calls them |
| Kingsong | `setLedMagicOnOff`, `setSpectrumOnOff`, `setSpectrumMode` | no |
| Kingsong | `setBTMusicOnOff` | no |
| Kingsong | `setVoiceVolUp`, `setVoiceVolDn` | no |
| Kingsong | `getRideParamA/B/C` | no |
| Kingsong | `doPowerOff` | only via `TURN OFF NOW` on the idle editor |
| Kingsong | `doHorn` | side button only, and only when voice mode is on |

**Plan.** Veteran volume is the one worth adding: it is two commands, and the Veteran
options page has no second page at all, so there is no room pressure. Put a `VOLUME`
tile where the layout allows and drive it with up/down steps rather than an absolute
value, since the protocol only offers `+` and `-`.

The Kingsong LED and music commands would need a page of their own. Not proposed —
`dashKingsong` is already thirteen screens deep and the gain is small.

---

## P4 — consistency and housekeeping

### 4.1 `dashAlerts` always wakes into the garage

`dashAlerts.js` `face[1]` is `face.go("dashGarage",0)`, whatever page pushed it. Enter it
from `dashBegodeOpt`, let the screen sleep, wake it, and you are in the garage. Every
other sub-page wakes into its own parent or into the ride face.

**Fix.** `face.appPrev` is already used by the slide-right handler on the same screen to
pick between the garage, `face.last` and the previous app. Reuse that logic in `face[1]`.

### 4.2 Editors disagree about what slide-down means

| Screen | slide down on an open editor |
| --- | --- |
| `dashBegodeOpt2` (VOLUME) | **cancels**, no write |
| `dashBegodeAdvLimits` (TILTBACK) | commits, writes |
| `dashKingsongAdvLimits` | commits, writes |
| `dashKingsongOpt2` (IDLE) | commits, writes |
| `dashVeteranLimits`, `dashVeteranModes` | commits, writes |

Begode VOLUME is the odd one out. **Fix**: make it commit, matching everything else —
four lines, and it removes the only way to lose a value you just dialled in.

### 4.3 Veteran screens say `SHERMAN`

Hard-coded in `dashVeteran.js` and `dashVeteranOptions.js`. The Patton, Lynx and Abrams
run the same screens — and `dashVeteranModes` exists precisely because those wheels are
different. The garage already has the model string in
`dash.json["slot"+n+"Model"]`.

**Fix.** Use the model string, trimmed to fit, falling back to `VETERAN`. Same helper
`dashGarage.js` uses to fit a model name into a tile.

### 4.4 Orphan files

| File | State |
| --- | --- |
| `P8-testing/dashVeteran/dashVeteraLimits.js` | superseded by `dashVeteranLimits.js` (note the missing `n`), not in either `apps.json` |
| `P8-testing/dash/dashOptions.1.js` | an older copy of `dashOptions.js`, not in either `apps.json` |

Both are dead weight in the repo and in searches. Delete.

### 4.5 Tap/hold split is not uniform

Three different conventions are in use for the same kind of tile:

- tap cycles, hold opens an editor — Begode LED, Kingsong alarms
- tap and hold do the same thing — Begode `Adv`, `Con`, `Dis`, Veteran main
- tap acts, hold does something different — Kingsong `Opt` (see 1.3)

Not worth a sweep on its own. Worth settling when a page is touched for another reason,
and the rule to settle on is the first one: **tap steps, hold sets**.

---

## Suggested order

1. Ride the Begode changes already in the tree. Nothing below starts first.
2. **1.2** NinebotE alerts — one line, no protocol risk.
3. **1.3** Kingsong lift sensor — self-contained, and it is the item most likely to be
   noticed as a bug.
4. **1.1** Begode horn — needs a wheel to confirm the beep is what a rider wants from the
   side button.
5. **2.2** + **4.2** Begode read-only toast and the volume editor commit — small, same
   file pair, ride them with 1.1.
6. **4.4** delete the two orphans, **4.3** Veteran model name.
7. **2.3** Begode volume on connect/disconnect, **2.1** Begode info page.
8. **P3** Veteran volume tile.
9. **2.5** / **2.4** Kingsong tidy-up, **2.7** grey out the Ninebot Z tiles.
10. The whole **Inmotion `I-` block** below, whenever Inmotion is picked up again. It has
    its own order at the end; the first three steps of it need no wheel.

---

# Inmotion

Added 2026-09-12 from the audit in [WatchMenus.md §9](WatchMenus.md). Kept as its own
block at the end of the list, after everything above, because **no Inmotion wheel is
available to test against** — the same reason the round above skipped it. Everything here
is ordered so the parts that need no wheel come first.

Item **2.6** in the P2 list above ("Inmotion V10 wheel-settings page is unreachable") is
superseded by **I-1.1** below, which turned out to be larger than three strings.

Priorities use the same scale as the rest of this document.

## I-P1 — tiles that lie

### I-1.1 The V10 sub-page chain is cut in half

`dashInmotionV10Opt2.js:144` navigates to `dashInmotionV1Adv`; `v2/apps.json` registers
the file as `dashInmotionV10Adv`. The same missing `0` appears in every hop below it —
`dashInmotionV10Adv.js:122` → `dashInmotionV1AdvCalibrate`, and the back-navigation and
wake pages of `AdvCalibrate`, `AdvLimits` and `AdvPass`, which all aim at
`dashInmotionV1Adv`. Four of the seven shipped screens are unreachable.

The rider does not get an error. `face.go` on a missing storage file evaluates
`undefined`, leaves `face[0]` pointing at the **previous** page and calls its `init()`,
so slide-left from `MORE` silently repaints `MORE` — while `face.appCurr` is left naming
a file that does not exist, which is what `ew.def.off[face.appCurr]` reads the screen
timeout from.

**Fix.** Settle on one name and use it everywhere. `dashInmotionV10*` is what
`apps.json` already ships and what the root screen is already called, so move the code
to meet it.

Do **I-2.2 first** and the job shrinks: with `AdvLimits` and `AdvPass` deleted it is
**five live `face.go` strings across three files** — `dashInmotionV10Opt2.js:144`,
`dashInmotionV10Adv.js:122`, and `dashInmotionV10AdvCalibrate.js:113,146,177` — plus the
commented-out block at `dashInmotionV10Adv.js:126-131` that goes with them. Done in the
other order it is fourteen strings across five files, eight of them in code about to be
deleted.

`dashInmotionV1Opt` and `dashInmotionV1Opt2` are **not** broken — `apps.json` registers
them under exactly those names — so they can stay as they are, or be renamed to match in
the same pass by changing both sides together (five code sites, both `apps.json` files).
Renaming one side only is what caused this.

Do **not** re-enable the `WHEEL ALERTS` and `PASS` tiles at the same time — see I-2.3.
The rename alone makes `ADVANCED` and `CALIBRATE` reachable, which is the useful half.

### I-1.2 The Magic (DK08 / DSD6) Inmotion menu is dead from the first hop

`Magic-testing/dashInmotionV10/*.js` still navigates to `dashInmotionV1`,
`dashInmotionV1Opt`, `dashInmotionV1Opt2` — the pre-rename names — while `v2/apps.json`
registers that set as `dashInmotionV10`, `dashInmotionV10Opt`, `dashInmotionV10Opt2`.
Nothing in the Magic Inmotion chain resolves, including the root's own wake page: leave
the screen, wake it, and the watch tries to open `dashInmotionV1`.

**Fix.** Same rename, applied to `Magic-testing/dashInmotionV10/` — and there it is the
whole file set, so it is a clean `dashInmotionV1` → `dashInmotionV10` sweep. Worth doing
in the same commit as I-1.1 so the two sets stop disagreeing.

### I-1.3 V10 TPMS: holding to disable does not repaint the tile

`dashInmotionV10.js:217`:

```js
face[0].btn("TPMS",18,60,115,1,0,100,119,195,"OFF",28,60,155); //3
```

The leading `bt` argument is missing. Everything shifts one place left: `bt` becomes the
string `"TPMS"`, the text to draw becomes the number `18`, and the fill rectangle becomes
`(119,195,"OFF",28)`. The tile keeps its old colour and old reading while
`opt.tpms` has already been cleared. Begode and Kingsong pass `btn(0,"TPMS",...)` at the
same place; V2, V11 and V12 pass `btn(1,"TPMS",...)`.

**Fix.** Add the missing leading argument so the call lines up with the tile's own
`init()` again — `btn(0,"TPMS",18,60,115,4,1,0,100,119,195,"OFF",28,60,150)`, the shape
`dashBegode.js:215` already uses. One line, and no wheel is needed to check it: a TPMS
sensor is enough.

## I-P2 — drawn but inert, or shipped and unopenable

### I-2.1 V10 `MORE`: two dead tiles, one of which lights up

`dashInmotionV10Opt2.js`. Top-right is an empty grey tile whose commented-out body was a
second `WATCH ALERTS` (the real one is one page back on `OPTIONS`). Bottom-right is drawn
with **no text at all** yet is still coloured from `auto.onC.lift`, so it changes colour
for a flag the rider can neither read nor set.

**Fix.** Two candidates, both already supported by `eucInmotionV10.js`:

- `AUTO LIFT` — finish the commented-out tile. `sethandleButton` exists and
  `auto.onC.lift` is already being drawn; what is missing is the label, the tap handler
  and the apply in the connect sequence at `eucInmotionV10.js:431` next to `setLights`.
- `AUTO VOLUME` — `setVolume` exists, the value is already edited on the root screen, and
  connect/disconnect is the natural place to restore it.

Whichever is chosen, the other tile should be dropped to a plain grey with no live
colour. A tile that changes colour and refuses every touch is worse than an empty one.

### I-2.2 `AdvLimits` and `AdvPass` are Kingsong screens in an Inmotion folder

627 lines shipped to the watch that cannot be opened, and could not work if they were —
plus another 620 in the Magic copy. They are a pre-rename fork of
`dashKingsongAdvLimits.js` / `dashKingsongAdvPass.js`:

- `euc.wri("setSpeedLimits")` — Kingsong-only. Inmotion has `speedLimit`, a single value.
- three speed alarms plus tiltback — Inmotion has one limit.
- `euc.wri("passClear")`, `"passChange"`, `"passSet"` — these do not exist on any module.
  Kingsong itself renamed them to `setPassClear` / `setPassChange` / `setPass`.
- `euc.dash.limt[b]`, `euc.dash.limt.en[b]`, `euc.dash.lim[...]`, `euc.dash.limE[2]` —
  **none of these objects exist anywhere in the tree.** The editor throws on open.

**Fix.** Delete both files from `P8-testing/dashInmotionV10/` and
`Magic-testing/dashInmotionV10/`, and their four `storage` entries — two in
`P8-testing/apps.json`, and two in each of the two `dashInmotionV10` blocks in
`v2/apps.json`. Then delete the commented-out `face.go` block in
`dashInmotionV10Adv.js:126-131` that aimed at them. The two blue tiles they left behind
on `ADVANCED` are I-2.3.

If a speed limit is wanted later it is a **new, small** page over the one `speedLimit`
command, not a repair of this one.

### I-2.3 V10 `ADVANCED` has two blue tiles that buzz

Once I-1.1 makes the page reachable, `WHEEL ALERTS` and `PASS` are the first thing a
rider will try, and both are painted `12` — the colour this codebase uses for a live
value or a selected control — with their handlers commented out.

**Fix.** Ship I-1.1 and I-2.2 together, and in the same change either grey the two tiles
out or put something real on them. The honest cheap option is grey plus a
`ntfy("NOT YET","",...)`, matching `dashBegodeOpt`'s `INFO`.

### I-2.4 V10 pedal tilt is sent unclamped

`dashInmotionV10AdvCalibrate.js:126-131`: each tap does `opt.ride.pTlt--` / `++` and
sends `setPpedalTilt` immediately. `eucInmotionV10.js:35` documents the range as
`-80..+80` and neither side enforces it, so holding the tile walks the value past it.
Unreachable today, and must be fixed **before** I-1.1 makes the page reachable.

**Fix.** Clamp in the handler the way `dashInmotionV10.js` clamps volume to 0-100.

## I-P3 — protocol support with no way to reach it

`eucInmotionV2` / `V11` / `V12` carry a large command table and the menu is four tiles.
Two of those tiles reach two commands:

| Command group | Reachable? |
| --- | --- |
| `lightsOn` / `lightsOff`, `playSound` | yes |
| `drlOn`/`Off`, `fanOn`/`Off`, `fanQuietOn`/`Off` | no |
| `liftOn`/`Off`, `lock`/`unlock`, `transportOn`/`Off` | no |
| `rideComfort` / `rideSport`, `performanceOn`/`Off` | no |
| `remainderReal`/`Est`, `lowBatLimitOn`/`Off` | no |
| `usbOn`/`Off`, `loadDetectOn`/`Off`, `mute`/`unmute` | no |
| `calibration`, `speedLimit`, `pedalTilt`, `pedalSensitivity` | no |
| `setVolume`, `setBrightness` | no |

**Plan.** One `OPTIONS` page for V2/V11/V12, reached by slide-left from the root the way
V10's is, and nothing more for now. `dashInmotionV1Opt` is the model to copy and the four
tiles to put on it, in order of how often a rider touches them:

1. **VOLUME** — `setVolume`, and on V2 the value is **already decoded**
   (`eucInmotionV2.js:152`), so the tile can be seeded from the wheel rather than
   latched. Reuse the V10 root's `face.menu.full` editor.
2. **RIDE MODE** — `rideComfort` / `rideSport`, a straight two-state tap.
3. **LIFT** — `liftOn` / `liftOff`, matching V10's `SENSOR LIFT`.
4. **DRL** — `drlOn` / `drlOff`. Inmotion's daytime running light is separate from the
   head light and there is no other way to reach it.

`lock` / `unlock`, `transport`, `fan`, `usb` and the rest would need a second page. Not
proposed: the same reasoning as the Kingsong LED and music commands above — the gain is
small and none of it can be tested here.

Three smaller items in the same area:

- `eucInmotionV2.js:423` calls the settings parser only when
  `euc.dash.info.get.modl == "V11"`. A V12 / V13 / V14 on the V2 module never gets its
  volume or its speed limit decoded. Worth widening the test before anything is drawn
  from those fields.
- `setPpedalTilt` (`eucInmotionV10.js:35`) and `setPedalSensitivity` (`:40`) build the
  **identical frame**. One of the two is wrong. Nothing calls
  `setPedalSensitivity`, so nothing is broken today, but the next person to wire it up
  will wire up the wrong thing.
- `proxyInmotionV2.js` exists in the tree and is listed in neither `apps.json`, so it
  never ships. Its header still reads `//InmotionV10 Proxy` and its `r` (phone → wheel)
  is stubbed to `return;`, exactly like `proxyInmotionV10.js`. V11 and V12 have no proxy
  at all. Register it or delete it; a third state is not useful.

## I-P4 — consistency and housekeeping

### I-4.1 V11 and V12 are the same file

`dashInmotionV11.js` and `dashInmotionV12.js` are byte-identical apart from the first
comment line, and `dashInmotionV2.js` is the same screen reindented. Three copies of one
screen, three `apps.json` entries, and any fix has to be made three times — which is how
I-4.2 came about.

**Fix.** Not urgent, and it is not free: the maker string drives the app name
(`dash<Maker>`), so collapsing them needs either a shared file that all three ids point
at in `apps.json`, or one `dashInmotion` app and a maker lookup in `dashScan.js`. Worth
settling before anything from I-P3 is written, so the new page is written once.

### I-4.2 V2 raises `euc.is.busy` and never lowers it

`dashInmotionV2.js:6` does `euc.is.busy=1; //stop bt loop-accept commands`. On V11 and
V12 every exit path — slide down, slide up, slide right, and the wake page — does
`euc.is.busy=0; euc.wri("live")`. On V2 none of them do.

It is inert **today** because `eucInmotionV2.js` never reads `euc.is.busy`; it uses
`euc.tout.busy`. So this is not a live bug, it is a trap for whoever adopts the flag next.

**Fix.** Drop the line from `dashInmotionV2.js` rather than adding four resets — the V2
module does not use the convention, so the honest change is to stop pretending it does.

### I-4.3 V2 / V11 / V12: `face[0].set` is read and never written

`init()` clears `this.set`, and two branches of the tap and slide-right handlers test
`face[0].set` and draw a vertical line at x=120 to clean up after an editor that does not
exist on this screen. Nothing ever sets it. Leftover from whatever this was forked from
(`dashInmotionV2.js:8,9,141,199`). Delete.

### I-4.4 V10's `face.menu` is installed by one screen and used by two

`dashInmotionV10.js` installs `face.menu.full` under `if (!face.menu)`, and
`dashInmotionV1Opt` calls it for the horn sound picker without installing it. It works
because the root is always evaluated first and `face.go` does not clear `face.menu` —
but it also means `face.menu` outlives the app and stays on the global `face` object
after the rider has left Inmotion entirely. V2, V11 and V12 each define their own
`face[0].menu`, which is cleared with the page.

**Fix.** Move to the `face[0].menu` pattern when either file is next touched.

### I-4.5 A missed tap buzzes "accepted" on V2 / V11 / V12

The final `else` of the tap branch is `buzzer.nav([30,50,30])` — the accept buzz — where
§2.2 of the menu map says a refused tap buzzes `40`.

**This is not Inmotion-only.** `dashBegodeAdv.js:124`, `dashBegodeOpt.js:136`,
`dashKingsongAdv.js:138` and `dashKingsongAdvCalibrate.js:134` do the same. So it belongs
with **4.5** above ("tap/hold split is not uniform") rather than here: not worth a sweep
on its own, worth settling on `40` whenever one of these files is opened for another
reason.

### I-4.6 The wheel does not tell the watch what its lights are doing

`opt.lght.HL` is decoded from the wheel on V10 only (`eucInmotionV10.js:114`, byte 99).
On V2, V11 and V12 nothing decodes it, so the LIGHT tile reads `OFF` after every
reconnect whatever the wheel is actually doing. The same is true of `opt.lght.led` and
`opt.snsr.lift` on V10's `OPTIONS` page — both are write-only.

Protocol work, not menu work, and not worth doing blind. Noted so that a tile showing
the wrong state after a reconnect is not filed as a menu bug.

### I-4.7 V11 / V12 kill the lights on every disconnect, with no tile

`eucInmotionV11.js:240` and `eucInmotionV12.js:229` send `lightsOff` unconditionally
before disconnecting, and re-send the stored state on connect. That is exactly what V10 puts
behind its `AUTO LIGHT` tile — here it is not optional and not mentioned anywhere on the
screen.

**Fix.** Gate it on `auto.onC.HL` like V10 does, and give it a tile if I-P3's `OPTIONS`
page happens. Until then it is at least worth a line in the app README.

### I-4.8 V10's disconnect sends a junk frame when auto-light is off

`eucInmotionV10.js:412`:

```js
euc.temp.wCha.writeValue(euc.cmd("setLights",(euc.dash.auto.onC.HL)?0:2))
```

`setLights` rejects anything that is not 0 or 1 by returning `new Uint8Array([0])`, so
with `AUTO LIGHT` off the watch writes a single `0x00` byte to the wheel on every
disconnect. The intent was clearly "if auto light is on, turn the lights off; otherwise
do nothing". It also reads the **on-connect** flag in the **disconnect** path.

**Fix.** Skip the write instead of sending an invalid value, the way the `start` branch
twenty lines below already does with its `:"ok"`.

## Suggested order for the Inmotion block

Nothing here is riding-critical, and none of it can be confirmed without a wheel. The
first three need no wheel to verify and are worth doing whenever Inmotion is picked up:

1. **I-2.2** delete the two Kingsong forks and their `apps.json` entries — pure removal,
   627 lines of watch storage on the P8 set plus 620 on the Magic one, and it shrinks
   step 4 from fourteen strings to five.
2. **I-1.3** the TPMS repaint and **I-4.3** the dead `set` branches — two small,
   independent, wheel-free fixes. **I-4.5** rides along if these files are open anyway.
3. **I-2.4** clamp the pedal tilt. Must land before step 4.
4. **I-1.1** + **I-1.2** the rename, both file sets in one commit, with **I-2.3** greying
   out the two tiles the rename exposes.
5. **I-4.8** the junk disconnect frame and **I-4.7** the V11/V12 light gate — small, same
   area, and they want a wheel to confirm.
6. **I-4.2** drop the V2 busy flag, **I-4.4** move `face.menu` onto `face[0]`.
7. **I-4.1** decide whether V2/V11/V12 stay three files. Settle this **before** step 8.
8. **I-2.1** fill or flatten V10's two dead `MORE` tiles.
9. **I-P3** the new `OPTIONS` page for V2/V11/V12, and the three protocol notes under it.
