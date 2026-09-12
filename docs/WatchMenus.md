# The watch menus, as they are implemented today

A screen-by-screen map of every wheel menu the watch draws, per maker. Written from the
code in `P8-testing/dash*/` (the P8 / P22 / Pinetime app set that `v2/apps.json` ships)
and the command tables in `v2/euc/euc*/`. Audited 2026-09-11; Inmotion added 2026-09-12.

Companion document: [WatchMenuPlan.md](WatchMenuPlan.md) — the gaps this map turned up
and the plan to close them.

The older `Magic-testing/dash*` set (DK08 / DSD6) is a smaller, frozen copy of the same
screens and is **not** described here, except where it diverges in a way that breaks it
(§9.0). Where `v2/apps.json` lists an app twice, the second entry is that Magic set.

---

## 1. How a menu screen works

Every screen is one storage file. `face.go("dashBegodeOpt", 0)` reads that file, evals
it, and the file installs three things:

| Symbol | What it is |
| --- | --- |
| `face[0]` | the visible page — `init()` draws it once, `show()` repaints the tiles whose value changed, on a 100-200 ms timer |
| `face[1]` | the **wake page**. `offms:1000`, and its `show()` is one `face.go(...)`. This is where the watch lands when the screen has slept and you wake it — see §2.4 |
| `touchHandler[0]` | `function(e,x,y)` — all gestures for the screen |

Three helpers are copy-pasted into nearly every screen:

```
btn(bt, txt1,size1,x1,y1, clr1,clr0, rx1,ry1,rx2,ry2, txt2,size2,x2,y2)
    fills rect rx1,ry1..rx2,ry2 in clr1 when bt is truthy, else clr0,
    then draws txt1 (centred on x1,y1) and optionally txt2 (on x2,y2).

ntfy(txt1, txt0, size, clr, bt)
    a one second toast across the footer strip: txt1 when bt, else txt0.
    Then the footer title is redrawn.

set(...)  /  setE
    a full screen "<  value  >" editor. While setE is set, every gesture
    changes meaning (see §2.3).
```

### Colour numbers seen in `btn`

`0`=black `1`=dark grey (off) `2`=dim `4`=green (on) `6`=red `9`=amber
`12`=blue (selected/value) `13`=red-orange (warning) `15`=white.

## 2. The tile grid and the gestures

The screen is 240x240. A four-tile page splits at **x=120** and **y=98/99**, and the
strip from **y=196** down is the footer: a title, a page-position bar, and the `ntfy`
toast area.

```
      0                 120                239
    0 ┌──────────────────┬──────────────────┐
      │     top-left     │    top-right     │
      │    x<=120 y<100  │  120<=x  y<=100  │
   98 ├──────────────────┼──────────────────┤
      │   bottom-left    │   bottom-right   │
      │  x<=120 100<=y   │ 120<=x  100<=y   │
  195 ├──────────────────┴──────────────────┤
  196 │ ····███████·····  page position bar │
  205 │              FOOTER / ntfy          │
  239 └─────────────────────────────────────┘
```

Some screens use full-width rows instead (Veteran alerts and modes, the Begode speed
alarm row, the watch-alert editors). Those are called out per screen.

### 2.1 Gesture codes in `touchHandler[0]`

| `e` | gesture |
| --- | --- |
| 1 | slide down |
| 2 | slide up |
| 3 | slide left |
| 4 | slide right |
| 5 | tap |
| 12 | hold (long press) |

### 2.2 The conventions every screen follows

- **slide right = back.** One step towards the maker root, then out to the ride face.
- **slide left = forward.** The next page of the same maker. A dead end buzzes `40`.
- **slide down = out.** Straight to the current ride face,
  `face.go(ew.is.dash[ew.def.dash.face],0)`. On an editor page it commits or cancels
  first — which of the two is not consistent, see §7.
- **slide up = the watch settings app**, `face.go("settings",0)`.
  **Except** a slide up that starts in the bottom-left corner (`200<=y && x<=50`), which
  toggles between full brightness and the current level and stays on the screen.
- **tap = the tile's action.** **hold = the tile's second action** — usually "open the
  editor" where tap cycles, or an on/off where tap only reports.
- A refused tap buzzes `40`. An accepted one buzzes `[30,50,30]`.

### 2.3 While a value editor is open (`setE` / `set`)

- tap **left half** = down a step, tap **right half** = up a step
- slide **right** = commit and go back to the tile page
- slide **down** = commit-and-leave on some screens, cancel-and-leave on others (§7)
- slide **left** = refused

Inmotion does not use this editor. Its screens open `face.menu.full` and set
`face[0].sub` instead: the same left-half/right-half stepping, but **every step is sent
to the wheel as it happens**, so there is nothing to commit and nothing to cancel. Tap
below y=170, or slide right, to close it. See §9.1 and §9.2.

### 2.4 Where the watch lands when the screen wakes

This is `face[1]`, and it is **not** the screen you were on:

| Screen you left | Wakes on |
| --- | --- |
| any ride face (Digital / Simple / PWM) | `clock` |
| maker root (`dashBegode`, `dashKingsong`, `dashVeteran`, `dashNinebot*`, `dashInmotion*`) | the current ride face |
| every Veteran sub-page | the current ride face |
| Begode / Kingsong sub-pages | their parent page |
| Inmotion sub-pages | their parent page, except `dashInmotionV10AdvLimits` (the root) and the three that wake into the dead `dashInmotionV1Adv` — see §9.0 |
| `dashGarage` | `dashOff` |
| `dashAlerts`, `dashScan` | `dashGarage` |
| `dashOptions` | the app it was opened from |

## 3. Getting into the menus

