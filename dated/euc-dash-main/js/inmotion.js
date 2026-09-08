// Inmotion speaks two unrelated protocols and the wheels are told apart by which BLE
// service they carry. V5 / V8 / V10 and the R series split the link over two services
// and answer a CAN-over-BLE frame; V11 and everything after moved to a Nordic UART and
// a much shorter frame. Both are polled - an Inmotion sends nothing unasked - and both
// wrap their frames with AA AA ... and escape a literal A5, 55 or AA byte with A5.
//
// Decoded per WheelLog's InMotionAdapter and InmotionAdapterV2, cross-checked against
// this repo's own eucInmotionV10 and eucInmotionV2 watch modules.

const debug = new URL(window.location.href).searchParams.get('debug')
const maxCellVolt = 4.2
const minCellVolt = 3.3
const pollInterval = 250

const nordicUart = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  notify:  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  write:   '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
}

const transports = [
  { protocol: 'v2', service: nordicUart.service, notify: nordicUart.notify,
    write: nordicUart.write },
  { protocol: 'v1', service: 0xFFE0, notify: 0xFFE4, writeService: 0xFFE5, write: 0xFFE9 }
]

// V1: the CAN frame ids the wheel answers with
const idFastInfo = 0x0F550113
const idSlowInfo = 0x0F550114
const idAlert    = 0x0F780101

// V1: speed comes out of the frame in the wheel's own units. Every model but the two
// R1 samples and the R0 uses 3812, and the two halves are averaged, so km/h is
// (a + b) * 3.6 / (3812 * 2).
const speedFactor = 3812

// V2 realtime layouts, by the series byte the wheel reports in its main-info reply
const v2Models = {
  6: { name: 'V11', cells: 20, speed:  9, mosfet: 47, battery: 49, minLength: 46 },
  7: { name: 'V12', cells: 24, speed:  9, mosfet: 45, battery: 47, minLength: 44 },
  8: { name: 'V13', cells: 30, speed: 13, mosfet: 63, battery: 64, minLength: 65, pwm: 19 },
  9: { name: 'V14', cells: 30, speed: 13, mosfet: 63, battery: 64, minLength: 65, pwm: 19 }
}

const v1Models = {
  '0': 'R1N', '1': 'R1S', '2': 'R1CF', '3': 'R1AP', '4': 'R1EX', '5': 'R1Sample',
  '6': 'R1T', '7': 'R10', '10': 'V3', '11': 'V3C', '12': 'V3PRO', '13': 'V3S',
  '20': 'R2', '21': 'R2N', '22': 'R2S', '23': 'R2Sample', '24': 'R2EX', '30': 'R0',
  '50': 'V5', '51': 'V5PLUS', '52': 'V5F', '53': 'V5D', '60': 'L6', '61': 'Lively',
  '80': 'V8', '85': 'Glide3', '86': 'V8F', '87': 'V8S',
  '100': 'V10S', '101': 'V10SF', '140': 'V10', '141': 'V10F', '142': 'V10T', '143': 'V10FT'
}

const workModes = ['idle', 'drive', 'zero', 'large angle', 'check', 'lock', 'error',
                   'carry', 'remote control', 'shutdown', 'pom stop', 'unknown', 'unlock']

let notifyCharacteristic = null
let writeCharacteristic = null
let protocol = ''
let packCells = 20
let cellsPinned = false
let pollTimer = 0
let pollStep = 0
let v2Model = null

// The escape-aware collector both protocols need. A payload byte of A5, 55 or AA is
// sent as A5 followed by itself, so an A5 that is not itself escaped is the escape
// and contributes nothing. A frame starts on two unescaped AA.
//
// WheelLog tracks this with "was the previous raw byte A5", which reads the middle A5
// of A5 A5 A5 AA - a literal A5 followed by an escaped AA - as an ordinary byte and
// loses the rest of that frame. A flag that is cleared once the escape is spent gets
// that case right, so the state here is the flag plus the previous byte that arrived
// unescaped, which is what tells a real 55 55 tail from an escaped 55 in the data.
let buffer = []
let escaped = false
let plainBefore = -1

