# Veteran: eucWatch vs WheelLog

Audit of `v2/euc/eucVeteran/eucVeteran.js` + the `dashVeteran*` screens (dash paths below
are from `P8-testing/dashVeteran/`) against WheelLog's
`app/src/main/java/com/cooper/wheellog/utils/VeteranAdapter.java`.

Reference checkout: `C:\SampleProjects\Wheellog`. Audited 2026-09-05 on branch `master`
@ a21ccb3, cross-checked against every remote branch.

Protocol questions this audit could not answer from WheelLog are answered in
`VeteranProtocol.md`, decompiled from EUC World and from LeaperKim's own app.

Frame observations below are from the 116 packets in `info.txt`, a Sherman S on firmware
3012 (`mVer` 3).

## What already agrees

Voltage, speed, trip, total, temperature, pedal mode and hardware PWM all read the right
offsets at the right scale. Phase current was fixed in 2.12 and now matches WheelLog's
tenths-of-an-amp. Frame reassembly (`DC 5A 5C`, length at byte 3, body + 4-byte CRC32)
and the CRC check itself agree.

Battery percent is a different approach but a defensible one. WheelLog carries a
hardcoded voltage table per `mVer` bucket; eucWatch normalises to a per-cell figure
(`eucVeteran.js:46`) against `bat.pack` / `bat.hi` / `bat.low`. The linear version is
model-independent, which matters more here than the last percent — but see #3, it only
works if the user sets the S-count by hand.

## 1. Offset 24 is the speed alert, not average speed — CONFIRMED

```js
euc.dash.trip.avrS=(lala.getUint16(24) / 10);   // eucVeteran.js:77
```

WheelLog calls this `speedAlert`, and the capture settles it: offset 24 is `582`
(58.2 km/h) in **all 116 packets**, while speed at offset 6 takes 39 distinct values
including negatives over the same capture. An average speed cannot be constant across a
ride; a configured alert threshold is exactly that.

Nothing displays `trip.avrS` on any Veteran screen, so this is currently a wrong value
written to a field nobody reads — no visible symptom, but it will bite whoever wires up
an average-speed readout next.

The real find is that offsets 24 and 26 are the wheel's own **speed alert** and
**tiltback speed**, which `dashAlerts.js` could show and compare against the watch's own
thresholds. Neither is decoded today.

Confirmed from EUC World's decompiled parser (`VeteranProtocol.md`): offset 24 is the
speed **alarm** and offset 26 the speed **limit**, both scaled by 0.1 rather than
WheelLog's `* 10`. Offset 26 still yields 280.0 km/h on this capture, outside the 10-200
range EUC World's own UI allows, so that one field **still needs checking on real
hardware**.

## 2. Four settings-frame fields never decoded — OPEN

| Offset | WheelLog | eucWatch |
| --- | --- | --- |
| 20 | `autoOffSec` -> `setSleepTimer` | not decoded |
| 22 | `chargeMode` -> `setChargingStatus` | not decoded |
| 26 | `speedTiltback` | not decoded |
| 32 | `pitchAngle` /100 -> `setAngle` | not decoded |

The capture confirms all four are live: offset 20 counts down 3600 -> 2771 (a sleep
timer in seconds), offset 32 hovers around `6` (0.06 deg) and goes negative, offset 22 is
0 throughout on a wheel that was never charging.

Charging status is the one with an obvious home — the dash already has a charging concept
for other makes.

## 3. No model mapping, so the watch never knows which Veteran it is — DEFERRED

**Deferred on purpose, 2026-09-05.** Wanted, but not now. If it is picked up, the
automatic `bat.pack` half should stay opt-in: silently overriding a pack size the rider
set by hand would move their battery percentage without explanation.

```js
if (!euc.dash.info.get.modl) euc.dash.info.get.modl=lala.getUint16(28);   // :78
```

