# Watch menus: the gaps, and the plan to close them

Everything below came out of the audit in [WatchMenus.md](WatchMenus.md), 2026-09-11.
Each item says what is wrong, where, and what closing it costs.

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

Out of scope for this round (Inmotion is deliberately not being worked on), noted so it
is not rediscovered. The fix is three strings.

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
10. **2.6** Inmotion V10 naming, whenever Inmotion is picked up again.