function resetCollector() {
  buffer = []
  escaped = false
  plainBefore = -1
}

// V2 says how long it is in byte 3; V1 closes on an unescaped 55 55
function frameComplete(atTail) {
  if (protocol == 'v2')
    return buffer.length >= 5 && buffer.length == buffer[3] + 5

  if (!atTail)
    return false

  // The long replies declare 0xFE for their length and carry the real one in the
  // data field, so those have to reach it before 55 55 counts
  return buffer[14] != 0xFE || buffer.length == buffer[6] + 21
}

function collect(byte) {
  if (byte == 0xA5 && !escaped) {
    escaped = true
    plainBefore = -1
    return null
  }

  const plain = !escaped
  const previous = plainBefore
  escaped = false
  plainBefore = plain ? byte : -1

  if (buffer.length == 0) {
    if (plain && byte == 0xAA && previous == 0xAA)
      buffer = [0xAA, 0xAA]
    return null
  }

  buffer.push(byte)

  // A reply longer than it said it would be is junk, drop it and resynchronise
  if (protocol == 'v1' && buffer[14] == 0xFE && buffer.length > buffer[6] + 21) {
    resetCollector()
    return null
  }

  if (!frameComplete(plain && byte == 0x55 && previous == 0x55))
    return null

  const frame = Uint8Array.from(buffer)
  resetCollector()
  return frame
}

function el(id) {
  return document.getElementById(id)
}

function setField(field, val) {
  element = el(field)
  if (element)
    element.value = val
}

function setPackCells(cells) {
  packCells = parseInt(cells)
  cellsPinned = true
  el('pack-cells').value = packCells
  updateVoltageHelpText()
}

function guessPackCells(cells) {
  if (cellsPinned)
    return

  packCells = cells
  el('pack-cells').value = cells
  updateVoltageHelpText()
}

function updateVoltageHelpText() {
  el('voltage-help').innerText =
    `${packCells}S - min: ${(packCells * minCellVolt).toFixed(1)}v` +
    ` - max: ${(packCells * maxCellVolt).toFixed(1)}v`
}

function setBattery(voltage) {
  battery = 100 * (voltage / packCells - minCellVolt) / (maxCellVolt - minCellVolt)
  setField('battery', Math.min(100, Math.max(0, battery)).toFixed(1))
}

function checksumXor(bytes) {
  return bytes.reduce((check, byte) => check ^ byte, 0) & 0xFF
}

function checksumSum(bytes) {
  return bytes.reduce((check, byte) => (check + byte) & 0xFF, 0)
}

// ---------------------------------------------------------------- V2: V11 and after

// Every V2 command is a fixed frame whose last byte is the xor of the rest
function v2Command(bytes) {
  const frame = Uint8Array.from(bytes.concat([0]))
  frame[frame.length - 1] = checksumXor(bytes)
  return frame
}

const v2Commands = {
  live:        [0xAA, 0xAA, 0x14, 0x01, 0x04],
  stats:       [0xAA, 0xAA, 0x14, 0x01, 0x11],
  settings:    [0xAA, 0xAA, 0x14, 0x02, 0x20, 0x20],
  version:     [0xAA, 0xAA, 0x11, 0x02, 0x02, 0x06],
  serial:      [0xAA, 0xAA, 0x11, 0x02, 0x02, 0x02],
  type:        [0xAA, 0xAA, 0x11, 0x02, 0x02, 0x01],
  lightsOn:    [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x50, 0x01],
  lightsOff:   [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x50, 0x00],
  drlOn:       [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2D, 0x01],
  drlOff:      [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2D, 0x00],
  fanOn:       [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x43, 0x01],
  fanOff:      [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x43, 0x00],
  liftOn:      [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2E, 0x01],
  liftOff:     [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2E, 0x00],
  lock:        [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x31, 0x01],
  unlock:      [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x31, 0x00],
  rideComfort: [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x23, 0x00],
  rideSport:   [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x23, 0x01],
  mute:        [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2C, 0x00],
  unmute:      [0xAA, 0xAA, 0x14, 0x03, 0x60, 0x2C, 0x01],
  horn:        [0xAA, 0xAA, 0x14, 0x04, 0x60, 0x51, 0x00, 0x01]
}

