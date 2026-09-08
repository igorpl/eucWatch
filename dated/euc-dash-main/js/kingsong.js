const debug = new URL(window.location.href).searchParams.get('debug')
const Decoder = new TextDecoder()
const maxCellVolt = 4.2
const minCellVolt = 3.3

// A Kingsong frame is always exactly 20 bytes: AA 55, fourteen bytes of payload, the
// command at byte 16, then 14 5A 5A. The same shape goes both ways, and a command has
// to reach the wheel as one write - this page used to send Begode's single bytes one
// at a time, which is a different protocol entirely and nothing here answered it.
const frameLength = 20
const commandGap = 150

// A Kingsong says nothing until it is asked. Model and serial come first because the
// model decides the cell count, and the serial reply is what WheelLog waits for before
// asking for the alarm speeds.
const initialRequests = ['getModel', 'getSerial', 'getAlarms', 'getPowerOff', 'getStrobe',
                         'getLedRide', 'getSpectrum', 'getBTMusic', 'getLock']

let packCells = 16
let cellsPinned = false     // the user picked a cell count, stop guessing from the model
let wheelModel = ''
let queue = Promise.resolve()

// WheelLog's getCellsForWheel table, by the model half of the wheel's own name
function cellsForModel(model) {
  if (['KS-18L', 'KS-16X', 'KS-16XF', 'KS-18LH', 'KS-18LY', 'KS-S18', 'KS-S16',
       'KS-S16P', 'RW'].includes(model) || model.startsWith('ROCKW'))
    return 20
  if (model == 'KS-S19') return 24
  if (['KS-S20', 'KS-S22'].includes(model)) return 30
  if (model == 'KS-F18P') return 36
  if (model == 'KS-F22P') return 42
  return 16
}

function frameFor(command, payload) {
  const frame = new Uint8Array(frameLength)
  frame[0] = 0xAA
  frame[1] = 0x55
  frame.set(payload || [], 2)
  frame[16] = command
  frame[17] = 0x14
  frame[18] = 0x5A
  frame[19] = 0x5A
  return frame
}

function commands(cmd, param) {
  switch(cmd) {
    case 'getModel':          return frameFor(0x9B)
    case 'getSerial':         return frameFor(0x63)
    case 'getAlarms':         return frameFor(0x98)
    case 'getPowerOff':       return frameFor(0x3F)
    case 'getStrobe':         return frameFor(0x54)
    case 'getLedRide':        return frameFor(0x6D)
    case 'getSpectrum':       return frameFor(0x80)
    case 'getBTMusic':        return frameFor(0x57)
    case 'getLock':           return frameFor(0x5E)
    case 'horn':              return frameFor(0x88)
    case 'beep':              return frameFor(0x7C)
    case 'calibrate':         return frameFor(0x89)
    case 'powerOff':          return frameFor(0x40, [0x00, 0xE0])
    // 0 hard, 1 medium, 2 soft, and byte 3 is the 0xE0 marker the wheel echoes back
    // in the live frame to say byte 14 really is the pedal mode
    case 'pedalMode':         return frameFor(0x87, [param, 0xE0])
    // 0 on, 1 off, 2 auto - the wheel takes the mode offset by 0x12
    case 'lightMode':         return frameFor(0x73, [param + 0x12, 0x01])
    // 0 on, 1 off, and the wheel reports byte 2 back the same way round
    case 'ledRide':           return frameFor(0x6C, [param])
    case 'strobe':            return frameFor(0x53, [param])
    case 'spectrum':          return frameFor(0x7D, [param])
    case 'btMusic':           return frameFor(0x56, [param])
    case 'liftSensor':        return frameFor(0x7E, [param])
    case 'volumeUp':          return frameFor(0x95, [0xFF])
    case 'volumeDown':        return frameFor(0x95, [0x00, 0xFF])
    case 'powerOffTimer':     return frameFor(0x3F, [0x01, 0x00, param & 0xFF, (param >> 8) & 0xFF])
    case 'lock':              return frameFor(0x5D, [0x01])
    // The four speeds always travel together, the wheel has no command for one alone
    case 'speedLimits':       return frameFor(0x85,
      [param[0], 0, param[1], 0, param[2], 0, param[3], 0, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36])
    default:                  return frameFor(0x00)
  }
}

const faultAlarms = {
  202: 'overcurrent error',
  203: 'motor blocked',
  217: 'hall sensor error',
  218: 'overpower warning',
  220: 'overvoltage error',
  232: 'lift sensor error'
}

const wheelColours = {
  W: 'white', B: 'black', S: 'silver gray', Y: 'yellow',
  R: 'red', D: 'rubber black', C: 'custom'
}

