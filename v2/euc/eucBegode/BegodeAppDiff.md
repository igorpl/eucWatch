# Begode: eucWatch vs the official Begode app

Second audit pass on `v2/euc/eucBegode/eucBegode.js` + `P8-testing/dashBegode/*`, this
time against the **manufacturer's own app** rather than WheelLog. Audited 2026-09-05.

Sources, in the order they were trusted:

| Source | Path | State |
| --- | --- | --- |
| Begode app (official) | `C:\SampleProjects\Begode\BGD-latest` | dex, **unobfuscated**, `com.euc.android.protocol` |
| WheelLog | `C:\SampleProjects\Wheellog` | source, `GotwayAdapter.java` |
| EUC World 2.66 | `C:\SampleProjects\EucWorld` | dex, obfuscated; `res/xml/preferences_wheel_gotway*.xml` is readable |
| Real frames | `v2/euc/eucBegode/begexample.txt` | 196 frames off a stock P8, types 0 and 4 only |

The Begode app is a Compose rewrite and its protocol layer is a clean set of named data
classes — `WheelCommandBuilder`, `WheelProtocolParser`, `Packet{0,1,2,3,4,7}Telemetry`.
It is the best-documented Begode source of the three. Where it and WheelLog disagree, the
capture was used to break the tie.

Decompiled with the jadx already installed for the Veteran work:
`C:\SampleProjects\EucWorld\tools\jadx\bin\jadx.bat -d <out> --no-res --no-debug-info
classes4.dex classes5.dex classes8.dex`. The protocol lives in `classes8.dex`.

## 0. Nothing here is a regression from the untested changes

Two things the previous pass changed on WheelLog's authority were re-checked against the
capture, and both stand:

- **Phase current `/100`** (`eucBegode.js:238`). The Begode app reads frame 0 offset 10 as
  `signed / 1000`, which would have made the earlier `/1000` right. The capture settles
  it: a stationary, idling P8 reports 50-110 there, i.e. **0.5-1.1 A at `/100`** and
  0.05-0.11 A at `/1000`. An idling Begode does not draw 70 mA. `/100` is right, and
  matches WheelLog's `mPhaseCurrent / 100.0`.
- **LED mode from byte 13, light mode from byte 15.** The app agrees (`ambientLightModeRaw`
  low byte, `headlightAndStateRaw & 0xFF`). See #6 for what is still wrong about the light one.

## 1. Frame 1 is a full BMS frame, and it carries the wheel's *measured* pack voltage

`eucBegode.js:266` reads one field out of frame 1 and nothing else. The app's
`Packet1Telemetry` names all eight channels:

| Offset | App field | Meaning |
| --- | --- | --- |
| 2 | `powerAlarmRaw` | the `W P` power alarm setting, 50-90 % — see #2 |
| 4 | `rideSpeedRaw` | the `W Y` tiltback speed setting |
| 6 | `actualVoltageTimes10` | **measured pack voltage x 10** |
| 8 | `batteryCurrentTimes10` | BMS current x 10, signed |
| 10 | `batteryTemp1Raw` | whole °C, signed |
| 12 | `batteryTemp2Raw` | whole °C, signed |
| 14 | `packVoltageRaw` | this group's voltage |
| 16 | `batteryInfoRaw` | MOS state, protection state, balance flags, charge/discharge |

Byte 19 is the BMS group index, 0-3.

Offset 6 is the find. eucWatch derives voltage from frame 0 with a user-set scaler:

```js
euc.dash.live.volt=(data.getUint16(2)*(euc.dash.opt.bat.pack/16))/100;   // :218
```

so battery percent is only as right as the cell count the user typed into Dash Options.
Frame 1 offset 6 is the wheel's own number — no scaler, no guess. WheelLog agrees exactly:
`if (autoVoltage) wd.setVoltage(batVoltage * 10)` with its voltage in V x 100. This is the
highest-value item in this document. It makes the pack setting a fallback rather than the
source of truth, on any wheel that sends frame 1.

Battery current at offset 8 is also a real measurement eucWatch currently has no source for.

Unresolved: offset 14. WheelLog reads it `/10` as a half-pack voltage, the app reads it
`/100` as a group voltage. Neither is checkable without a multi-BMS wheel on the bench, and
nothing depends on it yet.

