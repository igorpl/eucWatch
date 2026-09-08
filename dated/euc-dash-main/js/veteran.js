const Encoder = new TextEncoder()
const Decoder = new TextDecoder()
const debug = new URL(window.location.href).searchParams.get('debug')

// A telemetry frame is DC 5A 5C <len> ... <crc32>, where <len> counts every byte up
// to the CRC, header included, so the frame is len + 4 bytes long. Old firmware
// always sent len = 0x20 (36 bytes) over two notifications; current wheels vary the
// length per frame (47..73 seen on a Sherman S) and spread it over as many
// notifications as it takes, so frames have to be reassembled by that length.
const frameHeader = [0xDC, 0x5A, 0x5C]
const minFrameLength = 36
const maxFrameLength = 255

// CHANGESTRORPACK toggles the wheel between those frames and the string debug dump.
// A Veteran has no beep command of its own - it answers a command it accepts with a
// beep, which is how eucVeteran.js makes it beep at all - so every toggle costs one.
// The page therefore sends it only when what the wheel is sending is not what the
// open view needs, and at most once per interval below. Sending it per unparsed
// notification, which is what a parse failure used to do, is a mode flip every few
// seconds for as long as the page is open, and the wheel beeps through all of it.
const switchInterval = 4000

let frame = null
let frameFilled = 0
let wheelMode = ''             // '' unknown, 'packets' or 'strings': what is arriving
let viewMode = 'packets'       // what the open view is asking for
let lastSwitchAt = 0
let line = ''
let rendered = false

function commands(cmd) {
  switch(cmd) {
    case 'horn':          return 'b'
    case 'pedalSoft':     return 'SETs'
    case 'pedalMedium':   return 'SETm'
    case 'pedalHard':     return 'SETh'
    case 'lightsOn':      return 'SetLightON'
    case 'lightsOff':     return 'SetLightOFF'
    case 'VolumeUp':      return 'SetFctVol+'
    case 'VolumeDown':    return 'SetFctVol-'
    case 'clearDistance': return 'CLEARMETER'
    case 'switchPackets': return 'CHANGESTRORPACK'
    case 'nextPage':      return 'CHANGESHOWPAGE'
    default:              return cmd
  }
}

const pedalModeHuman = {
  1: 'soft',
  2: 'medium',
  3: 'hard'
}

async function sendCommand(cmd) {
  await characteristic.writeValue(Encoder.encode(commands(cmd)))
}

async function scan() {
  device = await navigator.bluetooth.requestDevice(
    { filters: [{ namePrefix: 'LK' }, { namePrefix: 'NF' }], optionalServices: [0xFFE0]})
  server = await device.gatt.connect()
  service = await server.getPrimaryService(0xFFE0)
  characteristic = await service.getCharacteristic(0xFFE1)
  await characteristic.startNotifications()
  characteristic.addEventListener('characteristicvaluechanged', readPacket)
  initialize()
}

function initialize() {
  resetFrame()
  resetMode()
  document.getElementById('scan-disconnect').innerText = 'Disconnect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-danger'
  document.getElementById('scan-disconnect').onclick = disconnect
  document.getElementById('packet-switch').classList.remove('invisible')
}

function disconnect() {
  device.gatt.disconnect()
  resetFrame()
  resetMode()
  document.getElementById('scan-disconnect').innerText = 'Scan & Connect'
  document.getElementById('scan-disconnect').className = 'btn-lg btn-primary'
  document.getElementById('scan-disconnect').onclick = scan
  document.getElementById('packet-switch').classList.add('invisible')
  document.getElementById('next-page').classList.add('invisible')
}

function setField(field, val) {
  document.getElementById(field).value = val
}

function resetFrame() {
  frame = null
  frameFilled = 0
}

function resetMode() {
  wheelMode = ''
  viewMode = 'packets'
  lastSwitchAt = 0
  line = ''
  rendered = false
}

function switchToMainPackets() {
  document.getElementById('extended').style.display = 'none'
  document.getElementById('main').style.display = null
  document.getElementById('packet-switch').innerText = 'Switch to extended packets'
  document.getElementById('packet-switch').onclick = switchToExtendedPackets
  document.getElementById('next-page').classList.add('invisible')
  resetFrame()
  viewMode = 'packets'
  requestMode()
}

function switchToExtendedPackets() {
  document.getElementById('main').style.display = 'none'
  document.getElementById('extended').style.display = null
  document.getElementById('packet-switch').innerText = 'Switch to main packets'
  document.getElementById('packet-switch').onclick = switchToMainPackets
  document.getElementById('next-page').classList.remove('invisible')
  document.getElementById('extended-data').innerHTML = ''
  line = ''
  rendered = false
  viewMode = 'strings'
  requestMode()
}

async function nextPage() {
  line = ''
  rendered = false
  await sendCommand('nextPage')
}

// The only place the page toggles the wheel's output mode. It asks once the wheel has
// actually been heard from, so a toggle is never spent guessing, and it stops asking
// the moment the wheel is sending what the open view wants.
function requestMode() {
  if (!wheelMode || wheelMode == viewMode)
    return

  now = Date.now()
  if (now - lastSwitchAt < switchInterval)
    return

  lastSwitchAt = now
  sendCommand('switchPackets').catch(error => console.log('mode switch failed:', error))
}

function startsFrame(chunk) {
  return chunk.length > 3 && frameHeader.every((byte, i) => chunk[i] == byte)
}