```
            ┌──────────────────────────────────────────┐
            │   ride face: Digital / Simple / PWM      │
            │   slide down cycles between the three    │
            └───┬──────────────────────┬───────────────┘
       slide left│                     │slide right
                 ▼                     ▼
     euc.state=="READY" ──► dash<Maker>          clock
     euc.state=="OFF"   ──► dashGarage
     anything else      ──► buzz, stays put
```

`<Maker>` is `require("Storage").readJSON("dash.json",1)["slot"+slot+"Maker"]`, so the
root screen is literally the maker name: `dashBegode`, `dashKingsong`, `dashVeteran`,
`dashNinebotZ`, `dashNinebotS`, `dashNinebotE`, `dashInmotionV2/V10/V11/V12`.

---

## 4. Shared screens

These are in the `dash` app (`P8-testing/dash/`) and are reached from more than one
maker.

### 4.1 `dashGarage` — four wheel slots

```
                 dashGarage  ·  footer: GARAGE
        ┌───────────────────┬───────────────────┐
        │  slot 1           │  slot 2           │
        │  MAKER / MODEL    │  MAKER / MODEL    │
        │  or EMPTY         │  or EMPTY         │
        ├───────────────────┼───────────────────┤
        │  slot 3           │  slot 4           │
        └───────────────────┴───────────────────┘
  tap  an occupied slot → SET / DEL confirm bar, or the FIRM/SERL/DATE/ID
       info page for the slot that is in use
  tap  an empty slot → dashScan
  left → dashAlerts      down → dashOff or the ride face
```

### 4.2 `dashScan` — find a wheel, write it into the slot

### 4.3 `dashAlerts` — the **watch's own** haptic alerts

Reached from every maker's options page ("WATCH ALERTS"). These are watch-side buzzes,
nothing is sent to the wheel.

```
   page 0                              page 1 (Kingsong / Begode / Veteran only)
   ┌─────────────┬─────────────┐       ┌───────────────────────────────┐
   │   SPEED     │     AMP     │       │  PWM: 80 %   /  PWM DISABLED  │
   ├─────────────┼─────────────┤       ├───────────────────────────────┤
   │   TEMP      │    BATT     │       │            (blank)            │
   └─────────────┴─────────────┘       └───────────────────────────────┘
                                       slide left from page 0 to reach it
```

Each tile opens a full-screen editor:

| Editor | Fields |
| --- | --- |
| SPEED | threshold (1-99 kph), RESOLUTION 1-5 (one pulse per N kph over the threshold), HAPTIC on/off |
| AMP | UPHILL 1-1000 A, BRAKING -1..-1000 A, RESOLUTION 1-15 A, HAPTIC on/off |
| TEMP | high temp 25-90 C, HAPTIC on/off. Tap the right half to cross over to BATT |
| BATT | low battery 5-60 %, HAPTIC on/off. Tap the left half to cross back to TEMP |
| PWM | limit 50-90 %, HAPTIC on/off, and **CALIBRATE PWM** — Begode only, and only when PWM is in software mode: ride at top speed, tap, and `pwm.rotS` is back-calculated from the speed and the volts seen |

### 4.4 `dashOptions` — dash options, a 3x2 grid, two pages

```
   page 0                                   page 1
   ┌────────┬────────┬────────┐             ┌────────┬────────┬────────┐
   │KPH/MPH │  C/F   │ (dead) │             │ FULL   │ AMP N/R│ PWM H/S│
   ├────────┼────────┼────────┤             ├────────┼────────┼────────┤
   │SPEED X │ DIST X │ RETRY  │             │ EMPTY  │ PACK   │ SPIN   │
   └────────┴────────┴────────┘             └────────┴────────┴────────┘
```

`PWM H/S` (hardware vs watch-estimated PWM) and `SPIN` (free-spin speed at a full pack,
20-250) are **Begode only** — both refuse on any other maker.

### 4.5 `dashOff` — the disconnected dash, and `tpmsFace` — the TPMS app

---

## 5. Begode

Command table: `v2/euc/eucBegode/eucBegode.js`. Eight screens.

```
   ride face ──left──► dashBegode ──left──► dashBegodeOpt ──left──► dashBegodeOpt2
                            │                     │                       │
                            │                     │ tap TR                │ left
                            │                     ▼                       ▼
                            │                dashAlerts            dashBegodeAdv
                            │                                             │
                            └── tap BL (tpms) ──► tpmsFace       ┌────────┴────────┐
                                                             tap TR            tap BR
                                                                │                 │
                                                    dashBegodeAdvCalibrate  dashBegodeAdvLimits

   dashBegodeOpt2 tap TR ──► dashBegodeCon      (slide right → back to dashBegodeOpt2)
   dashBegodeOpt2 tap BR ──► dashBegodeDis      (slide right → back to dashBegodeOpt2)
```

`dashBegodeAdvLimits` is also reachable straight from the **Digital** ride face: tap the
bottom-left corner (`110<y<195, x<55`) while the maker is Begode.

### 5.1 `dashBegode` — footer **ACTIONS**

```
        ┌───────────────────┬───────────────────┐
        │ LIGHTS        ON  │ STROBE        OFF │
        │                   │                   │
        │ tap: 0 <-> 1      │ tap: 0 <-> 2      │
        │  lightsOn/Off     │  lightsStrobe/Off │
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ LED             3 │
        │                   │                   │
        │ tap: tpmsFace     │ tap: next mode    │
        │ hold: on/off      │ hold: pick 0-9    │
        └───────────────────┴───────────────────┘
```

- LIGHTS and STROBE are the same wheel setting, `opt.lght.HL`: 0 off, 1 on, 2 strobe.
- **STROBE is refused while the speed alarm mode is 3 (PWM tilt)** — Freestyl3r firmware
  drives the strobe itself as its PWM warning, so the two fight. Turning it off is always
  allowed. Toast: `PWM TILT USES IT`.