// The wheel answers one request at a time, so the page walks the list. Info and
// settings only need asking once each, live and stats keep repeating.
const v2Poll = ['type', 'serial', 'version', 'settings', 'stats', 'live', 'live', 'live']

function readV2Frame(frame) {
  const data = new DataView(frame.buffer)
  const length = frame[3]
  const message = frame[2]
  const command = frame[4] & 0x7F

  if (checksumXor(Array.from(frame.subarray(0, frame.length - 1))) != frame[frame.length - 1])
    return

  if (message == 0x11 && command == 0x02)
    return readV2Info(frame, data, length)

  if (message != 0x14)
    return

  if (command == 0x04) return readV2Live(frame, data, length)
  if (command == 0x11) return readV2Stats(data, length)
  if (command == 0x20) return readV2Settings(data, length)
}

function readV2Info(frame, data, length) {
  if (frame[5] == 0x01 && length >= 6) {
    v2Model = v2Models[frame[7]]
    setField('wheel-model', v2Model ? v2Model.name : `unknown (${frame[7]})`)
    if (v2Model)
      guessPackCells(v2Model.cells)
    return
  }

  if (frame[5] == 0x02 && length >= 17) {
    serial = ''
    for (let i = 6; i < 22; i++)
      serial += String.fromCharCode(frame[i])
    setField('serial', serial)

    // The serial's first digits are the build date, packed as hex nibbles
    setField('manufactured', [
      2000 + parseInt(serial.substr(0, 2), 16),
      parseInt(serial.substr(2, 1), 16),
      parseInt(serial.substr(3, 1) + serial.substr(5, 1), 16)
    ].join('-'))
    return
  }

  if (frame[5] == 0x06 && length >= 24)
    setField('firmware', [frame[19], frame[18], data.getUint16(16, true)].join('.'))
}

function readV2Live(frame, data, length) {
  if (!v2Model || length < v2Model.minLength)
    return

  voltage = data.getUint16(5, true) / 100
  setField('voltage', voltage.toFixed(2))
  setBattery(voltage)

  setField('phase-current', (data.getInt16(7, true) / 100).toFixed(2))
  setField('speed', Math.abs(data.getInt16(v2Model.speed, true) / 100).toFixed(1))

  // The temperatures are whole degrees with a fixed offset, not a scaled reading
  setField('temp', frame[v2Model.mosfet] - 176)
  setField('battery-temp', frame[v2Model.battery] - 176)

  if (v2Model.pwm)
    setField('pwm', data.getInt16(v2Model.pwm, true))
}

function readV2Stats(data, length) {
  if (length < 22)
    return

  setField('total-distance', (data.getUint32(5, true) / 100).toFixed(2))
  setField('total-ride-time', Math.floor(data.getUint32(17, true) / 60))
  setField('ride-time', Math.floor(data.getUint32(21, true) / 60))
}

function readV2Settings(data, length) {
  if (length < 8)
    return

  setField('speed-limit', (data.getUint16(6, true) / 100).toFixed(1))
  setField('volume', data.getUint8(13))
}

// -------------------------------------------------------- V1: V5, V8, V10, R series

// A V1 command is the same CAN frame the wheel answers with: id, eight data bytes,
// length, channel, format, type, then a sum check and the 55 55 tail. Everything is
// escaped on the way out, which is why these are built rather than written literally.
function v1Command(id, data, length) {
  const body = [
    id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, (id >>> 24) & 0xFF,
    ...data, length === undefined ? 8 : length, 5, 0, 0
  ]

  const frame = [0xAA, 0xAA]
  for (const byte of body.concat([checksumSum(body)])) {
    if (byte == 0xAA || byte == 0x55 || byte == 0xA5)
      frame.push(0xA5)
    frame.push(byte)
  }

  return Uint8Array.from(frame.concat([0x55, 0x55]))
}