// String mode sends printable lines of `1503>AD17R 1700>AD16T ...`. Telemetry frames
// are full of zero bytes, so printable text is the first half of the test.
function isPrintable(chunk) {
  return chunk.every(byte =>
    byte == 0x09 || byte == 0x0A || byte == 0x0D || (byte >= 0x20 && byte <= 0x7E))
}

// The second half, and only needed to decide the wheel has entered string mode: a
// telemetry frame carries no '>'. Once the wheel is known to be sending text every
// printable chunk belongs to it, including the short tail of a page, which has no
// '>' of its own. Without that a frame continuation chunk that happens to be all
// printable would be read as text and would cost a toggle, which costs a beep.
function startsText(chunk) {
  return chunk.includes(0x3E)
}

function readPacket(event) {
  chunk = new Uint8Array(event.target.value.buffer)

  if (debug)
    console.log('in:', Array.from(chunk, b => b.toString(16).padStart(2, '0')).join(' '))

  if (frame || startsFrame(chunk)) {
    wheelMode = 'packets'
    readMainPackets(chunk)
  }
  else if (isPrintable(chunk) && (wheelMode == 'strings' || startsText(chunk))) {
    wheelMode = 'strings'
    readExtendedPackets(chunk)
  }
  else return  // the tail of a frame whose header was missed, nothing to do with it

  requestMode()
}

function readMainPackets(chunk) {
  if (startsFrame(chunk)) {
    frameLength = chunk[3] + 4

    if (frameLength < minFrameLength || frameLength > maxFrameLength) {
      resetFrame()
      return
    }

    frame = new Uint8Array(frameLength)
    frameFilled = 0
  }

  taken = Math.min(chunk.length, frame.length - frameFilled)
  frame.set(chunk.subarray(0, taken), frameFilled)
  frameFilled += taken

  if (frameFilled < frame.length)
    return

  if (viewMode == 'packets')
    readMainFrame(new DataView(frame.buffer))

  resetFrame()
}

function pedalModeHumanized(mode) {
  if (pedalModeHuman[mode])
    return pedalModeHuman[mode]

  // New wheels dropped the three modes for a percentage, reported here as value - 100
  if (mode >= 100 && mode <= 200)
    return `${mode - 100}% sensitivity`

  return mode
}

function readMainFrame(data) {
  voltage = data.getUint16(4) / 100
  setField('voltage', voltage)

  speed = data.getInt16(6) / 10
  setField('speed', speed)

  tripDistanceHigh = data.getUint16(8)
  tripDistanceLow = data.getUint16(10)
  tripDistance = ((tripDistanceHigh + (tripDistanceLow << 16)) / 1000).toFixed(2)
  setField('trip-distance', tripDistance)

  totalDistanceHigh = data.getUint16(12)
  totalDistanceLow = data.getUint16(14)
  totalDistance = ((totalDistanceHigh + (totalDistanceLow << 16)) / 1000).toFixed(1)
  setField('total-distance', totalDistance)

  phaseCurrent = data.getInt16(16) / 10
  setField('phase-current', phaseCurrent)

  temperature = data.getInt16(18) / 100
  setField('temperature', temperature)

  powerOffTime = data.getUint16(20)
  powerOffMinutes = Math.floor(powerOffTime / 60)
  powerOffSeconds = powerOffTime - (powerOffMinutes * 60)
  setField('poweroff-timer', `${powerOffMinutes}:${powerOffSeconds}`)

  chargeMode = data.getUint8(23)
  setField('charge-mode', chargeMode)

  alarmSpeed = data.getUint16(24) / 10
  setField('alarm-speed', alarmSpeed == 280 ? 'off' : alarmSpeed)

  tiltbackSpeed = data.getUint16(26) / 10
  setField('tiltback-speed', tiltbackSpeed == 280 ? 'off' : tiltbackSpeed)

  version = data.getUint16(28)
  setField('version',
    `${Math.floor(version / 1000)}.${Math.floor(version % 1000 / 100)}.${version % 100}`)

  // Byte 30 belongs to the version code, the pedal mode is byte 31 on its own
  pedalMode = data.getUint8(31)
  setField('pedal-mode', pedalModeHumanized(pedalMode))

  pitch = data.getInt16(32) / 100
  setField('pitch', pitch)

  pwm = data.getUint16(34) / 100
  setField('pwm', pwm)
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

function readExtendedPackets(chunk) {
  fragment = Decoder.decode(chunk)
  line += fragment

  // The view can be on main packets while the wheel is still finishing a string page,
  // in the window between asking for the switch and the wheel making it
  if (viewMode != 'strings') {
    line = ''
    return
  }

  if (!fragment.endsWith('P7') && !fragment.endsWith('BvFc') && !fragment.endsWith('U5'))
    return

  page = line
  line = ''

  keys = page.match(/>\w+/g)
  values = page.match(/-?\d+/g)

  if (!keys || !values)
    return

  keys = keys.map(k => k.slice(1))

  if (fragment.endsWith('U5')) {
    idleTime = page.match(/\d+:.+:.\d+/)
    keys.unshift('idle')
    values.splice(0, 3, idleTime ? idleTime[0] : '')
  }

  if (rendered) {
    try { keys.forEach((key, i) => setField(key, values[i])) }
    catch { rendered = false }
  }
  else {
    html = ''
    keys.forEach((key, i) => html += appendElement(key, values[i]))
    document.getElementById('extended-data').innerHTML = html
    rendered = true
  }
}
