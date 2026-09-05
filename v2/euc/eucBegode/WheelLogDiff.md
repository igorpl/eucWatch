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

## 5. Phase current is 10x low — FIXED (Begode and Veteran)

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

## 8. Firmware/model fetch is single-shot — FIXED

WheelLog retries `V` then `N` every 40 ms for up to 50 attempts, matches with
`dataS.startsWith(...)` over the whole chunk, and falls back to `fw = "-"` with
`hwPwm = false` if nothing answers.

eucWatch sends each once at connect (`eucBegode.js:285-291`) and matches on
`getUint32(0) == 0x4E414D45` / `getInt16(0)`, which requires the reply to land at
offset 0 of a single BLE notification. One lost write or a fragmented reply and
`info.get.firm` stays empty forever — which also means `euc.temp.hwPwm` never gets set,
so hardware PWM mode silently reports 0.

## 9. Gaps (features, not bugs)

- **SmirnoV / Alexovik (`BF`) firmware is mis-parsed.** — FIXED. `euc.temp.alx` is now
  latched off the `BF` banner and the frames branch on it the way WheelLog branches on
  `bIsAlexovikFW`: MPU6500 temperature (`/333.87 + 21.0`), phase current at tenths of an
  amp, offset 8 left alone (it is battery current there, not trip distance), offset 16
  left alone (a trick counter, not volume), frame 1 read as riding mode, frame 4 read for
  distance only, frame 7 skipped. Battery current itself is still dropped — there is no
  field or screen for it.
- **Frame `0xFF`** (Alexovik advanced: extreme mode, braking current, PID factors,
  rotation control) — not decoded at all. This is where BF keeps its settings, so a BF
  wheel currently shows no wheel settings at all. Needs a screen as well as a decoder.
- **Frame 1 BMS** — eucWatch reads only a pwm limit at offset 2 (and that value is never
  used); no cells, no `autoVoltage`.
- **Dead commands** — REMOVED. `pwmLimit` was defined and never called, and WheelLog has
  no equivalent. `fetchGreet` was also never called and was the same byte as
  `speedKilometers` (`103`, `g`), so wiring it up later would have silently switched the
  wheel to km.
- **Miles/km toggle** — WON'T DO, nothing to fix. `euc.dash.opt.unit.mile` is bit 0 of
  frame 4 and the `g`/`m` commands write it, but it is a *wheel* setting: WheelLog calls
  it "Switch controller in Miles" and it changes what the wheel's own display and voice
  announcements use. It does **not** change the units in the BLE frames — WheelLog
  decodes speed as `signedShort(4) * 3.6` and distance in metres either way, and its
  `gwInMiles` is never read back into any conversion. What the watch shows is already
  driven entirely by `ew.def.dash.mph` in Dash Options, which is correct as it stands.
  Converting from `unit.mile` would be wrong: there is nothing to convert. The decode
  stays as a mirror of wheel state; the `g`/`m` commands stay in case someone later
  wants to change the wheel's own display from the watch, which is the only thing such a
  button would buy.
- **Strobe guard** — FIXED. `dashBegode.js` now refuses to turn strobe on while alarm
  mode is `I`, because Freestyl3r drives strobe itself as its PWM tiltback warning.
  Turning strobe back off is always allowed.

## Status

Done: #1, #2, #3, #4, #5, #6 (LED and light widths), #7, #8, and in #9 the Alexovik
frames, the strobe guard and the dead command removal — eucBegode 1.85, euc 1.81,
eucVeteran 2.11, dash 1.82.

Closed without a change: #9 miles/km, see that bullet.

Left, both needing either a real wheel or new UI:

- #6's volume read. Bytes 16-17 of frame 0 are `FF F8` in WheelLog's own sample, not a
  1-9 volume, and WheelLog does not parse them at all. **Needs checking on real
  hardware**: what is `dashBegodeOpt2` actually displaying?
- #9 frame `0xFF` — the Alexovik settings frame. Decoding it is straightforward; it also
  needs a screen, because none of the existing ones map onto those fields. Until then a
  BF wheel shows no wheel settings at all.
- #9 frame 1 BMS — cells and `autoVoltage`.

Noted while auditing, not acted on: the watch converts km to miles with `0.625` rather
than `0.6214`, about 0.6% high (50 km/h shows 31.25 instead of 31.07 mph). It is used
consistently across every dash and alert screen, so changing it is a judgement call
rather than a bug fix.