const noData = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]

const v1Commands = {
  live:        () => v1Command(idFastInfo, noData),
  info:        () => v1Command(idSlowInfo, noData),
  // The wheel ignores everything until it has been sent a pin, and 000000 is what
  // both WheelLog and eucInmotionV10 send for a wheel that has never had one set
  pin:         () => v1Command(0x0F550307, [0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0, 0]),
  lightsOn:    () => v1Command(0x0F55010D, [1, 0, 0, 0, 0, 0, 0, 0]),
  lightsOff:   () => v1Command(0x0F55010D, [0, 0, 0, 0, 0, 0, 0, 0]),
  rideComfort: () => v1Command(0x0F550115, [0xB2, 0, 0, 0, 0, 0, 0, 0]),
  rideSport:   () => v1Command(0x0F550115, [0xB2, 0, 0, 0, 1, 0, 0, 0]),
  horn:        () => v1Command(0x0F550609, [4, 0, 0, 0, 0, 0, 0, 0]),
  beep:        () => v1Command(0x0F550609, [0x15, 0, 0, 0, 0, 0, 0, 0])
}

const v1Poll = ['info', 'live', 'live', 'live', 'live']

function readV1Frame(frame) {
  // dataBuffer is everything between the AA AA header and the check plus 55 55 tail
  const end = frame.length - 3
  const body = frame.subarray(2, end)

  if (checksumSum(Array.from(body)) != frame[end])
    return

  if (body.length < 16)
    return

  const data = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const id = data.getUint32(0, true)

  // A long reply says 0xFE for its length and puts the real one in the data field
  if (body[12] != 0xFE)
    return

  const extendedLength = data.getUint32(4, true)
  if (extendedLength != body.length - 16)
    return

  const extended = new DataView(body.buffer, body.byteOffset + 16, extendedLength)

  if (id == idFastInfo) readV1Live(extended)
  else if (id == idSlowInfo) readV1Info(extended)
  else if (id == idAlert) setField('fault-alarms', `alert ${extended.getUint8(0)}`)
}

function readV1Live(data) {
  setField('pitch', (data.getInt32(0, true) / 65536).toFixed(2))

  speed = (data.getInt32(12, true) + data.getInt32(16, true)) * 3.6 / (speedFactor * 2)
  setField('speed', Math.abs(speed).toFixed(1))

  setField('phase-current', (data.getInt32(20, true) / 100).toFixed(2))

  voltage = data.getUint32(24, true) / 100
  setField('voltage', voltage.toFixed(2))
  setBattery(voltage)

  setField('temp', data.getInt8(32))
  setField('battery-temp', data.getInt8(34))
  setField('total-distance', (data.getUint32(44, true) / 1000).toFixed(2))
  setField('trip-distance', (data.getUint32(48, true) / 1000).toFixed(2))

  mode = data.getUint32(60, true)
  setField('work-mode', workModes[mode] === undefined ? mode : workModes[mode])
}

function readV1Info(data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  if (bytes.length > 107) {
    id = (bytes[107] > 0 ? `${bytes[107]}` : '') + bytes[104]
    setField('wheel-model', v1Models[id] || `unknown (${id})`)
    guessPackCells(20)
  }

  if (bytes.length > 27)
    setField('firmware', `${bytes[27]}.${bytes[26]}.${data.getUint16(24, true)}`)

  serial = ''
  for (let i = 7; i >= 0; i--)
    serial += bytes[i].toString(16).padStart(2, '0').toUpperCase()
  setField('serial', serial)

  if (bytes.length > 61)
    setField('speed-limit', (data.getUint16(60, true) / 1000).toFixed(1))

  if (bytes.length > 80)
    setField('lights', bytes[80] == 1 ? 'on' : 'off')

  if (bytes.length > 126)
    setField('volume', Math.round(data.getUint16(125, true) / 100))

  if (bytes.length > 130)
    setField('leds', bytes[130] == 1 ? 'on' : 'off')

  if (bytes.length > 132)
    setField('ride-mode', bytes[132] == 1 ? 'sport' : 'comfort')

  // 0x20 is the softest pedal and 0x80 the hardest, reported as a percent
  if (bytes.length > 124)
    setField('pedal-hardness', (bytes[124] - 28) & 0xFF)

  if (bytes.length > 59)
    setField('pedal-tilt', (data.getInt32(56, true) / 6553.6).toFixed(1))
}

