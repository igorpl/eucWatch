const debug = new URL(window.location.href).searchParams.get('debug')
const Decoder = new TextDecoder()
const maxCellVolt = 4.2
const baseCellSeries = 16

// A Begode telemetry frame is always 24 bytes: 55 AA, sixteen bytes of channels, the
// frame number at byte 18, one more byte, then 5A 5A 5A 5A. The wheel sits behind a
// serial-to-BLE bridge that packs 20 bytes per notification and does not align to
// frames, so a notification holds the tail of one frame and the head of the next and
// frames have to be cut out by their markers. Reading a notification as if it were a
// frame only ever worked while the wheel alternated frames 0 and 4 and nothing else -
// any wheel with a smart BMS also sends 1, 2, 3, 5, 6 and 7 and the alignment is lost.
const frameLength = 24
const frameTypes = [0, 1, 4, 7]

let frame = new Uint8Array(frameLength)
let frameFilled = 0
let pwmAlarmSpeed = 0
let rendered = false
let wheelModel = ''
let firmware = ''
let hwPwm = false        // CF/BF firmware reports pwm in frame 0, stock does not
let alexovik = false     // BF: same frame numbers, several channels mean something else
let framePwm = false     // frame 7 seen, so pwm comes from there and nowhere else
let line = ''

function modelParams() {
  switch(wheelModel) {
    case 'Mten3':       return { 'voltMultiplier': 1.25, 'minCellVolt': 3.3 }
    case 'MCM5':        return { 'voltMultiplier': 1.25, 'minCellVolt': 3.3 }
    case 'T3':          return { 'voltMultiplier': 1.25, 'minCellVolt': 3.25 }
    case 'Nikola':      return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'Msuper Pro':  return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'MSP C30':     return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'MSP C38':     return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'RS C30':      return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'RS C38':      return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'EX':          return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'EX20S C30':   return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'EX20S C38':   return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'Monster':     return { 'voltMultiplier': 1.50, 'minCellVolt': 3.25 }
    case 'EXN':         return { 'voltMultiplier': 1.50, 'minCellVolt': 3.15 }
    case 'Monster Pro': return { 'voltMultiplier': 1.50, 'minCellVolt': 3.1 }
    case 'Master':      return { 'voltMultiplier': 2,    'minCellVolt': 3.25 }
    case 'EX30':        return { 'voltMultiplier': 2,    'minCellVolt': 3.25 }
    case 'T4':          return { 'voltMultiplier': 2,    'minCellVolt': 3.25 }
    case 'Blitz':       return { 'voltMultiplier': 2,    'minCellVolt': 3.25 }
    default:            return { 'voltMultiplier': 1,    'minCellVolt': 3.3 }
  }
}

// Every settings command is a single ASCII character, and the multi-byte ones are
// wrapped in 'b' the way WheelLog wraps them - the wheel takes 'b' as the commit and
// answers it with a beep. The digits are ASCII too, hence the + 48.
function commands(cmd, param) {
  switch(cmd) {
    case 'mainPacket':      return [44]   // ','
    case 'extendedPacket':  return [107]  // 'k'
    case 'fetchModel':      return [78]   // 'N'
    case 'fetchFirmware':   return [86]   // 'V'
    case 'beep':            return [98]   // 'b'
    case 'lightsOff':       return [69]   // 'E'
    case 'lightsOn':        return [81]   // 'Q'
    case 'lightsStrobe':    return [84]   // 'T'
    // WheelLog's alarm-mode list, in the order the wheel reports it back in frame 4:
    // 0 is both alarms, 1 is the second one only, 2 is pwm only, 3 is custom-firmware
    // pwm tiltback. The old names here had 0 and 1 the wrong way round.
    case 'alertsBoth':      return [111]  // 'o'
    case 'alertsOne':       return [117]  // 'u'
    case 'alertsOff':       return [105]  // 'i'
    case 'alertsTiltback':  return [73]   // 'I'
    case 'pedalSoft':       return [115]  // 's'
    case 'pedalMedium':     return [102]  // 'f'
    case 'pedalHard':       return [104]  // 'h'
    // Roll angle, WheelLog's setRollAngleMode: gear 0 is '>', 1 is '=', 2 is '<'.
    // These were reversed, so picking Low set High and the readback fought the buttons.
    case 'rollAngleLow':    return [62]   // '>'
    case 'rollAngleMedium': return [61]   // '='
    case 'rollAngleHigh':   return [60]   // '<'
    case 'speedKilometers': return [103]  // 'g'
    case 'speedMiles':      return [109]  // 'm'
    case 'calibrate':       return [99, 121]
    case 'startIAP':        return [33, 64]
    case 'tiltbackOff':     return [98, 34, 98, 98]
    case 'tiltbackSpeed':   return [98, 87, 89, Math.floor(param / 10) + 48, param % 10 + 48, 98, 98]
    case 'volume':          return [87, 66, 48 + param, 98]
    case 'ledMode':         return [87, 77, 48 + param, 98]
    default:                return cmd
  }
}