- LED: tap steps 0→9→0 and sends `ledMode`. What a number means is per wheel (an RGB
  colour on one, the PWM screen instead of speed on an Xway), which is why the tile shows
  a bare number.
- TPMS tile colour: green when a reading is under 30 min old, red-orange when that
  reading is in alarm, grey otherwise.

### 5.2 `dashBegodeOpt` — footer **OPTIONS**

```
        ┌───────────────────┬───────────────────┐
        │      (empty)      │ WATCH             │
        │                   │ ALERTS            │
        │  tap: buzz        │ tap: dashAlerts   │
        ├───────────────────┼───────────────────┤
        │ INFO              │ HORN              │
        │                   │                   │
        │ tap: "NOT YET"    │ tap: on/off flag  │
        └───────────────────┴───────────────────┘
```

- INFO is a **placeholder**, it only toasts `NOT YET`.
- HORN sets `opt.horn.en`, which `handler_btn.js` reads to make the side button a horn
  above 2 kph. See the gap list — **Begode has no horn command**, so the flag does
  nothing on this maker.

### 5.3 `dashBegodeOpt2` — footer **MORE**

```
        ┌───────────────────┬───────────────────┐
        │ AUTO OFF          │ ON                │
        │ 00:30:00          │ CONN              │
        │ tap: buzz         │ tap: dashBegodeCon│
        ├───────────────────┼───────────────────┤
        │ VOLUME          4 │ ON                │
        │                   │ DISC              │
        │ tap: editor 1-9   │ tap: dashBegodeDis│
        └───────────────────┴───────────────────┘
```

- AUTO OFF is **read-only by design**: `eucBegode.js` decodes the wheel's idle timeout
  out of the frame (`auto.offT = data.getUint16(8)`), but the Begode protocol has no
  command to set it.
- VOLUME editor sends `volume` (`W B <n> b`) on **slide right**. Slide down closes the
  editor **without sending**.

### 5.4 `dashBegodeCon` / `dashBegodeDis` — footer **ON CONNECT** / **ON DISCONNECT**

Identical pages over `auto.onC` / `auto.onD`. Applied by `eucBegode.js` at connect and
at disconnect.

```
        ┌───────────────────┬───────────────────┐
        │ LIGHT         ON  │ LED             2 │
        │ NA/ON/OFF/STOBE   │ NA, then 0-9      │
        ├───────────────────┼───────────────────┤
        │ BEEP          ON  │      (empty)      │
        │ NA / ON           │ voice mode, cut   │
        └───────────────────┴───────────────────┘
```

Tap and hold do the same thing on every tile here. "NA" means "do nothing on connect",
which is why LED is stored one higher than the mode it sends (`led-1`).

### 5.5 `dashBegodeAdv` — footer **WHEEL SETTINGS**

```
        ┌───────────────────┬───────────────────┐
        │ MODE          MED │ CALIBRATE         │
        │ SOFT/MED/HARD     │                   │
        │ pedalSoft/Med/Hard│ tap: calibrate pg │
        ├───────────────────┼───────────────────┤
        │ ANGLE         LOW │ WHEEL             │
        │ LOW/MED/HIGH      │ ALERTS            │
        │ rollAngleLow/...  │ tap: limits pg    │
        └───────────────────┴───────────────────┘
```

Raw pedal mode 0 really is SOFT — matches WheelLog once its inverted list index is
undone. Tap and hold are the same. Slide left is a dead end.

### 5.6 `dashBegodeAdvCalibrate` — a six-step instruction card

```
        1. PRESS START
        2. WHEEL BEEPS, TURN OFF
        3. LEVEL WHEEL, TURN ON
        4. WHEEL BEEPS, TURN OFF
        5. TURN WHEEL ON
        6. DONE!
        ┌─────────────────┬─────────────────┐
        │     CANCEL      │      START      │   y>=175
        └─────────────────┴─────────────────┘
```

START sends `calibrate` (`c y`, the one command spaced 300 ms instead of 100 ms).

### 5.7 `dashBegodeAdvLimits` — footer **WHEEL ALERTS**

```
        ┌─────────────────────────────────────┐
        │ SPEED ALARMS           1st & 2nd    │  full width
        │ tap cycles: 1st & 2nd -> 2nd only   │
        │             -> Both Disabled        │
        ├───────────────────┬─────────────────┤
        │ PWM TILT          │ TILTBACK     50 │
        │ FREESTYL3R        │                 │
        │  FIRMWARE         │ tap: editor     │
        └───────────────────┴─────────────────┘
```

- `alrt.mode` is one value for all three: 0 `alertsOneTwo`, 1 `alertsTwo`, 2
  `alertsOff`, 3 `alertsTiltback`. Mode 3 is what blocks the strobe tile on the root.
- TILTBACK editor: 5..100 kph, and **100 means off** — the value shows as `-` and the
  footer says `TILTBACK DISABLED`. Tapping the footer strip jumps straight between 50 and
  off. Commits on slide right **and** on slide down.
- Displayed in mph when `ew.def.dash.mph` is set (`0.625 *`), but **stored and sent in
  kph**.

---

## 6. Kingsong

Command table: `v2/euc/eucKingsong/eucKingsong.js` — much the largest of the four.
Thirteen screens.

```
  ride face ─left─► dashKingsong ─left─► dashKingsongOpt ─left─► dashKingsongOpt2
                        │                      │                        │
                 tap TL │               tap TR │                 left / tap
                        ▼                      ▼                        │
              dashKingsongLight           dashAlerts        ┌───────────┼───────────┐
                                                            ▼           ▼           ▼
                                              dashKingsongCon   ...Charging   ...Dis
                                                    │ left                       │ left
                                                    ▼                            ▼
                                           dashKingsongCon2              dashKingsongDis2

  dashKingsongOpt2 ─left─► dashKingsongAdv ─┬─ tap TR ─► dashKingsongAdvCalibrate
                                            ├─ tap BL ─► dashKingsongAdvLimits
                                            └─ tap BR ─► dashKingsongAdvPass
```