That stores the raw firmware number (3012) in `modl`, which nothing displays.
`info.get.firm` is never set at all, so `dashGarage.js:147` renders an empty firmware
field for every Veteran.

WheelLog derives two things from the same field: a version string
(`%03d.%01d.%02d`) and `mVer = ver/1000`, which drives a model name table — Sherman,
Abrams, Sherman S, Patton, Lynx, Sherman L, Patton S, Oryx, Lynx S, Nosfet Apex, Nosfet
Aero, Nosfet Aeon — plus `getCellsForWheel()` (24 / 30 / 36 / 42).

Consequences, all of them things the user actually sees:

- `dashVeteran.js:18` hardcodes the title **"SHERMAN"** on every Veteran, including a Lynx
  or a Nosfet.
- The battery percent noted under "What already agrees" needs `bat.pack` set by hand in Dash Options
  (`dashOptions.js:200`, the "S24" spinner). WheelLog's cell count per model would let
  the module set it automatically at connect, the way `eucVeteran.js:235` already seeds
  `bat.hi`/`bat.low` on first connect.
- Nothing can branch on wheel generation, which is what #4 and #5 both need.

Cheapest fix: keep the raw value, and add `mVer` + a name table next to it.

## 4. New wheels have no pedal modes, and the RIDE button goes blank — DECODED

New Veterans replaced soft/medium/hard with **Pedal sensitivity %**, **Dynamic assist %**
and **Pedal dip compensation %** (all three are in EUC World).

```js
let md={"1":"SOFT","2":"MEDIUM","3":"STRONG"};
this.btn(1,"RIDE",...,md[euc.dash.opt.ride.mode],...);   // dashVeteran.js:33-34
```

`euc.dash.opt.ride.mode` is `getUint16(30)`. On a new wheel that is a percentage, `md[75]`
is `undefined`, and `btn()` skips drawing when `txt2` is falsy — hence a blank button. The
same two lines are repeated in the tap and long-press handlers (`:147`, `:214`).

**SOLVED from EUC World — see `VeteranProtocol.md`.** Byte 31 is overloaded: 1/2/3 is the
legacy pedal mode, 100..200 is the sensitivity percent as `byte31 - 100`. The write side
is a CRC32-checked `L d A p` frame; all three percent settings, their slots and their
ranges are tabulated there. That also settles the 1-3 vs 0-2 question below: the wire
values are **1-3**, so the existing `md` table is correct.

**WheelLog still cannot help.** It decodes the main frame only to offset 35 and has no
command beyond `SETh`/`SETm`/`SETs`; `git log -S` and `--grep` across all history return
nothing for sensitivity, dip or assist. It does know the modes are gone —
`settings/WheelScreen.kt:1301` hides the pedals-mode list for `Nosfet Apex` and
`Nosfet Aero` — but offers no replacement. This has to be reverse engineered; see
"Getting the data" below.

Related risk on the same field:

```js
case "beep":return ["SETs","SETm","SETh"][euc.dash.opt.ride.mode-1]||"SETm";   // :6
```

With a percentage in `ride.mode` the fallback fires, so beep-on-connect sends `SETm` to a
new wheel on **every connection**. If that firmware still honours `SETm` it may be
overwriting the rider's sensitivity setting. **Needs checking on real hardware.**

Resolved: offset 30/31 carries **1-3** — 1 = soft, 2 = medium, 3 = hard. The existing
`md` table needs no change.

## 5. Only one temperature — DECODED

EUC World shows three: the IMU temperature (what eucWatch and WheelLog already display,
offset 18; the Leaperkim app calls it control board temperature), a CPU temperature, and a
third that also appears on the wheel's own screen.

WheelLog has none of the extra ones. It reads offset 18 and stops; `cpuTemp` and
`temperature2` exist in `WheelData` but only InMotion V2 fills `cpuTemp`, and Veteran's
second-page field list (`MainPageAdapter.kt:505`) contains neither.

