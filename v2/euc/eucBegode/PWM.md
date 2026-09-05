# Begode hardware PWM

Reference for how `eucBegode.js` produces `euc.dash.live.pwm`, and why it does it three
different ways. Ported from WheelLog (`GotwayAdapter.java`, `WheelData.java`).

## The problem

The dashboards `dash_pwm` (full-screen PWM face) and `dash_digital` (small PWM + session-max
widget) read `euc.dash.live.pwm` as an integer percent 0-100, and `euc.dash.trip.pwm` as the
session maximum. `euc.temp.hapt()` raises the haptic alarm off the same field.

Kingsong and Veteran fill those directly:

| Wheel | Where | Wire unit |
|---|---|---|
| Kingsong | frame `0xF5`, byte 15 (`eucKingsong.js`) | whole percent |
| Veteran | uint16 BE at offset 34 (`eucVeteran.js`) | 0.01 % |

Begode had nothing. `euc.temp.type` dispatched only frame types `0`, `4` and `1`, and none of
them touched `live.pwm`. The only Begode PWM came from a workaround in `dash_pwm.js`: it sent
command `107` (`'k'`) to put the wheel into its ASCII debug stream and swapped the whole BLE
notification handler over to `euc.temp.extd`. While that mode was on the binary frames stopped,
so trip, current, fault alarms, haptics and the phone proxy all went dead, and `trip.pwm` was
never written. Because of that, `dash_digital.js` and `dashAlerts.js` deliberately excluded
Begode from the PWM UI.

## Frame layout

Begode frames are 24 bytes: `55 AA` header, `buff[18]` = frame type, `buff[19]` = sub-index,
`5A 5A 5A 5A` footer, no checksum, all multi-byte values big-endian. `euc.temp.type` already
built exactly this 24-byte view with the same offsets, so no reframing was needed.

Raw examples are in `begexample.txt`.

## The three PWM sources

In priority order. All of them funnel through `euc.temp.pwmSet()`, which rounds, clamps to
0-100 and tracks the session max, mirroring what Kingsong and Veteran do inline.

### 1. Frame `0x07`, bytes 8-9 — modern stock firmware

Sent unprompted by main boards with firmware after roughly 09.2024. Signed int16, **whole
percent**. Handled by `euc.temp.pck7`, which also reads motor temperature from bytes 6-7 into
`live.tmpM`.

Detection is purely at runtime: `euc.temp.tPwm` latches on the first frame whose PWM field is
non-zero and then stays set, which is WheelLog's `truePWM`. There is no firmware check. The
magnitude is used, so braking (negative) PWM shows as a positive duty — note the sign
convention here is inverted relative to frame A.

Once latched, source 2 and source 3 are both skipped.

### 2. Frame `0x00` (frame A), bytes 14-15 — custom firmware only

Signed int16, **tenths of a percent**. Only meaningful on Freestyl3r and SmirnoV firmware; on
stock firmware those bytes carry something else (they used to be stored as `euc.dash.rsts`,
which nothing in the repo ever read).

Gated on `euc.temp.hwPwm`, set by `euc.temp.firm()` from the firmware banner returned by the
`V` command:

| Banner | Firmware | Reports PWM in frame A |
|---|---|---|
| `GW` | stock Begode | no |
| `JN` | ExtremeBull | no |
| `CF` | Freestyl3r | yes |
| `BF` | SmirnoV | yes |

### 3. Estimate from speed — everything else

`euc.temp.pwmEst()`, a port of WheelLog's `calculatePwm()`:

    pwm = 100 * speed / ((rotS / rotV) * volt * pwrF)

`rotS` is the speed in km/h the wheel reaches at `rotV` volts on full duty; `pwrF` is a power
factor. They live per garage slot in `alrt.pwm.rotS` / `rotV` / `pwrF` (`eucSlot.json`),
defaulting to 50 / 84 / 0.9.

Better per-model defaults are seeded from `euc.temp.modelParams`, which is already keyed on the
model name returned by the `NAME` response, using WheelLog's calibration templates. Seeding
only happens while the slot still holds the 50/84 defaults, so a user calibration is never
overwritten.

To calibrate by hand: ride at top speed and tap **CALIBRATE PWM** on the PWM alerts page
(`dashAlerts.js`). That stores the current speed and voltage as the 100 % point. The button was
already drawn for Begode but had no handler; it is a no-op on wheels that report real PWM.

## Lifetime of the latches

`euc.temp.tPwm` and `euc.temp.hwPwm` are deliberately **not** cleared in `euc.conn`. `euc.temp`
is rebuilt per session in `euc.js`, which is the right lifetime: both latches survive a
reconnect. Clearing `hwPwm` on reconnect would permanently lose PWM on custom firmware after a
dropout, because the firmware banner is only re-fetched while `info.get.firm` is still empty.

`euc.dash.trip.pwm` is reset in `euc.conn`, matching `eucKingsong.js` and `eucVeteran.js`.

## Dashboard changes that went with this

- `dash_pwm.js` — dropped all four `extendedPacket` / `mainPacket` calls. The wheel is never
  put into the ASCII debug mode any more.
- `dash_digital.js` — Begode added to the maker gate, on the same side as Veteran. The gate
  parses as `((spd||topP) && Kingsong) || Veteran || Begode`, so Kingsong shows the PWM strip
  only above 5 km/h (or once the session max passes 50), while Veteran and Begode show it
  always. That asymmetry is deliberate: the widget also carries the session-max figure, and
  hiding it at a standstill is exactly when you want to read the top PWM of a ride.
- `dashAlerts.js` — the Begode arms on the PWM page were already present but commented out;
  restored, plus the CALIBRATE PWM handler.
- `Magic-testing/` was left alone: its `dash_digital.js` has no PWM widget at all (`pwrF` there
  is unreachable dead code) and its `dashAlerts.js` is a different UI with no maker gating.

`euc.temp.extd` and the `extendedPacket` / `mainPacket` commands are still in the module,
unused, for debugging the Freestyl3r stream.

## Verification

Replaying all 196 frames of `begexample.txt` through the module before and after this change
diffs only two fields of `euc.dash`: `rsts` (gone) and `trip.pwm` (now tracks). Voltage, speed,
temperature, trip, current, ride modes and fault codes are byte-identical.

A synthetic frame `0x07` for the parts the capture cannot cover:

    55 AA 00 00 00 00 00 2D 00 4B 00 00 00 00 00 00 00 00 07 18 5A 5A 5A 5A

should give `live.pwm == 75`, `live.tmpM == 45`, `euc.temp.tPwm == 1`, and a following frame A
must then leave `live.pwm` alone.

On the wheel, check that PWM tracks throttle and returns to about 0 at rest, that
`dash_digital` shows both the live and session-max figures, and — the specific regression the
old extended mode caused — that trip, current and fault alarms keep updating the whole time.

## Known open points

- **Phase current scaling.** `pck0` reads bytes 10-11 as `getInt16(10)/1000`; WheelLog reads the
  same bytes as `/100`. If Begode amps here have always read 10x low, frame `0x07` bytes 2-3
  carry the real *battery* current and would be the clean place to fix it — but that changes the
  meaning of every stored `alrt.amp.hapt` threshold, so it wants to be a deliberate separate
  change.
- **Branch `origin/begode`** rewrites `euc.wri` into a proper busy-queue, motivated by a
  conflict between `eucBegode` and `dash_pwm` writes — which is exactly the `extendedPacket`
  spam removed here. Worth deciding whether it is still needed.
