# Veteran: the new settings protocol

Reverse engineered on 2026-09-05 from two apps:

- **LeaperKim 1.4.8** (`C:\SampleProjects\Leaperkim`, package `com.laoniao.leaperkim`) —
  the manufacturer's own app, and **not obfuscated at all**: real class names, real field
  names. `utils/BtManager.java` holds both the frame parser (`handleFullSingleData`) and
  the command builders. This is the authoritative source and confirms the frame format
  byte for byte.
- **EUC World v2.66** — obfuscated, but exposes settings the manufacturer's app groups
  differently and reads two temperatures LeaperKim's app does not.

Original EUC World notes follow; where the two disagree, LeaperKim wins and it is flagged.

From EUC World v2.66
(`C:\SampleProjects\EucWorld\EUC_World`, `classes.dex`), which is the only app that
exposes these settings. WheelLog has none of them — see `WheelLogDiff.md` #4 and #5.

The Veteran adapter is the obfuscated class `Luh/g0;`. The preference dispatcher that
maps EUC World's `vn_*` setting keys onto its methods is `Lki/q;.a()`.

Decompiled with jadx 1.3.5 — the last release that runs on this machine's Java 8 JRE —
installed at `C:\SampleProjects\EucWorld\tools\jadx`, output in
`C:\SampleProjects\EucWorld\out`:

```
java -cp "lib/*" jadx.cli.JadxCLI -r --show-bad-code \
     --single-class "uh.g0" --single-class-output out/g0.java classes.dex
```

`--show-bad-code` is not optional here: the 3326-instruction telemetry parser `h()` fails
jadx's normal path and is emitted as `throw new UnsupportedOperationException` without it.
`--single-class` keeps each run to a few seconds. Where jadx's recovered source was
visibly incomplete (it declares locals it never assigns inside `qh.j.g()`), the claims
below were re-checked against the raw bytecode.

## Outbound command frame

Built by `Luh/g0;.I(payload, cmdByte)`:

```
[0]            0x4C  'L'
[1]            cmdByte  — 0x64 'd' or 0x6B 'k'   (see "Two blocks")
[2]            0x41  'A'
[3]            0x70  'p'
[4]            total frame length = payload.length + 9
[5 .. 5+n-1]   payload
[n+5 .. n+8]   CRC32, big-endian, over frame[0 .. n+4]
```

Same CRC32-big-endian-over-body scheme as the inbound `DC 5A 5C` telemetry frame.

**The payload is pre-filled with `0x80` by `Luh/g0;.y(n)`, and `0x80` means "leave this
setting unchanged".** Only the slot being written is set. `Luh/g0;.A()` confirms the read
side of the same convention: it returns `null` for any byte equal to `0x80`.

Payload byte 0 is a group id: `0x01` = settings, `0x00` = actions (the beep). For the
`0x64` block, payload byte 1 is `0x02`.

Verified three ways:

1. Feeding `[0x00, 0x80, 0x80, 0x80, 0x01]` with cmdByte `0x6B` through this builder
   reproduces WheelLog's hardcoded Veteran beep
   `4c 6b 41 70 0e 00 80 80 80 01 ca 87 e6 6f` byte for byte, CRC included.
2. The LeaperKim app builds the same frames as literal byte arrays. `PedalSoftnessSettingActivity`:

   ```java
   sendBytesData(new byte[]{76, 100, 65, 112, 15, 1, 2, Byte.MIN_VALUE,
                            Byte.MIN_VALUE, Byte.MIN_VALUE, progressToCmdValue(i)});
   ```

   `76,100,65,112` is `L d A p`; `15` is the total length; `Byte.MIN_VALUE` is `0x80`.
   `sendBytesData` appends the CRC32. That is byte-identical to the pedal-sensitivity
   frame below.
3. Frame lengths from the other LeaperKim setting screens match every slot in the tables:
   dynamic assist 31 (`0x1F`), pedal dip compensation 33 (`0x21`), stop speed 17,
   gyroscope 21, brake overpressure 34.