`dashKingsongCharging` is also opened by the **Simple** ride face when the wheel starts
charging (`face[0].charge()`).

### 6.1 `dashKingsong` — footer **ACTIONS**

```
        ┌───────────────────┬───────────────────┐
        │ LIGHTS / CITY  ON │ STROBE        OFF │
        │ tap: light page   │ tap:setStrobeOnOff│
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ LOCK              │
        │ tap: tpmsFace     │ tap: doLock /     │
        │ hold: on/off      │      doUnlock     │
        └───────────────────┴───────────────────┘
```

The LOCK tile is amber instead of red when "unlock once" is armed. If the wheel is pass
locked, `dashKingsongAdvPass` is pushed in front of this screen on entry.

### 6.2 `dashKingsongLight` — footer **HEAD LIGHT**

```
        ┌───────────────────┬───────────────────┐
        │        ON         │       AUTO        │   setLights 1 / 3
        ├───────────────────┼───────────────────┤
        │ eucWatch          │       OFF         │   setLights 2
        │ CITY              │                   │
        └───────────────────┴───────────────────┘
```

CITY is a **watch-side** mode (`opt.lght.city`) — it sends no command of its own, it
marks that the watch is driving the light. Both slide left and slide right go back to
the root.

### 6.3 `dashKingsongOpt` — footer **OPTIONS**

```
        ┌───────────────────┬───────────────────┐
        │ LED               │ WATCH             │
        │ RIDE              │ ALERTS            │
        │ tap: send state   │ tap: dashAlerts   │
        │ hold: toggle+send │ hold: all haptics │
        ├───────────────────┼───────────────────┤
        │ SENSOR            │ HORN              │
        │ LIFT              │                   │
        │ tap: send inverse │ tap: on/off flag  │
        │ hold: toggle+send │ hold: same        │
        └───────────────────┴───────────────────┘
```

Note the split: **tap sends, hold toggles** on LED RIDE and SENSOR LIFT — and the two
disagree about which value they send (tap sends `1-lift`, hold sends `lift`).

### 6.4 `dashKingsongOpt2` — footer **MORE**

```
        ┌───────────────────┬───────────────────┐
        │ IDLE              │ ON                │
        │ 1h:0m             │ CONN              │
        │ tap: idle editor  │ tap: Con page     │
        ├───────────────────┼───────────────────┤
        │ INFO              │ ON                │
        │                   │ DISC              │
        │ tap: Charging pg  │ tap: Dis page     │
        └───────────────────┴───────────────────┘

  idle editor:   <  1h:0m  >     10 min steps, 60 s .. 4 h
                 TURN OFF / NOW  ← the bottom strip powers the wheel down now
```

The idle value is written with `setPowerOff` when you leave the editor by any route.
`TURN OFF NOW` forces `auto.onD.off=1`, `auto.onD.lock=0`, then calls `euc.tgl()`.

Slide left goes to `dashKingsongAdv` and refreshes the alarms first (`getAlarms`), unless
you have just come back from there.

### 6.5 `dashKingsongAdv` — footer **WHEEL SETTINGS**

```
        ┌───────────────────┬───────────────────┐
        │ MODE         HARD │ CALIBRATE         │
        │ HARD/MED/SOFT     │ getCalibrateTilt  │
        │ setRideMode       │ then the page     │
        ├───────────────────┼───────────────────┤
        │ WHEEL             │ PASS              │
        │ ALERTS            │ getPass, then the │
        │ tap: limits pg    │ pass page         │
        └───────────────────┴───────────────────┘
```

### 6.6 `dashKingsongAdvLimits` — footer **WHEEL ALERTS**

```
        ┌───────────────────┬───────────────────┐
        │ ALARM 1        18 │ ALARM 2        25 │
        │ tap: enable/dis   │ tap: enable/dis   │
        │ hold: editor      │ hold: editor      │
        ├───────────────────┼───────────────────┤
        │ ALARM 3        30 │ TILTBACK       50 │
        │ tap: "HOLD -> SET"│ tap: "HOLD -> SET"│
        │ hold: editor      │ hold: editor      │
        └───────────────────┴───────────────────┘
```

The four values are kept in order — each editor refuses to cross its neighbour and
toasts `MOVE ALARM 2`, `MOVE TILTBACK` and so on. Tiltback is capped at 75 kph. All four
are written together with `setSpeedLimits` on the way out.

### 6.7 `dashKingsongAdvCalibrate` — two pages

```
  page A: manual pedal tilt          page B: the calibration card
  ┌──────────┬──────────┐            1. PRESS START      4. WHEEL BEEPS->OFF
  │  tilt fwd│ tilt back│            2. LEVEL WHEEL      5. TURN WHEEL ON
  │  setCalibrateTilt   │            3. TURN WHEEL ON    6. DONE!
  ├─────────────────────┤            ┌──────────┬──────────┐
  │ START CALIBRATION   │ ──────────►│  START   │  CANCEL  │
  └─────────────────────┘            └──────────┴──────────┘
                                      doCalibrate
```

### 6.8 `dashKingsongAdvPass` — footer **PASS SETTINGS**

`WHEEL IS PASS LOCKED` / `WHEEL IS PASS FREE`, a `CHANGE PASS` button, and a
`TOUCH TO ENTER CODE` keypad. Commands: `getPass`, `setPass`, `setPassClear`,
`setPassSend`, `setPassChange`.

### 6.9 `dashKingsongCon` / `dashKingsongDis` — footer **ON CONNECT** / **ON DISCONNECT**

```
        ┌───────────────────┬───────────────────┐
        │ LIGHT        AUTO │ LED               │
        │ NA/ON/OFF/AUTO    │ RIDE      NA/on/off│
        ├───────────────────┼───────────────────┤
        │ SENSOR            │ VOICE             │
        │ LIFT   NA/on/off  │ MODE    NA/on/off │
        └───────────────────┴───────────────────┘
```