## 2. `W P` is a real setting — the command deleted as dead

eucBegode 1.85 removed `pwmLimit` (`[87, 80, ...]` = `W P`) on the grounds that it was never
called and WheelLog has no equivalent. Both halves were true; the conclusion was not. All
three of the other sources have it:

- Begode app: `SetPowerAlarm`, `W P` + two decimal digits, **clamped 50-90, stepped by 5**.
- EUC World: `gw_safety_margin_alarm`, 10-50 %, default 20. That is `100 - alarm`: margin
  10 % is alarm 90 %, margin 50 % is alarm 50 %. Same setting, complementary scale.
- The readback is frame 1 offset 2, which eucWatch already parses into
  `euc.dash.alrt.pwm.val` and then never displays.

So the wheel-side PWM alarm threshold is readable today and was writable until 1.85. It
wants the command back and a screen — it is the Begode equivalent of the Veteran pedal
tilt settings, and on stock firmware it is the only overload protection the wheel has.

## 3. Frame 7 has a battery current and three more settings

`euc.temp.pck7` (`eucBegode.js:269`) reads offsets 6 and 8 and drops the rest.

| Offset | App field | WheelLog | eucWatch |
| --- | --- | --- | --- |
| 2 | `phaseCurrentRaw` /100 | `batteryCurrent`, used as `setCurrent(-raw)` | not read |
| 4 | `advancedConfigRaw` | not read | not read |
| 6 | `motorTempRaw`, whole °C | `setTemperature2` | `euc.dash.live.tmpM` ✓ |
| 8 | `pwmOutputRaw`, whole % | `setOutput(raw*100)` | `euc.temp.pwmSet` ✓ |

Offset 2 is a measured current at a fixed `/100` — the app and WheelLog agree on the scale
and disagree only on the name and the sign (WheelLog negates it). It is a better current
source than frame 0 offset 10 on any wheel that sends frame 7, which is everything with
main board firmware after 09.2024.

Offset 4 packs three settings:

```
advancedConfigRaw & 0x000F    tilt close level      0-9   <- W X
advancedConfigRaw >> 4 & 0xF  field weakening level 0-9   <- W C
advancedConfigRaw >> 8 & 0x1F current limit level   0-9   <- W l
```

EUC World confirms the middle one by name: `gw_field_weakening`, 0-9, default 0.

## 4. Six settings commands eucWatch does not have at all

Straight out of `WheelCommandBuilder.build()`. All of them are `W` + a selector + one ASCII
digit, the same shape as the `ledMode` and `volume` commands already in `euc.cmd`:

| App name | Bytes | Range | Readback | EUC World key |
| --- | --- | --- | --- | --- |
| `SetPowerAlarm` | `W P` + 2 digits | 50-90 step 5 | frame 1 off 2 | `gw_safety_margin_alarm` |
| `SetAngleCompensation` | `W R` + digit | 0-9 | frame 0 off 14, bits 10-13 | `gw_pedals_tilt` (likely) |
| `SetTiltClose` | `W X` + digit | 0-9 | frame 7 off 4, bits 0-3 | `gw_pedals_dip` (likely) |
| `SetWeakMagnetic` | `W C` + digit | 0-9 | frame 7 off 4, bits 4-7 | `gw_field_weakening` |
| `SetCurrentLimit` | `W l` + digit | 0-9 | frame 7 off 4, bits 8-12 | — |
| `SetBridge` | `W U` + digit | 0-9 | — | — |
| `SetRunModeSwitch` | `+` `-` | toggle | frame 0 off 14, bit 0 | `gw_racing_mode` |
| `BrakeCutoffOn/Off` | `e` / `x` | toggle | frame 0 off 14, bits 3-4 | — |

`W l` is a lowercase L, not a one. The `gw_pedals_tilt` / `gw_pedals_dip` pairing to
`W R` / `W X` is inference from the ranges and the grouping, not something either app
states — worth confirming on hardware before labelling a screen with those words.