// ------------------------------------------------------------------------ transport

async function scan() {
  device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'V' }, { namePrefix: 'Inmotion' }, { namePrefix: 'IM' },
              { namePrefix: 'R' }, { services: [0xFFE5] },
              { services: [nordicUart.service] }],
    optionalServices: [0xFFE0, 0xFFE5, nordicUart.service]
  })

  server = await device.gatt.connect()

  let opened = null
  let lastError = null
  for (const transport of transports) {
    try { opened = await openTransport(transport); break }
    catch (error) { lastError = error }
  }

  if (!opened)
    throw lastError

  protocol = opened.protocol
  notifyCharacteristic = opened.notify
  writeCharacteristic = opened.write

  await notifyCharacteristic.startNotifications()
  notifyCharacteristic.addEventListener('characteristicvaluechanged', readPacket)
  initialize()
}

async function openTransport(transport) {
  const service = await server.getPrimaryService(transport.service)
  const notify = await service.getCharacteristic(transport.notify)
  const writeService = transport.writeService
    ? await server.getPrimaryService(transport.writeService)
    : service

  return {
    protocol: transport.protocol,
    notify,
    write: await writeService.getCharacteristic(transport.write)
  }
}

function initialize() {
  resetCollector()
  pollStep = 0
  v2Model = null
  setField('ble-name', device.name || '')
  setField('protocol', protocol == 'v2' ? 'V11 and newer' : 'V10 and older')
  el('scan-disconnect').innerText = 'Disconnect'
  el('scan-disconnect').className = 'btn-lg btn-danger'
  el('scan-disconnect').onclick = disconnect
  el('controls').classList.remove('invisible')
  el(protocol == 'v2' ? 'v1-only' : 'v2-only').style.display = 'none'
  el(protocol == 'v2' ? 'v2-only' : 'v1-only').style.display = null
  updateVoltageHelpText()

  if (protocol == 'v1')
    sendCommand('pin')

  pollTimer = setInterval(poll, pollInterval)
}

function disconnect() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
  device.gatt.disconnect()
  notifyCharacteristic = null
  writeCharacteristic = null
  el('scan-disconnect').innerText = 'Scan & Connect'
  el('scan-disconnect').className = 'btn-lg btn-primary'
  el('scan-disconnect').onclick = scan
  el('controls').classList.add('invisible')
}

function commandFrame(name) {
  if (protocol == 'v2')
    return v2Commands[name] && v2Command(v2Commands[name])

  return v1Commands[name] && v1Commands[name]()
}

async function sendCommand(name) {
  frame = commandFrame(name)
  if (!frame || !writeCharacteristic)
    return

  if (debug)
    console.log('out:', Array.from(frame, b => b.toString(16).padStart(2, '0')).join(' '))

  try {
    if (writeCharacteristic.writeValueWithoutResponse)
      await writeCharacteristic.writeValueWithoutResponse(frame)
    else
      await writeCharacteristic.writeValue(frame)
  }
  catch (error) { console.log(`${name} failed:`, error) }
}

// An Inmotion answers questions and volunteers nothing, so the page keeps asking
async function poll() {
  const schedule = protocol == 'v2' ? v2Poll : v1Poll
  await sendCommand(schedule[pollStep % schedule.length])
  pollStep++
}

function readPacket(event) {
  chunk = new Uint8Array(event.target.value.buffer)

  if (debug)
    console.log('in:', Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' '))

  for (const byte of chunk) {
    frame = collect(byte)
    if (!frame)
      continue

    if (debug)
      console.log('frame:', Array.from(frame, b => b.toString(16).padStart(2, '0')).join(' '))

    if (protocol == 'v2')
      readV2Frame(frame)
    else
      readV1Frame(frame)
  }
}