const faultAlarms = {
  0: 'high power',
  1: 'high speed 2',
  2: 'high speed 1',
  3: 'low voltage',
  4: 'over voltage',
  5: 'high temperature',
  6: 'hall sensor error',
  7: 'transport mode'
}

const lightModes = {
  0: 'off',
  1: 'on',
  2: 'strobe'
}

async function sendCommand(cmd, param) {
  for (let byte of commands(cmd, param)) {
    await characteristic.writeValue(new Uint8Array([byte]))
    await new Promise(r => setTimeout(r, 250))
  }
}

async function scan() {
  device = await navigator.bluetooth.requestDevice({ filters: [
    { namePrefix: 'GotWay' },
    { namePrefix: 'Gotway' },
    { namePrefix: 'Begode' },
    { namePrefix: 'RW' },
    { services: [0xFFE0] },
  ],
  optionalServices: [0xFFE0] })
  server = await device.gatt.connect()
  service = await server.getPrimaryService(0xFFE0)
  characteristic = await service.getCharacteristic(0xFFE1)
  await characteristic.startNotifications()
  characteristic.addEventListener('characteristicvaluechanged', readMainPackets)
  initialize()
}

async function initialize() {
  pwmAlarmSpeed = 0
  rendered = false
  wheelModel = ''
  firmware = ''
  hwPwm = false
  alexovik = false
  framePwm = false
  frameFilled = 0
  document.getElementById('scan-disconnect').innerText = 'Disconnect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-danger'
  document.getElementById('scan-disconnect').onclick = disconnect
  document.getElementById('packet-switch').classList.remove('invisible')
  fetchBanners(0)
}

// One lost write, or a reply split across two notifications, otherwise leaves the
// banner empty for the whole session - and an empty firmware banner also means hwPwm
// is never set, so a wheel that does report PWM silently shows none. WheelLog asks
// until it gets an answer; this does the same, with an end to it.
async function fetchBanners(attempt) {
  if (attempt >= 10 || !device.gatt.connected)
    return

  if (firmware == '' )
    await sendCommand('fetchFirmware')

  if (wheelModel == '')
    await sendCommand('fetchModel')

  if (firmware != '' && wheelModel != '')
    return

  setTimeout(() => fetchBanners(attempt + 1), 500)
}

function disconnect() {
  device.gatt.disconnect()
  frameFilled = 0
  document.getElementById('scan-disconnect').innerText = 'Scan & Connect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-primary'
  document.getElementById('scan-disconnect').onclick = scan
  document.getElementById('packet-switch').classList.add('invisible')
}

async function startIAP() {
  await sendCommand('startIAP')
  characteristic.removeEventListener('characteristicvaluechanged', readMainPackets)
  characteristic.addEventListener('characteristicvaluechanged',
    (data) => console.log(Decoder.decode(data.target.value)))
}

async function startYmodem() {
  await sendCommand([1])
}

async function exitYmodem() {
  await sendCommand([1, 0, 255, 65, 0, 1, 0].concat(Array(13).fill(0)))

  for (i = 0; i < 5; i++)
    await sendCommand(Array(20).fill(0))

  await sendCommand(Array(11).fill(0).concat([19, 77]))
}

async function setTiltbackSpeed(speed) {
  speed = parseInt(speed)

  if (speed == 0 || speed >= 100)
    await sendCommand('tiltbackOff')
  else
    await sendCommand('tiltbackSpeed', speed)
}

function setField(field, val) {
  element = document.getElementById(field)
  if (element)
    element.value = val
}