Note which ones EUC World drops on its `preferences_wheel_gotway_cf.xml` screen: racing
mode, pedals tilt, pedals dip and field weakening are all absent for Freestyl3r firmware.
These are **stock-firmware settings**, so any screen for them should be gated on
`euc.temp.hwPwm` being 0, the way the existing PWM sourcing already is.

## 5. Frame 0 offset 14 is a settings word on stock firmware

`eucBegode.js:254` reads it as tenths-of-a-percent PWM, guarded by `euc.temp.hwPwm`, so
only on CF/BF. That guard turns out to be load-bearing: on stock, the app decodes the same
word as

```
bit 0        racing mode (1) vs off-road (0)
bits 3-4     brake cutoff mode, 1 = enabled
bits 5-9     pedal adjust level, 0-31
bits 10-13   angle compensation level, 0-15
```

No conflict with the existing code — but it is four settings readbacks that are free.

Caveat: the P8 capture is from 2021 and shows a constant `0x0001` there, so it confirms
only that the field is not a PWM value on stock. The bit layout is the app's, unverified
against a modern wheel.

## 6. Light mode 3 — a real bug, reproducible from the repo's own capture

`eucBegode.js:299` masks byte 15 with `0x03` and `dashBegode.js:39` indexes a three-entry
label array with the result:

```js
euc.dash.opt.lght.HL = data.getUint8(15) & 0x03;
let val=["OFF","ON","ON"];
... val[euc.dash.opt.lght.HL] ...
```

In `begexample.txt`, byte 15 is **3** in 2 of the 99 frame-4 samples (1 in the other 97).
The mask does not help, because the raw byte already is 3. `val[3]` is `undefined`, so the
LIGHTS button renders the string "undefined", and the STROBE button — which tests `HL==2` —
reads OFF while the wheel says otherwise. The previous pass added the `& 0x03` believing a
stray *high* bit was the cause; the low two bits are the problem.

WheelLog has the same hole (it stores `lightMode 3` into a three-entry spinner). The app
takes the whole byte. Cheapest fix is to keep an out-of-range value away from the label:
clamp to 0-2 on decode, or give `val` a fourth entry once someone works out what 3 means.

## 7. Frames 2 and 3 are the acks for calibrate and mode switch

`euc.temp.type` (`eucBegode.js:205`) dispatches 0, 1, 4 and 7 and ignores everything else.
Frames 2 and 3 do double duty in the app, split on the length byte 19:

- **byte 19 == 24** — a response frame. Channel 0 of frame 2 is the calibration result:
  `0` = "running, calibration rejected", `1` = started, `2` = succeeded. Channel 0 of
  frame 3 is the mode switch result: `0` = "running, mode switch rejected", `1/2/3` = S/F/H.
- **byte 19 < 7** — BMS cell voltages, 8 cells per frame, block index in byte 19, in mV.
  Frame 2 is BMS group 1, frame 3 group 2, and **frames 5 and 6 are groups 3 and 4** —
  neither eucWatch nor WheelLog decodes those two at all.

The response frames are the cheap win. `dashBegodeAdvCalibrate.js` fires `c y` and has no
way to know the wheel refused because it was rolling; `dashBegodeAdv.js` steps the ride
mode locally and assumes it took. Both are exactly the "the setting didn't stick" symptom
the last pass chased through `lock_Changes`, and the wheel has been saying so all along.

## 8. Smaller decode differences

- **Frame 4 bit widths.** The app takes three bits where eucWatch and WheelLog take two:
  ride mode `>>13 & 7`, alarm mode `>>10 & 7`, tilt gear `>>7 & 7` (`eucBegode.js:289-291`
  uses `& 0x3` for all three). Harmless while the wheel reports 0-3; it would alias 4-7.
- **Roll angle mapping is right.** `SetTiltShutdownGear` index 0/1/2 is `>` / `=` / `<`,
  which is what `dashBegodeAdv.js:115-121` sends. The app also exposes the same three bytes
  as a "reduction ratio" 60/48/45 with the mapping reversed — the app contradicts itself
  there, so ignore that second reading.