// Writes are serialised through one chain with a gap between them: the wheel drops
// commands that arrive back to back, which is why WheelLog spaces its own by 100ms.
function sendCommand(cmd, param) {
  queue = queue
    .then(() => characteristic.writeValue(commands(cmd, param)))
    .then(() => new Promise(r => setTimeout(r, commandGap)))
    .catch(error => console.log(`${cmd} failed:`, error))

  return queue
}

async function scan() {
  device = await navigator.bluetooth.requestDevice({ filters: [
    { namePrefix: 'KS' },
    { namePrefix: 'ROCKW' },
    { namePrefix: 'RW' },
    { services: [0xFFE0] },
  ],
  optionalServices: [0xFFE0] })
  server = await device.gatt.connect()
  service = await server.getPrimaryService(0xFFE0)
  characteristic = await service.getCharacteristic(0xFFE1)
  await characteristic.startNotifications()
  characteristic.addEventListener('characteristicvaluechanged', readPacket)
  initialize()
}

function initialize() {
  wheelModel = ''
  queue = Promise.resolve()
  setField('ble-name', device.name || '')
  document.getElementById('scan-disconnect').innerText = 'Disconnect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-danger'
  document.getElementById('scan-disconnect').onclick = disconnect
  document.getElementById('controls').classList.remove('invisible')
  setupGauge()
  initialRequests.forEach(request => sendCommand(request))
}

function disconnect() {
  device.gatt.disconnect()
  document.getElementById('scan-disconnect').innerText = 'Scan & Connect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-primary'
  document.getElementById('scan-disconnect').onclick = scan
  document.getElementById('controls').classList.add('invisible')
}

function setField(field, val) {
  element = document.getElementById(field)
  if (element)
    element.value = val
}

function selectRadio(group, index) {
  chosen = document.getElementById(`${group}-${index}`)
  if (!chosen)
    return

  document.getElementsByName(chosen.name).forEach(radio => radio.checked = radio == chosen)
}

function setPackCells(cells) {
  packCells = parseInt(cells)
  cellsPinned = true
  document.getElementById('pack-cells').value = packCells
  updateVoltageHelpText()
}

function updateVoltageHelpText() {
  minVoltage = (packCells * minCellVolt).toFixed(1)
  maxVoltage = (packCells * maxCellVolt).toFixed(1)
  document.getElementById('voltage-help').innerText =
    `${packCells}S - min: ${minVoltage}v - max: ${maxVoltage}v`
}

function applySpeedLimits() {
  limits = ['alarm-1', 'alarm-2', 'alarm-3', 'tiltback-speed']
    .map(id => Math.min(100, Math.max(0, parseInt(document.getElementById(id).value) || 0)))

  sendCommand('speedLimits', limits)
}

function setPowerOffTimer() {
  minutes = Math.min(60, Math.max(0, parseInt(document.getElementById('poweroff-minutes').value) || 0))
  sendCommand('powerOffTimer', minutes * 60)
}

// A three-word little-endian distance, sent with its halves the other way round:
// the high half is at the lower offset. Both WheelLog and eucWatch read it this way.
function distanceAt(data, offset) {
  return (data.getUint16(offset, true) * 65536 + data.getUint16(offset + 2, true)) / 1000
}

// 0xA9 - the live frame, the only one the wheel sends unasked
function readLiveFrame(data) {
  voltage = data.getUint16(2, true) / 100
  setField('voltage', voltage.toFixed(2))

  battery = 100 * (voltage / packCells - minCellVolt) / (maxCellVolt - minCellVolt)
  setField('battery', Math.min(100, Math.max(0, battery)).toFixed(1))

  setField('speed', Math.abs(data.getUint16(4, true) / 100).toFixed(1))
  setField('total-distance', distanceAt(data, 6).toFixed(2))
  setField('phase-current', (data.getInt16(10, true) / 100).toFixed(2))
  setField('temp', (data.getInt16(12, true) / 100).toFixed(2))

  // Byte 14 is only the pedal mode when the wheel marks it as such in byte 15
  if (data.getUint8(15) == 0xE0)
    selectRadio('pedal-mode', data.getUint8(14))
}

// 0xB9 - trip, time, top speed, fan and charger
function readTripFrame(data) {
  setField('trip-distance', distanceAt(data, 2).toFixed(2))

  rideTime = data.getUint16(6, true)
  setField('ride-time', `${Math.floor(rideTime / 60)}:${`${rideTime % 60}`.padStart(2, '0')}`)

  setField('top-speed', (data.getUint16(8, true) / 100).toFixed(1))
  selectRadio('light-mode', data.getUint8(10) - 0x12)
  setField('wheel-state', data.getUint8(11) ? 'on' : 'off')
  setField('fan', data.getUint8(12) ? 'on' : 'off')
  setField('charging', data.getUint8(13) ? 'yes' : 'no')
  setField('motor-temp', (data.getInt16(14, true) / 100).toFixed(2))
}