### Two blocks

Slot numbers repeat between the two command bytes, so they are separate blocks.

`0x6B` block — payload[1] is `0x00` when the static `K0 > 0`, else `0x80`:

| Slot | Setting | Range / encoding |
| --- | --- | --- |
| 2 | riding mode | 1 = soft, 2 = medium, 3 = hard |
| 3 | headlight mode | 0..1 |
| 6 | pedals tilt | -80..80, unit 0.1° |
| 7 | alarm speed | 10..200 km/h |
| 12 | lateral tilt limit | 35..75 ° |

`0x64` block — payload[1] = `0x02`:

| Slot | Setting | Range / encoding |
| --- | --- | --- |
| 5 | **pedal sensitivity** | 0..100 % |
| 7 | speed limit | 10..200 km/h |
| 8 | safety margin limit | value - 100; `-1` (off) encodes as `0xC8` |
| 10 | display backlight | 0..100 % |
| 13 | display mode | 0..1 |
| 14 | voltage correction | -15..15 |
| 15 | low battery mode | 0..1 |
| 16 | high speed mode | 0..1 |
| 18 | beeper volume | 0..100 % |
| 19 | charging voltage limit | value - 1450, i.e. 147.0..151.6 V sent as 20..66 |
| 21 | **dynamic assist** | 0..100 % |
| 23 | **pedal dip compensation** | 0..100 % |

### LeaperKim's own names for the three percent settings

| EUC World | LeaperKim field | LeaperKim UI label | Slot |
| --- | --- | --- | --- |
| pedal sensitivity | `PedalHardness` | "Pedal softness setting" | 5 |
| dynamic assist | `UpOrDownSpeedHelper` | "Acceleration and deceleration assist" | 21 |
| pedal dip compensation | `UpSpeedCul` | "Accelerometer reduction" | 23 |
| *(not exposed by EUC World)* | `BrakePressureAlarm` | "Brake overpressure alarm", 0..45 | 24 |
| *(not exposed by EUC World)* | `Gyro` | gyroscope calibration | 11 |

Ranges are the guards in the setter methods; they match `preferences_wheel_veteran.xml`
(`res/xml/`), which also carries the defaults: dynamic assist **50**, pedal dip
compensation **0**, pedal sensitivity **0**, lateral tilt limit 45, safety margin limit 20.

When the static `K0 > 0`, `I()` forces frame[1] to `0x64` for every command, and the
`0x6B`-block setters put `0x00` rather than `0x80` in payload[1]. So on that firmware
generation both blocks travel as `L d A p` frames distinguished by payload[1]
(`0x00` vs `0x02`). `K0` is set from the telemetry frame; treat "which generation am I
talking to" as still unresolved.

### Ready-made frames

```
pedal sensitivity = 40%     4c 64 41 70 0f 01 02 80 80 80 28 4f ee 75 3c
pedal sensitivity =  0%     4c 64 41 70 0f 01 02 80 80 80 00 7a 5b dd c6
dynamic assist = 50%        4c 64 41 70 1f 01 02 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 32 8f 89 d3 d5
pedal dip compensation = 25% 4c 64 41 70 21 01 02 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 80 19 94 97 a3 14
riding mode = hard          4c 6b 41 70 0c 01 80 03 46 e9 35 ac
riding mode = soft          4c 6b 41 70 0c 01 80 01 a8 e7 54 80
beep (WheelLog reference)   4c 6b 41 70 0e 00 80 80 80 01 ca 87 e6 6f
```

Espruino has `E.CRC32`, already used by `eucVeteran.js` on the inbound path, so the
builder is a few lines.

## Settings readback: sub-packet `pnum` 8

WheelLog's adapter has `case pnum == 8: // new packet, TODO: to recognize`. It is the
settings block, and the LeaperKim app decodes it in full into `ControlSettingData`:

| Frame byte | LeaperKim field | Command slot |
| --- | --- | --- |
| 50 | PedalHardness | 5 |
| 52 | StopSpeed | 7 |
| 53 | StopPowerRate | 8 |
| 55 | ScreenBacklightRate | 10 |
| 56 | Gyro | 11 |
| 57 | TransportMode | 12 |
| 58 | Unit (0 = km) | 13 |
| 59 | Vol — **signed**, voltage correction | 14 |
| 60 | LowVolMode | 15 |
| 61 | HighSpeedMode | 16 |
| 63 | KeyTone (beeper volume) | 18 |
| 64 | MaxChargeVol | 19 |
| 66 | UpOrDownSpeedHelper | 21 |
| 68 | UpSpeedCul | 23 |
| 69 | BrakePressureAlarm | 24 |

**Command payload slot N is frame byte N + 45.** The write payload is literally an image
of this block, which is exactly why `0x80` means "leave unchanged" — and on the read side
`0x80` (`Byte.MIN_VALUE`) means "this firmware does not support the setting", which the
LeaperKim app checks for on every field before showing it.

So a full settings screen can be driven off `pnum` 8 without ever guessing.

## Inbound: where pedal sensitivity is reported

From the telemetry parser `Luh/g0;.h()`:

```java
int b31 = buf.get(31) & 0xff;
if      (b31 == 1) ridingMode = <soft>;
else if (b31 == 2) ridingMode = <medium>;
else if (b31 == 3) ridingMode = <hard>;
else if (b31 >= 100 && b31 < 201 && K0 == 0) pedalSensitivity = b31 - 100;
```

**Byte 31 is overloaded.** It is the low byte of the 16-bit field at offset 30 that
`eucVeteran.js:79` reads as `euc.dash.opt.ride.mode`:

- **1, 2, 3** — legacy pedal mode.
- **100..200** — pedal sensitivity percent, as `byte31 - 100`.

That is exactly why the RIDE button is blank on a new wheel: the wheel reports e.g. 150,
`md[150]` is `undefined`, and `btn()` draws nothing when the label is falsy.

It also settles an open question in `WheelLogDiff.md` #4: **the wire values really are
1-3, not 0-2**, so eucWatch's `md={"1":"SOFT","2":"MEDIUM","3":"STRONG"}` indexing is
correct as it stands. Confirmed twice over — the write path `Luh/g0;.U()` maps EUC World's
list positions 0/1/2 onto wire 3/2/1 while the legacy string path sends
`SETh`/`SETm`/`SETs` for the same three positions, so wire 3 = hard, 2 = medium, 1 = soft.

Dynamic assist and pedal dip compensation are **not** in the short frame. EUC World only
reads them back from long frames (its parser gates the region at offsets 57-71 on frame
length >= 69 and >= 73), and offset 67 in that region is the pedal-tilt readback. Their
exact offsets are not pinned yet — see "Still open".

## Temperatures — board, cpu and a third

LeaperKim 1.4.8 reads exactly one wheel temperature — offset 18 — plus six battery
temperatures, and never touches 59 or 61. So these two come from EUC World alone.

**They are confirmed real on hardware.** Replaying the 29 long frames in `info.txt`
(Sherman S, FW 3012):

```
blen  off18(board)  off57   off59   off61(cpu)  off63   off67
  69     44.26       5.37   28.53     44.09      8.51    0.00
  69     44.27       5.37   28.54     44.11      8.51    0.00
  69     44.27       5.38   28.54     44.15      8.51    0.00
```

Offset 61 drifts **independently** of offset 18 — the two are never equal in any of the 29
frames — so it is a separate sensor, not a duplicate, and 44.1 C next to a 44.3 C board is
exactly what an idle wheel at thermal equilibrium should show. Offset 59 sits at 28.5 C,
a plausible third (ambient or pack) reading.

The EUC World reads are in the sub-packet with `pnum` (byte 46) **0 or 4**, gated on frame
length >= 69. Offset 18 is in every frame.

