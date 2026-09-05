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

## The PWM mode switch

The three sources are no longer arbitrated automatically. `euc.dash.alrt.pwm.hw`, a per garage
slot flag set on page 2 of **DASH OPTIONS**, picks between them:

| Switch | `alrt.pwm.hw` | Source |
|---|---|---|
| **H** hardware | 1 | frame `0x07`, else frame `0x00` on custom firmware, else a flat 0 |
| **S** software | 0 | `euc.temp.pwmEst()` only, anything the wheel reports is ignored |

**H never falls back to the estimate.** A wheel that reports no PWM reads a steady 0 in H mode,
which is the signal to put the switch back to S. That is deliberate: a silent fallback hides
which number you are actually looking at, and the two differ enough to matter. The reverse guard
is in `pck0` — entering H mode zeroes a stale estimate instead of leaving the last value frozen
on screen.

New slots default to **S**. The failure modes are not symmetric: S on a modern wheel is a
slightly less accurate number, H on an old one is a dead PWM readout, and PWM drives the haptic
alarm.

## The three PWM sources

All of them funnel through `euc.temp.pwmSet()`, which rounds, clamps to 0-100 and tracks the
session max, mirroring what Kingsong and Veteran do inline.

### 1. Frame `0x07`, bytes 8-9 — modern stock firmware (H)

Sent unprompted by main boards with firmware after roughly 09.2024. Signed int16, **whole
percent**. Handled by `euc.temp.pck7`, which also reads motor temperature from bytes 6-7 into
`live.tmpM`.

`euc.temp.tPwm` latches on the first frame whose PWM field is non-zero and then stays set, which
is WheelLog's `truePWM`. It no longer decides hardware-versus-software — it only picks frame 7
over frame A once frame 7 has proved to be live. The magnitude is used, so braking (negative)
PWM shows as a positive duty — note the sign convention here is inverted relative to frame A.

### 2. Frame `0x00` (frame A), bytes 14-15 — custom firmware only (H)

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

### 3. Estimate from speed (S)

`euc.temp.pwmEst()`, a port of WheelLog's `calculatePwm()`:

    pwm = 100 * speed / ((rotS / packV) * volt * pwrF)

`rotS` is the **free spin speed**: the km/h the wheel reaches on full duty at a full pack.
`pwrF` is a power factor. Both live per garage slot in `alrt.pwm.rotS` / `pwrF`.

`packV` is `opt.bat.pack * 4.2`, the cell count from **PACK** times a full cell. There is no
stored `rotV` any more — in every entry of the old model table `rotV` was exactly the pack
voltage (20S = 84, 24S = 100.8, 32S = 134.4, 36S = 151.2, 40S = 168), so it is derived instead.

Set the free spin speed with **SPIN** on page 2 of dash options, or measure it: ride at top
speed and tap **CALIBRATE PWM** on the PWM alerts page (`dashAlerts.js`). Calibration scales the
reading up to a full pack, `rotS = spd * packV / volt`, so it is valid at any state of charge.
It is a no-op in H mode.

## No model table

`euc.temp.modelParams` is gone, along with the `voltMultiplier` / `minCellVolt` seeding it did
from the `NAME` response. Adding a case per wheel does not scale — Begode ships 134.4 V, 151.2 V,
168 V, 210 V and 252 V packs — and it fought the user's own settings.

Everything it supplied is now a dash option, because everything it supplied was derivable:

| Was | Now |
|---|---|
| `voltMultiplier` | **PACK**, the cell count. Begode reports voltage against a 67.2 V (16S) base, so `pck0` scales by `pack/16`: 40S gives 2.5x and a 168 V wheel reads right with no code change |
| `minCellVolt` | **EMPTY**, already on the same screen |
| `rotS` / `rotV` | **SPIN**, quoted at `pack * 4.2` |

The model name is still read and still stored in the garage; it just no longer configures
anything. This matches `ada7dcc5`, which removed the same kind of table from `eucKingsong.js`.

### Migrating older slots

The module fixes up its slot at eval time, before any frame is parsed:

- `pack` below 8 is the pre-cell-count multiplier (1.5 meant 100.8 V) and becomes `pack * 16`.
  No wheel runs on 8 cells, so the test is unambiguous. `dashOptions.js` does the same thing on
  entry to page 2, replacing a `Math.ceil` that used to flatten 1.5 to a nonsensical 2S.
- a slot holding both `rotS` and `rotV` keeps its ratio: `rotS = rotS * packV / rotV`, then
  `rotV` is deleted. A hand calibration survives, and the model-table seeds land on the same
  numbers they had.