### 6.10 `dashKingsongCon2` / `dashKingsongDis2` — second page of the same

```
   Con2                                 Dis2
   ┌───────────┬───────────┐            ┌───────────┬───────────┐
   │  (empty)  │  (empty)  │            │  (empty)  │ AUTO OFF  │
   ├───────────┼───────────┤            ├───────────┼───────────┤
   │  (empty)  │ UNLOCK    │            │  (empty)  │ AUTO LOCK │
   │           │ ONCE      │            │           │           │
   └───────────┴───────────┘            └───────────┴───────────┘
```

The comments in `dashKingsongCon2` name the three empty tiles: auto ride, BT music, auto
lift. Only UNLOCK ONCE was implemented.

### 6.11 `dashKingsongCharging` — read only

`CHARGING 84 %`, `mA:`, `V:`, `W:`, `%:`. **Every tap is commented out**, the whole
tap branch is a dead `/* ... */`. Slide left and slide right both return to
`dashKingsongOpt2`.

---

## 7. Veteran

Command table: `v2/euc/eucVeteran/eucVeteran.js`. Four screens.

```
   ride face ──left──► dashVeteran ──left──► dashVeteranOptions
                          │                        │
                  tap TR  │                 tap TR │
                          ▼                        ▼
                     dashAlerts            dashVeteranLimits
                  tap BL ─► tpmsFace
                  tap BR ─► dashVeteranModes   (when the wheel has no 1/2/3 modes)
```

### 7.1 `dashVeteran` — footer **SHERMAN** (hard-coded, see the gap list)

```
        ┌───────────────────┬───────────────────┐
        │      LIGHT        │ WATCH             │
        │  setLightOn/Off   │ ALERTS            │
        │  tap = hold       │ hold: all haptics │
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ RIDE              │
        │ tap: tpmsFace     │ SOFT/MEDIUM/STRONG│
        │ hold: on/off      │ or  45%  or  --   │
        └───────────────────┴───────────────────┘
```

The RIDE tile reads `opt.ride.mode` from byte 31 of the live frame:

| value | shown | tap |
| --- | --- | --- |
| 1 / 2 / 3 | SOFT / MEDIUM / STRONG | cycles, sends `rideSoft` / `rideMed` / `rideStrong` |
| 100-200 | `(v-100)%` | opens `dashVeteranModes` |
| undefined | `--` | opens `dashVeteranModes` |
| anything else | the raw number | opens `dashVeteranModes` |

### 7.2 `dashVeteranOptions` — footer **SHERMAN**

```
        ┌───────────────────┬───────────────────┐
        │       BEEP        │ WHEEL             │
        │ on connect AND    │ ALERTS            │
        │ on disconnect     │ tap: limits page  │
        ├───────────────────┼───────────────────┤
        │ CLEAR             │ HORN              │
        │ METER             │                   │
        │ tap: "HOLD->CLEAR"│ tap: on/off flag  │
        │ hold: clearMeter  │                   │
        └───────────────────┴───────────────────┘
```

BEEP writes `auto.onC.beep` and `auto.onD.beep` together — Veteran has no separate
connect/disconnect pages. The beep repeats the current pedal mode command
(`SETs`/`SETm`/`SETh`), because Veteran has no beep byte of its own.

### 7.3 `dashVeteranLimits` — footer **WHEEL ALERTS**, two full-width rows

```
        ┌─────────────────────────────────────┐
        │ ALERT                        50     │  alrtSpd
        ├─────────────────────────────────────┤
        │ LIMIT                        70     │  limtSpd
        └─────────────────────────────────────┘

        editor:   <   50   >    a ladder, not a free number.
                  On open it snaps to the nearest rung of the
                  ladder, because the wheel may hold a value
                  between two of them.
```

Alarm is capped at 100, limit goes to 200. Both write a CRC32 command frame
(`euc.temp.lkSet`). Displayed through `opt.unit.fact.spd` and the mph flag.

### 7.4 `dashVeteranModes` — footer **PEDAL SETTINGS**, three full-width rows

```
        ┌─────────────────────────────────────┐
        │ HARD                        45%     │  pedHard
        ├─────────────────────────────────────┤
        │ ASSIST                      20%     │  pedAsst
        ├─────────────────────────────────────┤
        │ COMP                         --     │  pedComp
        └─────────────────────────────────────┘

        editor: 0-100, tap steps 1%, hold jumps 10%.
        The touch handler has no release event, so the hold is
        one jump per press, not a repeat.
        A row whose value is undefined or 128 is unsupported on
        this wheel: it shows "--" and tapping toasts NOT ON THIS WHEEL.
        A refused write toasts WRITE REJECTED.
```

This page exists because newer Veterans (Patton, Lynx, Abrams) dropped soft/medium/hard
for three percentages.

---

## 8. Ninebot

One screen each, no sub-pages, slide left is a dead end on all three.

### 8.1 `dashNinebotZ` — footer **SETTINGS**

```
        ┌───────────────────┬───────────────────┐
        │ LIGHT         OFF │ WATCH             │
        │ tap: "NOT YET"    │ ALERTS            │
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ HORN              │
        │ tap: tpmsFace     │ tap: "NOT YET"    │
        │ hold: on/off      │                   │
        └───────────────────┴───────────────────┘
```

Both LIGHT and HORN are drawn as live tiles but their handlers are commented out and
replaced with a `NOT YET` toast.

### 8.2 `dashNinebotS` — footer **SETTINGS**

