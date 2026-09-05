# Begode: eucWatch vs WheelLog

Audit of `v2/euc/eucBegode/eucBegode.js` + the `dashBegode*` screens (dash paths below
are from `P8-testing/dashBegode/`) against WheelLog's
`app/src/main/java/com/cooper/wheellog/utils/GotwayAdapter.java`.

Reference checkout: `C:\SampleProjects\Wheellog`. Audited 2026-09-04 on branch
`FixForSlowResponse` @ 3a5e56ff.

## What already agrees

The command byte table is correct. Every opcode matches WheelLog: `b/Q/E/T`, alarm
modes `o/u/i/I`, pedals `s/f/h`, roll angle `>/=/<`, `g/m`, `c y`, `W Y`, `W B`, `W M`.
The frame-4 bitfield decode (`>>13` pedals, `>>10` alarms, `>>7` angle, `&1` miles),
the 8 fault-alarm bit names, and the PWM sourcing rule (frame 7 wins, else frame 0
tenths-of-percent on CF/BF firmware) all agree.

Pedal-mode ordering is right too. WheelLog's `2 - pedalsMode` only converts to its own
inverted list index — raw 0 really is SOFT, which is what `dashBegodeAdv.js` assumes.

Voltage scaling: eucWatch's linear `pack/16` is fine, and arguably better than
WheelLog's table (WheelLog's index 3 is 117.6 V but uses scaler 1.738 = 116.8 V, and
its `getCellsForWheel` returns 32 cells for that entry instead of 28).

## 1. No `lock_Changes` — settings bounce back — FIXED

Most likely cause of "the setting didn't stick".

WheelLog sets `lock_Changes = 2` (5 for the multi-byte ones) after every setting write,
and frame decode skips applying wheel state while it is non-zero:

```java
if (lock_Changes == 0) { appConfig.setPedalsMode(...); ... } else { lock_Changes -= 1; }
```

The wheel needs a couple of frames to reflect a change. eucWatch has no equivalent:
`dashBegodeAdv.js:96` sets `euc.dash.opt.ride.mode=1` optimistically, and `pck4`
(`eucBegode.js:243`) overwrites it from the wheel ~200 ms later with the old value. The
`show()` loop repaints the old label, and because the tap handler branches on the
current value, the next tap sends the wrong command.

Same pattern at:

- `dashBegodeAdvLimits.js:124-139` — alarm mode
- `dashBegodeAdvLimits.js:178`, `:200` — tiltback speed
- `dashBegode.js:137-142` — lights
- `dashBegodeOpt2.js:199` — volume

Cheapest fix matching WheelLog: a `euc.temp.lock` counter decremented in `pck4`/`pck0`,
set to 2 by `euc.wri` on any setting command.

## 2. Multi-byte commands sent back-to-back with no spacing — FIXED

WheelLog deliberately spreads these over hundreds of ms, because the wheel sits behind
a serial-to-BLE bridge with no flow control:

```java
// updateMaxSpeed:      b, +100ms W, Y, +300ms hh, ll, +500ms b, b
// updateLedMode:          +100ms W, M, +300ms param, b
// updateBeeperVolume:     +100ms W, B, +300ms param, b
// wheelCalibration:    c, +300ms y
```

`eucBegode.js:383-389` chains all four writes in one immediate promise chain.
`calibrate` (`eucBegode.js:33`) sends `c` and `y` with no gap at all — WheelLog uses
300 ms there, and that is the one most likely to silently not take. Tiltback, volume
and LED are the same shape.

WheelLog also sends a trailing `b` after the parameter bytes on `W...` commands;
eucWatch never does.

## 3. `euc.wri` silently drops the second command — FIXED

```js
if (euc.tout.busy) { clearTimeout(euc.tout.busy); euc.tout.busy=setTimeout(...,150); return; }
```

Any command inside 100 ms of the previous one is dropped *and extends the lockout*.
Combined with #2 this means a rapid double-tap on any settings button loses the second
command with no feedback. It also breaks connect-time init — see #4.

## 4. LED-on-connect is dead code — FIXED

`eucBegode.js:283` and `:304`:

```js
return euc.wri(euc.dash.auto.onC.led?("ledMode",euc.dash.auto.onC.led-1):"none");
```

`("ledMode", x)` is the comma operator — it evaluates to `x`, so this calls
`euc.wri(0)` with a number as the command name, `euc.cmd` hits `default: return []`,
and nothing is sent. `eucKingsong.js:506` has it right:
`c.writeValue(euc.cmd("setLedRideOnOff", euc.dash.auto.onC.led - 1))`.

Second problem on the same line: it uses `euc.wri` rather than `c.writeValue`, and
`euc.tout.busy` was just set by the `euc.wri("start")` that called `init` — so even
after fixing the comma it would be swallowed by #3. And it returns `undefined`, so the
following `.then` does not wait for the write.