- a missing `hw` defaults to 0 (S), so slots upgrading in place keep the behaviour they had.

## Lifetime of the latches

`euc.temp.tPwm` and `euc.temp.hwPwm` are deliberately **not** cleared in `euc.conn`. `euc.temp`
is rebuilt per session in `euc.js`, which is the right lifetime: both latches survive a
reconnect. Clearing `hwPwm` on reconnect would permanently lose PWM on custom firmware after a
dropout, because the firmware banner is only re-fetched while `info.get.firm` is still empty.

`euc.dash.trip.pwm` is reset in `euc.conn`, matching `eucKingsong.js` and `eucVeteran.js`.

## Dash options page 2

Six slots in a 3x2 grid. AMP and PACK moved left into the two blank middle slots, freeing the
right column for the two new controls:

    FULL    AMP N/R   PWM H/S
    EMPTY   PACK S40  SPIN 160

AMP and PWM are toggles, the other four are value editors: tap to arm, then tap the left or
right half of the notification strip to step. Everything is written back to the slot by
`euc.updateDash` on the swipe that leaves the screen.

Colour follows the control, not the column: FULL, EMPTY, PWM and SPIN draw in `1`, the two
moved buttons AMP and PACK keep `4`. The value editors that use `1` also take FULL's armed
highlight `12`, so SPIN has to be repainted in the two paths that disarm an editor — the
`ntfy` timeout and a tap outside the strip — next to FULL and EMPTY.

### Begode only

PWM and SPIN are drawn only for Begode. On every other maker the right column is blank:

    FULL    AMP N/R   PWM H/S        FULL    AMP N/R
    EMPTY   PACK S40  SPIN 160       EMPTY   PACK S40
            Begode                    everything else

`face[0].init` caches the test as `this.bgd`; the maker cannot change while the screen is
open, so it is read once rather than per paint. Both cells fall back to the blank `btn` that
slot 3 of page 1 already uses, and both taps drop to `buzzer.nav(40)`, the dead-zone tone. The
two disarm paths skip their SPIN repaint for the same reason — that repaint exists only to clear
the armed highlight `12`, and a control that cannot be armed cannot be showing it.

This matches `dashAlerts.js`, which already drew CALIBRATE PWM for Begode alone. The other two
hardware-PWM makers need neither control: Kingsong and Veteran report PWM on the wire, so there
is no mode to pick and no free spin speed to calibrate. The migration in the swipe handler is
deliberately left ungated — a non-Begode slot still gets `hw` and `rotS` normalised, keeping
every slot the same shape as `eucSlot.json`.

## Dashboard changes that went with the original hardware PWM work

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

Replaying all 196 frames of `begexample.txt` through the module before and after the model table
was removed leaves every field of `euc.dash` identical — voltage, speed, temperature, trip,
current, ride modes, fault codes and PWM — given the same `pack` on both sides.

Derived voltage and estimate, from frame `0x00` alone, with no model table involved:

| PACK | reported | `live.volt` | spd | `rotS` | `live.pwm` |
|---|---|---|---|---|---|
| 40S | 67.2 | 168.0 | 80 | 160 | 56 |
| 40S | 60.0 | 150.0 | 80 | 160 | 62 |
| 36S | 67.2 | 151.2 | 100 | 125 | 89 |
| 24S | 67.2 | 100.8 | 60 | 85.5 | 78 |

A synthetic frame `0x07` for the parts the capture cannot cover:

    55 AA 00 00 00 00 00 2D 00 4B 00 00 00 00 00 00 00 00 07 18 5A 5A 5A 5A

in H mode should give `live.pwm == 75`, `live.tmpM == 45`, `euc.temp.tPwm == 1`, and a following
frame A must then leave `live.pwm` alone. In S mode the same pair must read the estimate, not 75.
In H mode with no frame 7 and a stock banner, frame A must read a flat 0.

Slot migration, checked at eval time:

| Stored | Becomes |
|---|---|
| `pack 32, rotS 113, rotV 134.4` (Master seed) | `pack 32, rotS 113` |
| `pack 24, rotS 85.5, rotV 100.8` (Nikola seed) | `pack 24, rotS 86` |
| `pack 1.5, rotS 50, rotV 84` (pre-table) | `pack 24, rotS 60` |
| `pack 40, rotS 100, rotV 120` (hand calibration) | `pack 40, rotS 140` |

On the wheel, check that PWM tracks throttle and returns to about 0 at rest, that
`dash_digital` shows both the live and session-max figures, that flipping H/S changes the
number and survives a reconnect, and — the specific regression the old extended mode caused —
that trip, current and fault alarms keep updating the whole time.