```
        ┌───────────────────┬───────────────────┐
        │ AUTO              │ WATCH             │
        │ LOCK              │ ALERTS            │
        │ opt.lock.en       │ tap: dashAlerts   │
        ├───────────────────┼───────────────────┤
        │      RING         │    MODE:5         │
        │  euc.wri(25+HL)   │ tap: 0-9 picker,  │
        │                   │ euc.wri(30+mode)  │
        └───────────────────┴───────────────────┘
```

### 8.3 `dashNinebotE` — footer **SETTINGS**

Same four tiles as NinebotS, except AUTO LOCK writes `auto.onD.lock` instead of
`opt.lock.en`, and every command takes the extra leading `1` argument
(`euc.wri(1, 25+HL)`).

**The WATCH ALERTS tile on this screen does nothing** — the `face.go("dashAlerts",0)`
was never written. See the gap list.

---

## 9. Inmotion

Four separate menu apps over two protocol families:

| Maker string | Menu app | Protocol module | Screens |
| --- | --- | --- | --- |
| `InmotionV10` | `dashInmotionV10` | `eucInmotionV10` (V5 / V8 / V10) | 7 shipped, **3 reachable** |
| `InmotionV2` | `dashInmotionV2` | `eucInmotionV2` (V11 / V12 / V13 / V14) | 1 |
| `InmotionV11` | `dashInmotionV11` | `eucInmotionV11` | 1 |
| `InmotionV12` | `dashInmotionV12` | `eucInmotionV12` | 1 |

`dashInmotionV11.js` and `dashInmotionV12.js` are **byte-identical apart from the first
comment line**. `dashInmotionV2.js` is the same screen again, reindented, with two
behavioural differences (§9.7).

`dashInmotionV2` and `eucInmotionV2` are in `v2/apps.json` only — the older
`P8-testing/apps.json` index predates them both, and `Magic-testing` has neither the app
nor a `dashScan` entry that would ask for it.

```
   ride face ──left──► dashInmotionV10 ──left──► dashInmotionV1Opt ──left──► dashInmotionV1Opt2
                            │                          │                            │
                            │ tap BL (tpms)            │ tap TR                     │ left
                            ▼                          ▼                            ▼
                        tpmsFace                  dashAlerts              "dashInmotionV1Adv"
                                                                                 no such file

   registered but unreachable:  dashInmotionV10Adv
                                dashInmotionV10AdvCalibrate
                                dashInmotionV10AdvLimits
                                dashInmotionV10AdvPass

   ride face ──left──► dashInmotionV2 / V11 / V12      (one screen, slide left buzzes)
                            │ tap TR          │ tap BL
                            ▼                 ▼
                        dashAlerts        tpmsFace
```

### 9.0 The naming split

The V10 app was renamed from `dashInmotionV1*` to `dashInmotionV10*` and **only the
storage names moved**. What each screen navigates to, versus what `v2/apps.json`
registers:

| `face.go(...)` target in the code | Registered as | Result |
| --- | --- | --- |
| `dashInmotionV10` | `dashInmotionV10` | ok |
| `dashInmotionV1Opt` | `dashInmotionV1Opt` | ok |
| `dashInmotionV1Opt2` | `dashInmotionV1Opt2` | ok |
| `dashInmotionV1Adv` | `dashInmotionV10Adv` | **dead** |
| `dashInmotionV1AdvCalibrate` | `dashInmotionV10AdvCalibrate` | **dead** |
| `dashInmotionV1AdvLimits` | `dashInmotionV10AdvLimits` | **dead**, and commented out too |
| `dashInmotionV1AdvPass` | `dashInmotionV10AdvPass` | **dead**, and commented out too |

A `face.go` to a name with no storage file does not throw: `eval(Storage.read(app))`
evaluates `undefined`, `face[0]` is still the **previous** page's object, and `init()`
repaints it. So slide-left on `dashInmotionV1Opt2` looks like nothing happened — but
`face.appCurr` is now `"dashInmotionV1Adv"`, and the `ew.def.off[face.appCurr]` screen
timeout is being read from a key that will never exist.

The `Magic-testing` copy has the **mirror** problem: its code still says
`dashInmotionV1`, `dashInmotionV1Opt`, `dashInmotionV1Opt2` throughout, while
`v2/apps.json` registers that set as `dashInmotionV10`, `dashInmotionV10Opt`,
`dashInmotionV10Opt2`. On a DK08 / DSD6 the **whole** Inmotion chain is dead from the
first hop, including the root's own wake page.

### 9.1 `dashInmotionV10` — footer **ACTIONS**

Not the same four tiles as the other Inmotions. There is no WATCH ALERTS and no HORN
here; both live one page in.

```
        ┌───────────────────┬───────────────────┐
        │ LIGHT             │ VOLUME            │
        │ ON                │ 60                │
        │ tap: 0 <-> 1      │ tap: editor 0-100 │
        │  setLights        │  setVolume        │
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ OFF               │
        │                   │                   │
        │ tap: tpmsFace     │ tap: "HOLD ->"    │
        │ hold: on/off      │ hold: power off   │
        └───────────────────┴───────────────────┘
```

- LIGHT is the only Inmotion tile anywhere that is seeded from the wheel:
  `eucInmotionV10.js:114` reads `opt.lght.HL` out of byte 99 of the info frame.
- VOLUME opens the full-screen `face.menu.full` editor. Tap the **left** half above
  y=170 to step down 10, the **right** half to step up 10, anywhere below y=170 to leave.
  Every step sends `setVolume` immediately — there is no commit. Range 0-100, and 0
  renders as `MUTE`. The wheel reports the value in hundredths (`(hi<<8|lo)/100`) and
  `setVolume` multiplies by 100 again, so the two agree.
- The VOLUME tile is blue when audible and **red-orange when muted**.
- OFF holds to `euc.temp.aOff=1; euc.tgl()`, which makes the disconnect sequence send
  `control 5` (power off) instead of the normal teardown.