// The wheel reports a setting back a frame or two after it is changed, so the radio
// that is checked has to follow the wheel rather than the click. An out-of-range value
// - light mode 3 turns up on real wheels - must leave the group alone rather than
// throw and take the rest of the frame's fields down with it.
function selectRadio(group, index) {
  chosen = document.getElementById(`${group}-${index}`)
  if (!chosen)
    return

  document.getElementsByName(chosen.name).forEach(radio => radio.checked = radio == chosen)
}

async function setWheelModel(banner) {
  wheelModel = banner.slice(5).trim()
  setField('wheel-model', wheelModel)
  updateVoltageHelpText()
}

// GW is stock, JN ExtremeBull, CF Freestyl3r, BF SmirnoV. Only the two custom ones
// report pwm in the live frame; BF also reuses several channels for other values.
function setFirmware(banner) {
  prefix = banner.slice(0, 2)

  if (prefix != 'GW' && prefix != 'JN' && prefix != 'CF' && prefix != 'BF')
    return false

  firmware = banner.slice(2).trim()
  hwPwm = prefix == 'CF' || prefix == 'BF'
  alexovik = prefix == 'BF'
  setField('firmware', `${prefix} ${firmware}`)
  return true
}

function setImuModel(banner) {
  setField('imu-model', banner.trim())
}

async function switchToMainPackets() {
  characteristic.removeEventListener('characteristicvaluechanged', readExtendedPackets)
  document.getElementById('extended').style.display = 'none'
  document.getElementById('main').style.display = null
  document.getElementById('packet-switch').innerText = 'Switch to extended packets'
  document.getElementById('packet-switch').onclick = switchToExtendedPackets
  frameFilled = 0
  await sendCommand('mainPacket')
  characteristic.addEventListener('characteristicvaluechanged', readMainPackets)
}

async function switchToExtendedPackets() {
  characteristic.removeEventListener('characteristicvaluechanged', readMainPackets)
  document.getElementById('main').style.display = 'none'
  document.getElementById('extended').style.display = null
  document.getElementById('packet-switch').innerText = 'Switch to main packets'
  document.getElementById('packet-switch').onclick = switchToMainPackets
  line = ''
  rendered = false
  setupGauge()
  await sendCommand('extendedPacket')
  characteristic.addEventListener('characteristicvaluechanged', readExtendedPackets)
}