| EUC World channel | Offset | Scale | Notes |
| --- | --- | --- | --- |
| `vtei` — **IMU temperature** | **18** | x0.01 | what eucWatch already shows as `live.tmp` |
| `vtec` — **CPU temperature** | **61** | x0.01 | |
| `vte` — main "Temperature" | **59** on new firmware, else 18 | x0.01 | EUC World only |

From the decompiled parser:

```java
f19098u0 = Float.valueOf(order.getShort(18) * 0.01f);   // -> vtei, IMU
...
case 0: case 4:
  if (byteValue >= 69) {
    f19102y0  = order.getShort(57) * 0.01f;   // -> vro, roll angle (not a temperature)
    v0        = order.getShort(59) * 0.01f;   // -> vte, main temperature
    f19097t0  = order.getShort(61) * 0.01f;   // -> vtec, CPU
    f19086i0  = order.getShort(63) * 0.1f;    // conditional, gated on byte 23
    pedalTilt = order.getShort(67) * 0.01f;   // settings readback
    if (byteValue >= 73) {
      W  = order.getShort(69) * 0.01f;        // -> vcb1, battery 1 current
      c0 = order.getShort(71) * 0.01f;        // -> vcb2, battery 2 current
    }
  }
```

The bridge that names them is `qh.j.g()`, verified at bytecode level rather than from
jadx's partially-recovered source for that method:

```
sget Luh/g0;.t0  -> floatValue -> sput Lqh/j;.r  -> X() -> qh.a.L2  ("vtec", CPU)
sget Luh/g0;.u0  -> floatValue -> sput Lqh/j;.u  -> Y() -> qh.a.O2  ("vtei", IMU)
o0 ? v0 : u0     -> floatValue -> sput Lqh/j;.X  -> W() -> qh.a.F2  ("vte",  main)
```

So adding a second temperature to the dash needs only `euc.dash.live.tmpM =
getInt16(61)/100` inside the `pnum` 0/4 branch, plus a `Veteran` case in
`dash_digital.js` `tmFF()` labelled IMU / CPU — but log the raw value first and sanity
check it, given the caveat above.

**Battery temperatures are settled, and WheelLog has them right.** LeaperKim reads six per
pack from `pnum` **3** (left) and **7** (right), at offsets 47/49/51/53/55/57, signed,
/100 — identical to `VeteranAdapter.java`. My earlier note that WheelLog and EUC World
disagreed here was wrong: they read *different sub-packets*, so there is no conflict.
Cells 31-36 follow at 59 + 2i /1000, cells 37-120 at 71 + 2i /1000.

**Offset 67: the capture favours EUC World, not the manufacturer.** LeaperKim reads 67/68
as `lrAngle` (lean angle, signed, /100, posted as `EBReceiverLrAngel`); EUC World reads 67
as the pedal-tilt setting readback. In the capture offset 67 is a flat `0.00` across every
frame, which reads like a setting at its default, while offset 57 — EUC World's roll angle
— varies 4.93..5.39. Live angles move; settings do not. Unresolved, but do not assume the
manufacturer is right here.

Battery currents at 69/70 and 71/72 (/100) agree in both apps.

**Offset 63 is +8.51 with `chargeMode == 0`** in the capture, so EUC World's rule (use it
only while charging *and* only when negative) correctly ignores it. Any implementation must
keep both halves of that guard.

### Independent corroboration

The event-log decoder `uh.g0.B()` (format `eventLogVeteranV1`) carries these fault codes
in EUC World's own wording:

- `mcuTemperatureAbove105CAfter1S` — "MCU temperature above 105°C / 221°F detected for 1s or longer" (also 95, 85)
- `mcuVoltageBelow3V15After0S3`, `mcuVoltageAbove3V45After0S3`