- The hold-to-disable branch of the TPMS tile calls `btn()` **with the leading `bt`
  argument missing** (`dashInmotionV10.js:217`), so the tile is not repainted. Every
  other maker passes `btn(0,"TPMS",...)` there. See the gap list.

### 9.2 `dashInmotionV1Opt` — footer **OPTIONS**

```
        ┌───────────────────┬───────────────────┐
        │ LED               │ WATCH             │
        │ RING              │ ALERTS            │
        │ tap: control 15/16│ tap: dashAlerts   │
        │                   │ hold: all haptics │
        ├───────────────────┼───────────────────┤
        │ SENSOR            │ HORN              │
        │ LIFT              │                   │
        │ tap: sethandle    │ tap: on/off flag  │
        │       Button 1/0  │ hold: sound 1-22  │
        └───────────────────┴───────────────────┘
```

- LED RING and SENSOR LIFT are **write-only**: nothing in `eucInmotionV10.js` decodes
  either back, so the tiles show the last thing the watch sent, not what the wheel has.
- HORN sets `opt.horn.en` for `handler_btn.js`. Unlike Begode, this one works — all four
  Inmotion modules implement `hornOn` / `hornOff` by firing `playSound` with
  `opt.horn.mode`.
- The hold-HORN sound picker plays each sound as you scroll, 1-22. It calls
  `face.menu.full`, which is installed by **`dashInmotionV10.js`** under `if (!face.menu)`
  and not by this file. Every other Inmotion screen carries its own `face[0].menu`.
- WATCH ALERTS goes to the shared `dashAlerts`, which shows Inmotion only its four
  haptic tiles — its wheel-alarm page is gated to Kingsong, Begode and Veteran
  (`dashAlerts.js:26`, `:365`).

### 9.3 `dashInmotionV1Opt2` — footer **MORE**

```
        ┌───────────────────┬───────────────────┐
        │ AUTO              │      (empty)      │
        │ LIGHT             │                   │
        │ tap/hold: toggle  │ tap: buzz 40      │
        ├───────────────────┼───────────────────┤
        │ AUTO              │      (empty)      │
        │ OFF               │  but it lights up │
        │ tap/hold: toggle  │ tap: buzz 40      │
        └───────────────────┴───────────────────┘
```

- AUTO LIGHT (`auto.onC.HL`) does two things: on connect it re-sends the stored light
  state, on disconnect it turns the lights off.
- AUTO OFF (`auto.onD.off`) makes a normal disconnect power the wheel down.
- Top-right is a dead grey tile; the commented-out code behind it was a second WATCH
  ALERTS.
- Bottom-right is drawn with **no text at all** but is still coloured from
  `auto.onC.lift` — a tile that changes colour for a flag the rider can neither read nor
  set. The commented-out code behind it was AUTO LIFT.

### 9.4 `dashInmotionV10Adv` — footer **ADVANCED** (unreachable, §9.0)

```
        ┌───────────────────┬───────────────────┐
        │ MODE              │                   │
        │ COMFORT           │     CALIBRATE     │
        │ tap/hold:         │ tap: Calibrate    │
        │  setRideMode      │       (dead name) │
        ├───────────────────┼───────────────────┤
        │ WHEEL             │                   │
        │ ALERTS            │       PASS        │
        │ tap: buzz 40      │ tap: buzz 40      │
        └───────────────────┴───────────────────┘
```

Both bottom tiles are painted blue — the colour this codebase uses for a live value or a
selected control — and both handlers are commented out. MODE reads `opt.ride.mode` from
the info frame (`eucInmotionV10.js:197`) and labels it `COMFORT` / `CLASIC` (sic).

### 9.5 `dashInmotionV10AdvCalibrate` (unreachable, §9.0)

Two states in one file.

1. **Pedal tilt.** A large `opt.ride.pTlt` between a `<` and a `>` bitmap. Tap left of
   x=120 to step down, right to step up, and **each step sends `setPpedalTilt` with no
   clamping** (`:126-131`) — the command comments its range as -80..+80
   (`eucInmotionV10.js:35`) and nothing enforces it. The bottom strip reads
   `START CALIBRATION`.
2. **The instruction card.** Five numbered steps, then a green `START` that sends
   `calibration` and a blue `CANCEL`.

`CANCEL`, slide-right and the wake page all go to `dashInmotionV1Adv`, so even if the
page were reachable the only way back would be slide-down to the ride face.

### 9.6 `dashInmotionV10AdvLimits` / `dashInmotionV10AdvPass` (unreachable, §9.0)

These two are not Inmotion screens. They are a pre-rename fork of
`dashKingsongAdvLimits.js` and `dashKingsongAdvPass.js` — ~630 lines shipped to the watch
and never opened. What is still Kingsong inside them:

| In the file | Exists for Inmotion? |
| --- | --- |
| `euc.wri("setSpeedLimits")` — on slide down, slide right, and after every edit | no. `eucInmotionV10` has `speedLimit`, one value |
| three speed alarms plus tiltback | no. Inmotion has a single speed limit |
| `euc.wri("passClear")`, `"passChange"`, `"passSet"` | no. And Kingsong itself renamed these to `setPassClear` / `setPassChange` / `setPass` |
| `euc.dash.limt[b]`, `euc.dash.limt.en[b]`, `euc.dash.lim[...]`, `euc.dash.limE[2]` | **none of these objects exist anywhere in the tree** — the editor would throw on open |

`dashInmotionV10AdvLimits` also wakes into `dashInmotionV10` rather than into its parent.

### 9.7 `dashInmotionV2` / `dashInmotionV11` / `dashInmotionV12` — footer **SETTINGS**

One screen, no sub-pages, no page-position bar. Slide left buzzes.