function updatePwmAlarmSpeed() {
  pwmAlarmSpeed = speed
  setField('pwm-alarm-speed', pwmAlarmSpeed)

  speedReduction = 1 - (100 - battery) / 450
  alarmSpeed100 = (speed / speedReduction).toFixed(1)
  setField('pwm-alarm-100', alarmSpeed100)

  ;[10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(batt => {
    speedReduction = 1 - (100 - batt) / 450
    setField(`pwm-alarm-${batt}`, (alarmSpeed100 * speedReduction).toFixed(1))
  })
}

function updateVoltageHelpText() {
  if (wheelModel == '')
    return

  minVoltage = (modelParams()['voltMultiplier'] * modelParams()['minCellVolt'] * 16).toFixed(1)
  maxVoltage = (modelParams()['voltMultiplier'] * maxCellVolt * 16).toFixed(1)
  document.getElementById('voltage-help').innerText = `min: ${minVoltage}v - max: ${maxVoltage}v`
}

// Frame 0, the live frame. Everything here is at its own offset in the 24 byte frame,
// no notification-relative arithmetic.
function readLiveFrame(data) {
  voltage = data.getUint16(2) / 100
  scaledVoltage = (voltage * modelParams()['voltMultiplier']).toFixed(1)
  setField('voltage', scaledVoltage)

  if (document.getElementById('voltage-help').innerText == '')
    updateVoltageHelpText()

  battery = (100 * (voltage / baseCellSeries - modelParams()['minCellVolt']) /
   (maxCellVolt - modelParams()['minCellVolt'])).toFixed(2)
  setField('battery', battery)

  speed = Math.abs(data.getInt16(4) * 3.6 / 100).toFixed(1)
  setField('speed', speed)

  // Two bytes of metres, not four - offset 6 is a separate channel and on SmirnoV
  // firmware it is a battery current, which is why the old getUint32(6) read a trip
  // distance in the thousands of km whenever the wheel was pulling any current.
  if (!alexovik) {
    tripDistance = (data.getUint16(8) / 1000).toFixed(3)
    setField('trip-distance', tripDistance)
  }

  phaseCurrent = data.getInt16(10) / (alexovik ? 10 : 100)
  setField('phase-current', phaseCurrent)

  temp = alexovik
    ? (data.getInt16(12) / 333.87 + 21.0).toFixed(2)
    : (data.getInt16(12) / 340 + 36.53).toFixed(2)
  setField('temp', temp)

  // Offset 14 is tenths of a percent of pwm on custom firmware and a settings word on
  // stock. Frame 7, where a wheel sends one, wins over both.
  if (hwPwm && !framePwm)
    setField('pwm', (Math.abs(data.getInt16(14)) / 10).toFixed(1))
  else if (!hwPwm)
    readStockSettingsWord(data.getUint16(14))

  if (!alexovik)
    selectRadio('volume', data.getUint16(16))
}

// Stock firmware packs four settings readbacks into frame 0 offset 14. The bit layout
// is the Begode app's and is not confirmed against a modern wheel, so it is shown as
// read-only text rather than driving any control.
function readStockSettingsWord(word) {
  setField('racing-mode', word & 0x1 ? 'racing' : 'off-road')
  setField('brake-cutoff', (word >> 3) & 0x3 ? 'on' : 'off')
  setField('pedal-adjust', (word >> 5) & 0x1F)
  setField('angle-compensation', (word >> 10) & 0xF)
}

// Frame 1, the BMS frame. Offset 6 is the wheel's own measured pack voltage, so it
// needs none of the cell-count guessing the frame 0 voltage does.
function readBmsFrame(data) {
  setField('power-alarm', data.getUint16(2))
  setField('pack-voltage', (data.getUint16(6) / 10).toFixed(1))
  setField('battery-current', (data.getInt16(8) / 10).toFixed(1))
  setField('battery-temp-1', data.getInt16(10))
  setField('battery-temp-2', data.getInt16(12))
}

// Frame 4, distance and settings.
function readSettingsFrame(data) {
  totalDistance = (data.getUint32(2) / 1000).toFixed(2)
  setField('total-distance', totalDistance)

  if (alexovik)
    return

  modes = data.getUint16(6)
  selectRadio('pedal-mode',  modes >> 13 & 0x3)
  selectRadio('speed-alert', modes >> 10 & 0x3)
  selectRadio('roll-angle',  modes >>  7 & 0x3)
  selectRadio('speed-unit',  modes & 0x1)

  powerOffTime = data.getUint16(8)
  powerOffMinutes = Math.floor(powerOffTime / 60)
  powerOffSeconds = powerOffTime - (powerOffMinutes * 60)
  setField('poweroff-timer', `${powerOffMinutes}:${powerOffSeconds}`)

  tiltbackSpeed = data.getUint16(10)
  if (tiltbackSpeed >= 100)
    tiltbackSpeed = 0
  document.getElementById('tiltback-speed-label').innerHTML = tiltbackSpeed == 0 ? 'Disabled' : tiltbackSpeed
  document.getElementById('tiltback-speed').value = tiltbackSpeed

  // Byte 13 alone. Reading a 16 bit word here pulled byte 12 in as the high half,
  // which agrees with the wheel only while byte 12 happens to be zero.
  selectRadio('led-mode', data.getUint8(13))

  faultAlarm = data.getUint8(14)
  faultAlarmLine = ''
  for (let bit = 0; bit < 8; bit++) {
    if (faultAlarm >> bit & 0x1)
      faultAlarmLine += faultAlarms[bit] + ', '
  }

  faultAlarmLine = faultAlarmLine.slice(0, -2)
  setField('fault-alarms', faultAlarmLine)

  lightMode = data.getUint8(15) & 0x3
  setField('light-mode', lightModes[lightMode] === undefined ? lightMode : lightModes[lightMode])

  if (faultAlarm & 0x1 && (pwmAlarmSpeed == 0 || speed < pwmAlarmSpeed))
    updatePwmAlarmSpeed()
}

// Frame 7, sent by main boards with firmware after 09.2024.
function readExtendedFrame(data) {
  if (alexovik)
    return

  framePwm = true
  setField('battery-current', (data.getInt16(2) / 100).toFixed(2))

  advanced = data.getUint16(4)
  setField('tilt-close', advanced & 0xF)
  setField('field-weakening', advanced >> 4 & 0xF)
  setField('current-limit', advanced >> 8 & 0x1F)

  setField('motor-temp', data.getInt16(6))
  setField('pwm', Math.abs(data.getInt16(8)).toFixed(1))
}

function readFrame() {
  data = new DataView(frame.buffer)

  switch (frame[18]) {
    case 0: return readLiveFrame(data)
    case 1: return readBmsFrame(data)
    case 4: return readSettingsFrame(data)
    case 7: return readExtendedFrame(data)
  }
}

// A reply to N or V arrives on the same characteristic as the telemetry, as plain
// text with no markers. Matched on the trimmed chunk the way WheelLog does - testing
// a word at offset 0 threw away any reply that arrived with a leading byte.
function readBanner(chunk) {
  banner = Decoder.decode(chunk).trim()

  if (banner.slice(0, 4) == 'NAME')
    setWheelModel(banner)
  else if (banner.slice(0, 3) == 'MPU')
    setImuModel(banner)
  else
    setFirmware(banner)
}

function addToFrame(chunk, from, to) {
  taken = Math.min(to - from, frameLength - frameFilled)
  frame.set(chunk.subarray(from, from + taken), frameFilled)
  frameFilled += taken
}

function readMainPackets(event) {
  chunk = new Uint8Array(event.target.value.buffer)

  if (debug)
    console.log('in:', Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' '))

  start = -1
  end = -1
  for (let i = 0; i < chunk.length; i++) {
    if (start < 0 && chunk[i] == 0x55 && chunk[i + 1] == 0xAA)
      start = i
    else if (end < 0 && chunk[i] == 0x5A && chunk[i + 1] == 0x5A &&
             chunk[i + 2] == 0x5A && chunk[i + 3] == 0x5A)
      end = i

    if (start >= 0 && end >= 0)
      break
  }

  if (start < 0 && end < 0) {
    readBanner(chunk)
    return
  }

  if (end >= 0) {
    addToFrame(chunk, 0, end + 4)
    if (frameFilled == frameLength && frame[0] == 0x55 && frame[1] == 0xAA &&
        frameTypes.includes(frame[18]))
      readFrame()
    frameFilled = 0
  }

  // A start marker voids whatever is still pending: that frame lost its tail
  if (start >= 0) {
    frameFilled = 0
    addToFrame(chunk, start, chunk.length)
  }
}