- **Ride mode 0 = Soft** is confirmed a third time (`RideMode.S` at raw 0).
- **Alarm-mode cycle is right, the names in `euc.cmd` are not.** `alertsTwo` sends `u`,
  which is WheelLog's *one* alarm, and `alertsOneTwo` sends `o`, which is *two*. The cycle
  in `dashBegodeAdvLimits.js` lands on the correct value each time, so this is cosmetic.
  Separately, the app sends `0` (0x30) where both WheelLog and eucWatch send `o` (0x6F) for
  all-alarms-on. Unexplained; do not change it without a wheel to test on.
- **Volume at frame 0 offsets 16-17** — the open question from `WheelLogDiff.md` #6. The
  app names that channel `flagsOrBeeperRaw`, and the capture holds a steady 9 there on a
  wheel whose beeper is at max. Not proof, but eucWatch's reading is consistent with both.
  Consider this closed unless the screen shows something absurd on hardware.
- **Fault bit names disagree, unresolved.** eucWatch follows WheelLog: bit 1 "high speed 2",
  bit 2 "high speed 1". The app says bit 1 = MOS fault, bit 2 = gyro fault. Bits 3-6 agree
  (low voltage, over voltage, over temperature, hall). Bit 7 is "transport mode" in
  WheelLog and `isLocked` in the app, which is the same thing. No way to settle bits 1 and 2
  from here; leave the labels alone.
- **`NAME` banner.** eucWatch does `s.slice(0,4)=="NAME"` then `s.slice(5)`, i.e. exactly one
  separator. The app uses `\bNAME\s*:\s*(.+)$`. Only matters if a wheel pads the colon.

## 9. Command pacing — the app does it differently from WheelLog

eucBegode 1.84 adopted WheelLog's approach: one byte at a time, 100 ms apart, 300 ms for
calibrate. The official app does neither of those things:

- One `BleCommandQueue` with `minIntervalMs = 200`, serialized, **nothing is ever dropped**.
- A multi-byte command is **one GATT write**: `W Y 4 5` goes out as a single 4-byte payload,
  `c y` as a single 2-byte payload.
- A settings write is followed by a `b` beep **500 ms later** as user confirmation
  (`sendRideSettingWithConfirmationBeep`, default 500 ms), not as part of the command.
- Values are clamped and snapped app-side before sending: tiltback speed to 3-90 in steps
  of 3, volume 1-9, LED 0-9, power alarm 50-90 in steps of 5.

eucWatch's queue-and-space model is closer to WheelLog and is not obviously wrong — the
100 ms spacing is a superset of the app's single write. Worth knowing that the wheel does
not require the byte spacing, though, if the connect sequence ever needs to be shorter.

The one thing worth copying outright is the clamping. `euc.cmd('tiltbackSpeed')` takes
whatever the screen hands it, and `dashBegodeAdvLimits.js` allows 0-100.

## 10. Characteristic discovery

`eucBegode.js:421-423` hardcodes service `0xffe0` / characteristic `0xffe1`. The app scores
candidates instead: notify prefers `FFE1` (100) then `FFF1` (90); write prefers `FFE1` (120),
`FFF2` (110), `FFE2` (100), `FFF1` (90). Some Begode units evidently expose the `FFF*` pair.
Not worth changing blind, but it is the first thing to check if a wheel connects and then
sends nothing.

## Suggested order of work

Nothing below has been coded. Ordered by value over effort:

1. **#6 light mode 3** — one line, fixes a visible "undefined" on hardware that exists today.
2. **#7 frames 2 and 3** — a decoder plus a notification; turns two silent failures into
   messages. No new screen needed.
3. **#1 frame 1 voltage** — use offset 6 when frame 1 arrives, fall back to the frame 0
   scaler otherwise. Fixes battery percent for anyone whose cell count is wrong.
4. **#2 `W P` power alarm** — restore the command, display `euc.dash.alrt.pwm.val`, add a
   50-90 step-5 editor. Reuse the `dashBegodeAdvLimits` tiltback editor shape.
5. **#3 frame 7 offsets 2 and 4** — current source plus three settings readbacks.
6. **#4 the six missing commands** — a new `dashBegodeAdv2` page, stock firmware only.
7. **#5 frame 0 offset 14** — readbacks for racing mode and brake cutoff, stock only.
8. **#1 / #7 BMS cells** — frames 2/3/5/6 with byte 19 < 7. Needs a screen and only pays off
   on smart-BMS wheels.