// 0xF5 - board information, and the only PWM a Kingsong reports
function readBoardFrame(data) {
  setField('motor-line', data.getUint8(6))
  setField('gyro', data.getUint8(7))
  setField('motor-hall', data.getUint8(8))
  setField('cpu-load', data.getUint8(14))

  pwm = data.getUint8(15)
  setField('pwm', pwm)
  gauge.set(Math.min(100, Math.max(0.1, pwm)))
}

// 0xF6 - the speed the wheel is currently holding itself to, and its alarm word
function readLimitFrame(data) {
  setField('speed-limit', (data.getUint16(2, true) / 100).toFixed(1))
  setField('total-ride-time', data.getUint16(12, true))

  code = data.getUint16(14, true)
  setField('fault-alarms', code ? (faultAlarms[code] || code) : '')
}

// 0xB5, and 0xA4 which carries the same values and wants the request echoed back
function readAlarmFrame(data, command) {
  setField('alarm-1', data.getUint8(4))
  setField('alarm-2', data.getUint8(6))
  setField('alarm-3', data.getUint8(8))
  setField('tiltback-speed', data.getUint8(10))

  if (command == 0xA4)
    sendCommand('getAlarms')
}

// 0xB3 - the serial number, and the build details packed alongside it
function readSerialFrame(chunk) {
  serial = Decoder.decode(chunk.subarray(2, 16)) + Decoder.decode(chunk.subarray(17, 20))
  setField('serial', serial.replace(/\0/g, '').trim())

  setField('manufactured',
    `${Decoder.decode(chunk.subarray(11, 13))}-${Decoder.decode(chunk.subarray(13, 15))}` +
    `-20${Decoder.decode(chunk.subarray(9, 11))}`)

  colour = Decoder.decode(chunk.subarray(8, 9))
  setField('colour', wheelColours[colour] || colour)
}

// 0xBB - `KS-18L-1.05`: everything before the last dash is the model, the rest the
// firmware. The model is what decides the cell count, so the battery percentage is
// only right once this has arrived.
function readModelFrame(chunk) {
  end = chunk.indexOf(0, 2)
  name = Decoder.decode(chunk.subarray(2, end < 0 ? 16 : end)).trim()
  parts = name.split('-')

  wheelModel = parts.slice(0, -1).join('-')
  setField('wheel-model', wheelModel)
  setField('wheel-name', name)

  version = parseInt(parts[parts.length - 1])
  setField('firmware', isNaN(version) ? parts[parts.length - 1] : (version / 100).toFixed(2))

  if (!cellsPinned) {
    packCells = cellsForModel(wheelModel)
    document.getElementById('pack-cells').value = packCells
    updateVoltageHelpText()
  }
}

function readPacket(event) {
  chunk = new Uint8Array(event.target.value.buffer)

  if (debug)
    console.log('in:', Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' '))

  if (chunk.length < frameLength || chunk[0] != 0xAA || chunk[1] != 0x55)
    return

  data = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  command = chunk[16]

  switch (command) {
    case 0xA9: return readLiveFrame(data)
    case 0xB9: return readTripFrame(data)
    case 0xF5: return readBoardFrame(data)
    case 0xF6: return readLimitFrame(data)
    case 0xA4:
    case 0xB5: return readAlarmFrame(data, command)
    case 0xB3: return readSerialFrame(chunk)
    case 0xBB: return readModelFrame(chunk)
    case 0x3F: return setPowerOffMinutes(data)
    case 0x4C: return selectRadio('lift-sensor', chunk[2] ? 1 : 0)
    case 0x4A: return selectRadio('spectrum', chunk[2] ? 1 : 0)
    case 0x55: return selectRadio('strobe', chunk[2] ? 1 : 0)
    case 0x58: return selectRadio('bt-music', chunk[2] ? 1 : 0)
    case 0x6E: return selectRadio('led-ride', chunk[2] ? 1 : 0)
    case 0x5F: return setField('lock', chunk[2] ? 'locked' : 'unlocked')
    case 0x8A: return setPedalTilt(data, chunk)
  }
}

function setPowerOffMinutes(data) {
  seconds = data.getUint16(4, true)
  document.getElementById('poweroff-minutes').value = Math.round(seconds / 60)
  document.getElementById('poweroff-timer').textContent =
    `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`
}

function setPedalTilt(data, chunk) {
  if (chunk[2] != 0)
    return

  setField('pedal-tilt', (data.getInt16(4, true) / 100).toFixed(2))
}