function appendElement(key, value) {
  return `
  <div class="mb-2 row">
    <label class="col-lg-5 col-form-label" for="${key}">${key}:</label>
    <div class="col-lg-7">
      <input class="form-control" id="${key}" type="text" value="${value}" disabled readonly>
    </div>
  </div>
  `
}

function appendTempHelp() {
  tempElement = document.getElementById('Tem')
  if (!tempElement)
    return

  tempHelp = document.createElement('small')
  tempHelp.className = 'form-text text-muted'
  tempHelp.textContent = 'MPU6500 format'
  tempElement.after(tempHelp)
}

function readExtendedPackets(event) {
  fragment = Decoder.decode(event.target.value)
  line += fragment

  if (!fragment.endsWith('\r\n'))
    return

  page = line
  line = ''

  keys = page.match(/[A-z/=]+/g)
  values = page.match(/-?\d+/g)

  if (!keys || !values)
    return

  keys = keys.map(l => l.split('=')[0])

  // indexOf answers -1 when the key is absent, and the old test compared against 1,
  // so an absent PWM read values[-1] and drove the gauge with NaN, while a PWM that
  // did land at index 1 was the one case that got skipped.
  pwmIndex = keys.indexOf('PWM')
  if (pwmIndex != -1) {
    pwm = Math.abs(values[pwmIndex] / 100).toFixed(1)
    gauge.set(pwm)
  }

  tempIndex = keys.indexOf('Tem')
  if (tempIndex != -1)
    values[tempIndex] = (values[tempIndex] / 333.87 + 21.0).toFixed(2)

  if (rendered) {
    try { keys.forEach((key, i) => setField(key, values[i])) }
    catch { rendered = false }
  }
  else {
    html = ''
    keys.forEach((key, i) => html += appendElement(key, values[i]))
    document.getElementById('extended-data').innerHTML = html
    appendTempHelp()
    rendered = true
  }

  if (debug)
    console.log(page)
}