```
        ┌───────────────────┬───────────────────┐
        │ LIGHT             │ WATCH             │
        │ ON                │ ALERTS            │
        │ tap: lightsOn/Off │ tap: dashAlerts   │
        ├───────────────────┼───────────────────┤
        │ TPMS      32      │ HORN              │
        │                   │                   │
        │ tap: tpmsFace     │ tap: on/off flag  │
        │ hold: on/off      │ hold: sound 1-30  │
        └───────────────────┴───────────────────┘
```

- The sound picker runs 1-30 here against V10's 1-22.
- `opt.lght.HL` is **never decoded** by any of these three modules. The tile is a
  watch-side latch that reads `OFF` after every reconnect whatever the wheel is doing.
- On V11 and V12 the light is forced **off on every disconnect**
  (`eucInmotionV11.js:240`, `eucInmotionV12.js:229`) and re-sent on connect,
  unconditionally — the behaviour V10 puts behind its AUTO LIGHT tile, with no tile. V2
  does neither.
- A tap that lands on no tile buzzes `[30,50,30]`, the accept buzz, where §2.2 says a
  refused tap buzzes `40`. Not unique to Inmotion — `dashBegodeAdv`, `dashBegodeOpt`,
  `dashKingsongAdv` and `dashKingsongAdvCalibrate` do it too.
- `face[0].set` is cleared in `init()` and tested in two handlers, and nothing ever sets
  it — leftover from whatever this screen was forked from, along with the
  `drawLine(120,0,120,97)` cleanup that goes with it.
- **V2 only:** `init()` sets `euc.is.busy=1` ("stop bt loop-accept commands") and no exit
  path clears it. On V11/V12 every exit does `euc.is.busy=0; euc.wri("live")`. It is inert
  today because `eucInmotionV2.js` never reads `euc.is.busy` — it uses `euc.tout.busy` —
  so this is a trap for whoever wires the flag up next, not a live bug.

### 9.8 What the Inmotion protocols can do that no menu reaches

`eucInmotionV2` / `V11` / `V12` carry a large command table. Four tiles reach two of it.

| Command | Reachable from a menu? |
| --- | --- |
| `lightsOn` / `lightsOff` | yes, the LIGHT tile |
| `playSound` | yes, the HORN tile and the side button |
| `drlOn`/`Off`, `fanOn`/`Off`, `fanQuietOn`/`Off` | **no** |
| `liftOn`/`Off`, `lock`/`unlock`, `transportOn`/`Off` | **no** |
| `rideComfort` / `rideSport`, `performanceOn`/`Off` | **no** |
| `remainderReal`/`Est`, `lowBatLimitOn`/`Off` | **no** |
| `usbOn`/`Off`, `loadDetectOn`/`Off`, `mute`/`unmute` | **no** |
| `calibration`, `speedLimit`, `pedalTilt`, `pedalSensitivity` | **no** |
| `setVolume`, `setBrightness` | **no** |

On the V10 side the table is smaller and the menus cover more of it, but `alert`,
`pincode`, `speedLimit`, `setBrightness` and `setPedalSensitivity` have no tile, and
`setPpedalTilt` / `calibration` only have one on the unreachable page.

Two of these are already decoded and simply not drawn: `eucInmotionV2.js:143-153` parses
the wheel's own speed limit into `alrt.spd.max` and its volume into `opt.snd.vol` on
every poll, and neither appears on the V2 screen. That parser is also gated on
`euc.dash.info.get.modl == "V11"`, so a V12/V13/V14 running the V2 module never reaches
it at all.

Two are wrong rather than missing: `setPpedalTilt` (`eucInmotionV10.js:35`) and
`setPedalSensitivity` (`:40`) build the **identical frame**, and `proxyInmotionV2.js`
exists in the tree but is listed in neither `apps.json`, so it never ships.

---

## 10. What each maker actually has, side by side

| | Begode | Kingsong | Veteran | Ninebot Z / S / E | Inmotion V10 | Inmotion V2 / V11 / V12 |
| --- | --- | --- | --- | --- | --- | --- |
| screens | 8 | 13 | 4 | 1 | 3 reachable, 4 more shipped | 1 |
| head light | on / off / strobe | on / auto / off + watch CITY | on / off | **not implemented** / — / — | on / off | on / off, never read back |
| LED | 0-9 mode | ride LED on/off | — | ring on/off (S, E) | ring on/off | **no tile** |
| pedal mode | soft / med / hard | hard / med / soft | soft/med/strong **or** 3 percentages | 0-9 (S, E) | comfort / clasic, **unreachable page** | **no tile** (`rideComfort` / `rideSport` exist) |
| roll angle | low / med / high | — | — | — | — | — |
| calibrate | yes | yes, + manual tilt | — | — | yes, **unreachable page** | **no tile** (`calibration` exists) |
| wheel speed alarms | mode + tiltback | 3 alarms + tiltback | alert + limit | — | Kingsong page, **unreachable and broken** | **no tile** (`speedLimit` exists) |
| lock | — | lock / unlock / pass | — | auto lock (S, E) | Kingsong page, **unreachable and broken** | **no tile** (`lock` / `unlock` exist) |
| volume | 1-9 | via voice mode | commands exist, **no UI** | — | 0-100 | **no tile** (`setVolume` exists; V2 even decodes it) |
| idle power off | read only | set, 60 s - 4 h, + off now | — | — | hold OFF tile to power down now | — |
| on connect / disconnect | light, LED, beep | light, LED, lift, voice, unlock once / auto off, auto lock | beep only | — | auto light, auto off | light forced off on disconnect, **no tile** (V11, V12 only) |
| horn (side button) | flag only, **no command** | yes | yes | **not implemented** | yes, sound 1-22 | yes, sound 1-30 |
| TPMS | yes | yes | yes | yes (Z only) | yes, **hold repaint is broken** | yes |
| watch alerts | yes | yes | yes | yes (Z, S; **broken on E**) | yes, haptics only | yes, haptics only |