The display side on eucWatch is already built. `P8-testing/dash/dash_digital.js:246`
`tmFF()` draws the dual-temperature layout gated on `euc.dash.info.get.makr` (Kingsong =
MOSFET/MOTOR, InmotionV10 = MOSFET/BATTERY) and reads `euc.dash.live.tmpM`. Adding a
Veteran branch with IMU/CPU labels is a few lines — the only missing piece is a source.

Solved — see `VeteranProtocol.md`. The three temperatures are:

| EUC World channel | Offset | Scale |
| --- | --- | --- |
| IMU temperature | 18 | x0.01 — this is what eucWatch already shows |
| CPU temperature | **61** | x0.01 |
| main "Temperature" | **59** on new firmware, else 18 | x0.01 |

All three come out of the `pnum` 0/4 sub-packet, gated on frame length >= 69. Offset 57 in
that block is the roll angle, not a temperature, and 69/71 are the two BMS currents.

The original AD16T reasoning below still stands as corroboration, but is no longer the
route in.

Two candidates were considered:

**CPU temperature — the wheel's string-debug output.** `euc.cmd("switchPackets")` sends
`CHANGESTRORPACK`, which flips the wheel from binary frames to the text dump captured in
`vet.txt` / `vet2.txt`. Its first two fields are:

```
1503>AD17R  1700>AD16T  3111>AD4  2038>AD3  2044>AD2  874>AD1  3>AD0
```

On every STM32 family **ADC channel 16 is the internal die temperature sensor and channel
17 is VREFINT**, matching the `T` and `R` suffixes. The standard F1 conversion on that
sample:

- VDDA = 1.20 x 4095 / 1503 = 3.27 V
- Vsense = 1700 x 3.27 / 4095 = 1.357 V
- T = (1.43 - 1.357) / 0.0043 + 25 = **~42 C**

`vet2.txt` (AD16T = 1694) gives ~43 C, against 44.25 C from offset 18 on the same wheel.
Two independent sensors within 2 C is good corroboration. Caveat: an uncalibrated STM32
sensor is spec'd +/-45 C absolute, so it is a trend unless the firmware calibrates it.

Cross-check that these names track real state: `MoS 1` in the string output equals
`pedalsMode = 1` at binary offset 30 in the same session.

The catch is that string mode **replaces** the binary telemetry, so it cannot be a live
dash source. It only proves the value exists — the binary offset is still unknown.
Offsets 36-45 are the candidates; on this Sherman S byte 36-37 is a constant `0x006F`
(111) and 38-45 are all zero, so that generation does not carry it.

EUC World corroborates the AD16T reading independently: its Veteran event-log decoder
carries `mcuTemperatureAbove105CAfter1S` / `95` / `85` and
`mcuVoltageBelow3V15After0S3` / `Above3V45` — MCU die temperature and MCU supply voltage,
exactly the two STM32 internal ADC channels. Details in `VeteranProtocol.md`.

**Third temperature — the smart BMS.** For `mVer >= 5` (Lynx, Sherman L, Oryx, Lynx S,
Nosfet) WheelLog decodes six BMS temperatures from the `pnum == 3 | 7` sub-packet at
offsets 47/49/51/53/55/57, /100. That is the most likely home for the temperature shown
on the wheel's own screen. eucWatch ignores the BMS entirely — see #6.

## 6. Smart BMS not decoded at all — OPEN (but WheelLog's offsets are confirmed correct)

LeaperKim's own app reads six temperatures per pack from `pnum` **3** (left) and **7**
(right) at offsets 47/49/51/53/55/57, signed, /100 — identical to `VeteranAdapter.java`.
Cells 31-36 at 59 + 2i /1000, cells 37-120 at 71 + 2i /1000. It also decodes `pnum` **8**,
which WheelLog marks `// new packet, TODO: to recognize`: that is the settings block, and
`VeteranProtocol.md` has the full byte map.

Original note:

Everything from byte 46 on. WheelLog demultiplexes on `pnum` at byte 46 into two BMS
banks: per-cell voltages (`pnum` 1/2/3 and 5/6/7), pack currents (`pnum` 0/4, offsets 69
and 71), and the six temperatures above. It derives min/max cell, cell number, cell
difference, pack voltage and average cell.

The Sherman S capture does emit `pnum` 0-7, but the sub-packets are truncated (most are
length 51 — the pnum byte and then straight to the CRC), which is why WheelLog gates the
whole block on `mVer >= 5`. Any real work here needs a Lynx-class capture.

This is a feature gap, not a bug, and it needs screens as well as a decoder.

## 7. Smaller mismatches — OPEN

- **Ride mode is byte 31, not the u16 at 30.** LeaperKim builds the version code from
  bytes {30, 28, 29} and reads the ride mode from byte 31 alone. `eucVeteran.js:79` uses
  `getUint16(30)`, which folds byte 30 in; it works only while that byte is zero.
- **Offset 36/37 is `batteryTempMode`**, not padding — that is the constant 111 in the
  capture.
- **Frame sanity checks.** WheelLog's unpacker rejects a frame when byte 22 is non-zero,
  byte 23 has any of bits 1-7 set, or byte 30 is not 0 or 7 (`veteranUnpacker.addChar`).
  `euc.temp.inpk` trusts the header and length alone. Low priority given the CRC, but it
  is free protection on pre-3012 firmware where the CRC is skipped.
- **CRC gating.** `checksum()` (`eucVeteran.js:24-25`) decides whether to verify by
  reading the version at offset 28 — a field inside the very frame whose integrity is
  unverified. WheelLog instead latches `usingCrc` the first time a CRC validates, and
  also treats `len > 38` as CRC-bearing. The latch is the sturdier rule.
- **Negative handling.** WheelLog has a 3-way straight/absolute/reverse
  (`gotwayNegative`) applied to **both** speed and phase current. eucWatch has
  `unit.ampR` for current only and always `Math.abs`es speed (`:52`), so a rider going
  backwards reads as forwards.

## Status

Nothing in this document has been fixed. A cosmetic fix for #4 (fallback label plus a
"SET IN THE APP" notify so the button is never blank) was drafted on 2026-09-05 and
discarded — it does not add the settings, and the real work is blocked on protocol data.

Ready to do without new hardware data:

- #1 offset 24, and decoding 26 alongside it.
- #2 sleep timer, charging status, pitch angle.
- #3 `mVer` + model name table + automatic `bat.pack`. This one unblocks the others and
  fixes the hardcoded "SHERMAN" title.
- #7 CRC latch and the frame sanity checks.

Decoded from EUC World (`VeteranProtocol.md`), needs confirming against a real wheel
before anything is written to one:

- #4 the three percent settings — read side and write side both.

Also decoded, same source:

- #5 the CPU temperature — offset 61, x0.01.

Still blocked on a capture from a new wheel:

- #1's open question about what offset 26 really contains.

Blocked on a Lynx-class wheel:

- #6 the smart BMS, including the third temperature.

## Getting the data

The MITM needed for #4 and #5 is already in the tree. `v2/euc/eucVeteran/proxyVeteran.js`
advertises the watch as `LK_<name>`, relays phone -> wheel writes through
`euc.wri("proxy", data)`, and logs them to `ew.log` when `ew.dbg` is set.

1. Put the watch in proxy mode (`ew.is.bt = 5`) and point EUC World at `LK_...` instead of
   the wheel.
2. Change Pedal sensitivity, then Dynamic assist, then Pedal dip compensation, one at a
   time. `ew.log` gives the exact command bytes for each.
3. Separately, with `ew.is.bt = 2` (BLE console), capture the binary frames before and
   after each change. Diffing offsets 36-45 pins down where they are reported back, and
   probably where the CPU temperature lives too.