Related: `euc.cmd("none")` returns `[]` and `eucBegode.js:280` passes that straight to
`c.writeValue([])`, inside a chain ending in `.catch(euc.off)` — if Espruino rejects a
zero-length write, that disconnects the wheel. WheelLog simply sends nothing.

## 5. Phase current is 10x low

```js
euc.dash.live.amp = data.getInt16(10)/1000;   // eucBegode.js:207
```

WheelLog treats frame-0 offset 10 as hundredths of an amp (`setPhaseCurrent(raw)`, and
its internal unit is A x 100); the protocol comment in the adapter says the same.
`eucKingsong.js:217` and `eucInmotionV11.js:174` both use `/100`. The downstream
thresholds in the very same function assume real amps
(`euc.dash.live.amp <= -0.5 || 15 <= euc.dash.live.amp`), which can never fire at
`/1000`. Looks like it should be `/100`.

Side note, different wheel: `eucVeteran.js:61` uses `/100` where WheelLog's Veteran
adapter does `raw * 10` into an A x 100 unit, i.e. `/10`. Worth a look.

## 6. Field-width mismatches in frame 4 / frame 0 — LED and light FIXED, volume open

| Field | WheelLog | eucWatch |
| --- | --- | --- |
| LED mode | `buff[13] & 0xFF` | was `data.getUint16(12)`, now `getUint8(13)` |
| Light mode | `buff[15] & 0x03` | was `getUint8(15)` unmasked, now `& 0x03` |
| Volume | not parsed (14-17 documented "unknown") | `data.getUint16(16)` — still as-is |

The LED one read byte 12 into the high half; it only agreed while byte 12 was zero. The
light one is what `dashBegode.js:40-41` indexes with (`val[HL]`, `HL==2`), so any stray
high bit gave an undefined label and a broken strobe state.

The volume read is the one that cannot be verified against WheelLog at all — in the
sample frame in WheelLog's protocol comment, bytes 16-17 are `FF F8`, not a 1-9 volume.
It is left alone on purpose. **Needs checking on real hardware**: what is
`dashBegodeOpt2` actually displaying?

## 7. `param / 10` is not integer division — FIXED

```js
case 'tiltbackSpeed': return [87, 89, param / 10 + 48, param % 10 + 48];  // :36
case 'pwmLimit':      return [87, 80, param / 10 + 48, param % 10 + 48];  // :37
```

For an odd tens digit (tiltback 45 -> `52.5`) this hands a float to `writeValue` and
relies on Espruino truncating rather than rounding. Java's
`(byte)((maxSpeed / 10) + 0x30)` is unambiguous. Use `Math.floor(param/10)+48`.

## 8. Firmware/model fetch is single-shot

WheelLog retries `V` then `N` every 40 ms for up to 50 attempts, matches with
`dataS.startsWith(...)` over the whole chunk, and falls back to `fw = "-"` with
`hwPwm = false` if nothing answers.

eucWatch sends each once at connect (`eucBegode.js:285-291`) and matches on
`getUint32(0) == 0x4E414D45` / `getInt16(0)`, which requires the reply to land at
offset 0 of a single BLE notification. One lost write or a fragmented reply and
`info.get.firm` stays empty forever — which also means `euc.temp.hwPwm` never gets set,
so hardware PWM mode silently reports 0.

## 9. Gaps (features, not bugs)

- **SmirnoV / Alexovik (`BF`) firmware is mis-parsed.** `euc.temp.firm`
  (`eucBegode.js:104`) accepts `0x4246` and sets `hwPwm`, but `pck0` then uses the
  MPU6050 temperature formula (should be `/333.87 + 21.0`), reads offset 8 as trip
  distance (it is battery current on that firmware), and does not apply the x10
  phase-current scale. WheelLog branches on `bIsAlexovikFW` throughout. Either handle it
  or drop `0x4246` from `firm()`.
- **Frame `0xFF`** (Alexovik advanced: extreme mode, braking current, PID factors,
  rotation control) — not decoded at all.
- **Frame 1 BMS** — eucWatch reads only `pwmLimit` at offset 2 (`:228`, and that value
  is never used); no cells, no `autoVoltage`.
- **`pwmLimit` command** (`:37`) is defined but never called from anywhere; WheelLog has
  no equivalent either.
- **Miles/km toggle** — commands exist (`:31-32`), `euc.dash.opt.unit.mile` is decoded
  (`:246`), but no screen sets it.
- **Strobe guard** — WheelLog blocks strobe when alarm mode is `I` (Freestyl3r uses
  strobe for its PWM tiltback warning). `dashBegode.js:142` has no such check, so STROBE
  and PWM TILT will fight each other.

## Status

Done: #1, #2, #3, #4, #6 (LED and light widths) and #7 — module 1.83, dash 1.81.

Left: #5 phase current scale, #6's volume read (needs a real wheel to confirm what
bytes 16-17 carry), #8 single-shot firmware/model fetch, #9 feature gaps.