MCU die temperature and MCU supply voltage are exactly what the STM32's internal ADC
channels 16 and 17 measure — `AD16T` and `AD17R` in the wheel's string-debug output
(`WheelLogDiff.md` #5). The 3.15/3.45 V thresholds bracket the 3.27 V VDDA computed there
from `AD17R`, which independently checks that arithmetic.

The same log decodes `phaseAZeroValue`/`phaseBZeroValue`/`phaseCZeroValue`,
`busZeroValue`, `chargingZeroValue` and the accelerometer/gyroscope per-axis zero values —
the ADC calibration constants that appear as `AD2`/`AD3`/`AD4` in the string dump.

## Current: offset 16 is the phase current, not the bus current

```java
mechineCurrent = abs(int16(16,17)) / 10;              // PHASE current
outPut         = uint16(34,35);                        // PWM, percent x100
current        = mechineCurrent * outPut / 10000;      // bus current = phase x duty
power          = current * voltage;
```

That is what both phone apps display. At walking pace the duty cycle is well under 1%, so
the bus current sits near zero while the phase current swings several amps — which is why
`eucVeteran.js` reading offset 16 straight into `live.amp` looked so noisy against the
apps. Replaying `info.txt` through the corrected formula gives -0.32..+0.27 A across all
116 frames, every one rounding to 0 on the dash, against -7.9..+6.7 for the raw phase
value on the same idle wheel.

EUC World takes a different route — `int16(38) * 0.15` when not charging — but offset 38 is
0 in every frame of that FW 3012 capture, so it looks unpopulated on Sherman S. The
LeaperKim formula works on any firmware.

**Charging.** EUC World: when `chargeMode` (byte 23) is non-zero it shows the sum of the
two BMS pack currents (offsets 69, 71) if both are present, else `int16(63) * 0.1` — and
only when that value is negative. The LeaperKim app has no charging current at all, only
`isCharging() = byte23 > 0`.

## Battery temperature status: offset 36

`batteryTempMode = uint16(36,37)`, the constant `111` in the Sherman S capture:

| Value | LeaperKim app shows |
| --- | --- |
| 111 | "Normal" |
| 100, 101, 110 | "High", in red |
| anything else | `-`, unknown |

Three digits, 1 = that sensor is OK. So `!= 111` is a usable warning condition, and it
costs one u16 read from the short frame.

## Alarm speed: the manufacturer sends both generations

`SetAlarmSpeedActivity` writes **two frames back to back** rather than detecting which
protocol generation the wheel wants:

```
4C 6B 41 70 11 01 80 80 80 80 80 80 <km/h>     'k', payload[1] = 0x80
4C 64 41 70 11 01 00 80 80 80 80 80 <km/h>     'd', payload[1] = 0
```

That closes the `K0` question: do the same and generation detection is unnecessary. The
value is a plain byte in km/h and the seek bar is `progress + 10`, so 1 km/h steps from 10.
The 5 km/h steps seen on the wheel's own menu are a UI choice there, not a protocol limit.

Speed limit is a *different* setting — `L d A p`, payload[1] = 2, slot 7, max 110
(`StopSpeedSettingActivity`). A wheel whose firmware does not implement it simply ignores
the write, which is consistent with it having no effect on Sherman S, and with offset 26/27
holding an out-of-range 2800 there.

## Main frame, as LeaperKim reads it

This is `BtManager.handleFullSingleData()`, the manufacturer's own decode. It agrees with
EUC World everywhere the two overlap, and settles several open items in
`WheelLogDiff.md`:

```java
setVoltage(indexsToInt(4,5)      / 100f);
setSpeed(abs(signed(6,7))        / 10f);
setShortMeter(indexsToInt(10,11)*65536 + indexsToInt(8,9));
setTotalMeter(indexsToInt(14,15)*65536 + indexsToInt(12,13));
setMechineCurrent(abs(signed(16,17)) / 10f);      // phase current
setTemperature(signed(18,19)     / 100f);         // the only wheel temperature it reads
setShutDownTime(indexsToInt(20,21));
setChargeMode(byte(23));
setDangerSpeed(indexsToInt(24,25) / 10f);         // alarm speed
setStopSpeed(indexsToInt(26,27)   / 10f);         // tiltback / limit speed
parseVersionCode(bytes{ get(30), get(28), get(29) });
setRideMode(byte(31));
setCarPose(signed(32,33));                        // pitch
setOutPut(indexsToInt(34,35));                    // PWM
setBatteryTempMode(indexsToInt(36,37));
```

Two things worth flagging:

- **Byte 30 belongs to the version code, not the ride mode.** LeaperKim builds the version
  from bytes {30, 28, 29} and reads the ride mode from **byte 31 alone**.
  `eucVeteran.js:79` uses `getUint16(30)`, which folds byte 30 into the value. It happens
  to work while byte 30 is zero, but it is wrong in principle and should be
  `getUint8(31)`.
- **Offset 36/37 is `batteryTempMode`** — that is the constant `0x006F` (111) sitting in
  the "unknown" 36-45 region of the Sherman S capture, not padding.

For reference, EUC World's version of the same frame:

```java
B0        = order.getShort(4)  * 0.01f;                     // voltage
f19096s0  = abs(order.getShort(6) * 0.1f);                  // speed
f19091n0  = (getShort(10)*65536 + getShort(8))  * 0.001f;   // trip km
f19099w0  = (getShort(14)*65536 + getShort(12)) * 0.001f;   // total km
f19089l0  = order.getShort(16) * (major >= 3 ? -0.1f : 0.1f);  // phase current
f19098u0  = order.getShort(18) * 0.01f;                     // IMU temperature
            order.getShort(20);                             // read and discarded
f19087j0  = order.get(23) & 255;
speedAlarm = x.d(order.getShort(24)) * 0.1f;                // property z[14]
speedLimit = x.d(order.getShort(26)) * 0.1f;                // property z[15]
            order.get(31)                                   // riding mode / pedal sensitivity
f19100x0  = order.getShort(32) * 0.01f;                     // pitch angle -> "vil"
f19103z0  = x.d(order.getShort(34)) * 0.01f;                // PWM
```

- **Offset 24 is the speed alarm and 26 is the speed limit** — both apps agree, confirming
  `WheelLogDiff.md` #1. `eucVeteran.js:77` storing offset 24 as `trip.avrS` is wrong.
- Both scale by **0.1**, not WheelLog's `* 10`. On the Sherman S capture that gives
  58.2 km/h for the alarm, which fits, and 280.0 km/h for the limit, which does not — that
  field still needs checking on real hardware.
- **Phase current sign flips on major version >= 3** in EUC World; the LeaperKim app just
  takes the absolute value. eucWatch has it as the manual `unit.ampR` toggle.

## Still open

- **Offset 59** — EUC World's "main" temperature, 28.5 C in the capture. Which sensor it is
  (ambient? pack?) is unknown.
- **Offset 67** — `lrAngle` (LeaperKim) vs pedal-tilt readback (EUC World); the capture
  leans towards EUC World, see above.
- **Offset 26.** Both apps read it as a speed / 10, but the Sherman S capture holds 2800
  there, i.e. 280 km/h, outside any sane range. Something is version-dependent.
- **Offset 63**, which EUC World reads x0.1 gated on byte 23, is unidentified. LeaperKim
  does not read it.
- **What sets `K0`** in EUC World, i.e. which command-byte generation a wheel wants. The
  LeaperKim app always sends `0x64` `'d'`, which suggests `'d'` is simply correct for
  current firmware.

## How to close the gaps

Both apps' decoders now agree on everything load-bearing, so the remaining risk is
firmware variation rather than misreading. The proxy MITM already in the tree — `proxyVeteran.js` advertises the watch as
`LK_<name>`, relays phone -> wheel writes via `euc.wri("proxy", data)` and logs them to
`ew.log` when `ew.dbg` is set. Point EUC World at the watch, change one setting at a time,
and compare the logged frames against the table above to confirm it on real firmware
before writing anything to a wheel.
