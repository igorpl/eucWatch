// Raw telemetry logger. It deliberately knows nothing about how any wheel encodes
// its data - it records whatever bytes arrive, in the same shape the eucWatch dumps
// use (`... data : dc,5a,5c,...`), so captures can be replayed through the existing
// tooling. All it needs per brand is the transport: which service and characteristics
// carry the data, what to send on connect, and whether telemetry has to be polled.

const nordicUart = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  notify:  '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  write:   '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
}

// Kingsong frames are always 20 bytes: AA 55, payload, command, 14 5A 5A
function kingsongCommand(command) {
  return [0xAA, 0x55].concat(Array(14).fill(0), [command, 0x14, 0x5A, 0x5A])
}

const profiles = {
  veteran: {
    label: 'Leaperkim / Veteran',
    prefix: 'veteran',
    filters: [{ namePrefix: 'LK' }, { namePrefix: 'NF' }],
    transports: [{ service: 0xFFE0, notify: 0xFFE1, write: 0xFFE1 }]
  },
  begode: {
    label: 'Begode / Gotway',
    prefix: 'begode',
    filters: [{ namePrefix: 'GotWay' }, { namePrefix: 'Gotway' }, { namePrefix: 'GW' },
              { namePrefix: 'RW' }, { namePrefix: 'Begode' }, { services: [0xFFE0] }],
    transports: [{
      service: 0xFFE0, notify: 0xFFE1, write: 0xFFE1,
      // ask for the model name and code, they come back on the same characteristic
      init: [[0x4E], [0x56]]
    }]
  },
  kingsong: {
    label: 'Kingsong',
    prefix: 'kingsong',
    filters: [{ namePrefix: 'KS' }, { namePrefix: 'ROCKW' }, { services: [0xFFE0] }],
    transports: [{
      service: 0xFFE0, notify: 0xFFE1, write: 0xFFE1,
      // model then serial - a Kingsong stays quiet until it is asked something
      init: [kingsongCommand(0x9B), kingsongCommand(0x63)]
    }]
  },
  inmotion: {
    label: 'Inmotion',
    prefix: 'inmotion',
    filters: [{ namePrefix: 'V' }, { namePrefix: 'Inmotion' }, { namePrefix: 'IM' }],
    // V11 / V12 / V2 moved to the Nordic UART service, V10 and older split the
    // link over two services. Try the newer one first and fall back.
    transports: [
      { service: nordicUart.service, notify: nordicUart.notify, write: nordicUart.write,
        poll: [0xAA, 0xAA, 0x14, 0x01, 0x04, 0x11] },
      { service: 0xFFE0, notify: 0xFFE4, writeService: 0xFFE5, write: 0xFFE9,
        init: [[0xAA, 0xAA, 0x07, 0x03, 0xA5, 0x55, 0x0F, 0x30, 0x30, 0x30, 0x30, 0x30,
                0x30, 0x00, 0x00, 0x08, 0x05, 0x00, 0x00, 0x9B]],
        poll: [0xAA, 0xAA, 0x13, 0x01, 0xA5, 0x55, 0x0F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
               0xFF, 0xFF, 0xFF, 0x08, 0x05, 0x00, 0x00, 0x7D] }
    ]
  }
}

const allServices = [0xFFE0, 0xFFE5, nordicUart.service]
const pollInterval = 250
const flushInterval = 250

let device = null
let server = null
let notifyCharacteristic = null
let writeCharacteristic = null
let profile = null
let transport = null

let logging = false
let lines = []
let pending = []
let startedAt = 0
let frames = 0
let bytes = 0
let loggedFrames = 0
let loggedBytes = 0
let stopTimer = 0
let pollTimer = 0
let flushTimer = 0

function el(id) {
  return document.getElementById(id)
}

function setState(state, style) {
  el('state').value = state
  el('state').className = `form-control ${style || ''}`
}

function setInfo(text) {
  el('info').value = text
}

function selectedProfile() {
  return profiles[el('brand').value]
}

function pad(value, width) {
  return value.toString().padStart(width, '0')
}

function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(',')
}

function elapsed() {
  return (Date.now() - startedAt) / 1000
}

function stamp() {
  return elapsed().toFixed(3).padStart(8)
}

function comment(text) {
  pending.push(`# ${text}`)
}

function record(direction, bytes) {
  pending.push(`[${stamp()}] ${profile.prefix}: ${direction}: length: ${bytes.length}  data : ${hex(bytes)}`)
}

function flush() {
  if (!pending.length)
    return

  lines = lines.concat(pending)
  pending = []

  const log = el('log')
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
  log.value = lines.join('\n')
  if (atBottom)
    log.scrollTop = log.scrollHeight

  updateButtons()
}

function updateButtons() {
  const connected = Boolean(notifyCharacteristic)
  el('connect').disabled = connected
  el('disconnect').disabled = !connected
  el('start').disabled = !connected || logging
  el('stop').disabled = !logging
  el('save').disabled = lines.length == 0
  el('clear').disabled = lines.length == 0
  el('brand').disabled = connected
  el('any-device').disabled = connected
  el('duration').disabled = logging
}

function updateCounters() {
  const seconds = logging ? elapsed() : 0
  const rate = seconds > 0.5 ? ` (${(loggedFrames / seconds).toFixed(0)}/s)` : ''

  setInfo(logging
    ? `logging ${seconds.toFixed(1)}s - ${loggedFrames} frames, ${loggedBytes} bytes${rate}`
    : `${frames} frames seen, ${bytes} bytes - link: ${transport.description}`)
}

// Chrome only exposes writeValueWithoutResponse on characteristics that support it,
// and some wheels reject the with-response write outright.
async function write(characteristic, bytes) {
  const data = new Uint8Array(bytes)

  if (characteristic.writeValueWithoutResponse)
    await characteristic.writeValueWithoutResponse(data)
  else
    await characteristic.writeValue(data)

  if (logging)
    record('out', data)
}

function onNotification(event) {
  const value = event.target.value
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

  frames++
  bytes += data.length

  if (!logging)
    return

  loggedFrames++
  loggedBytes += data.length
  record('in', data)
}

async function poll() {
  if (!writeCharacteristic || !transport.poll)
    return

  try { await write(writeCharacteristic, transport.poll) }
  catch (error) { comment(`poll failed: ${error.message}`) }
}

async function openTransport(candidate) {
  const service = await server.getPrimaryService(candidate.service)
  const notify = await service.getCharacteristic(candidate.notify)

  let write = notify
  if (candidate.write != candidate.notify) {
    const writeService = candidate.writeService
      ? await server.getPrimaryService(candidate.writeService)
      : service
    write = await writeService.getCharacteristic(candidate.write)
  }

  const name = id => typeof id == 'number' ? `0x${id.toString(16)}` : id.slice(0, 8)
  candidate.description = `service ${name(candidate.service)}, notify ${name(candidate.notify)}`

  return { candidate, notify, write }
}

async function connect() {
  profile = selectedProfile()

  if (!navigator.bluetooth) {
    setState('Web Bluetooth unavailable - serve this page over https', 'form-control bg-warning')
    return
  }

  try {
    setState('Selecting device...')

    device = el('any-device').checked
      ? await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: allServices })
      : await navigator.bluetooth.requestDevice({ filters: profile.filters, optionalServices: allServices })

    el('ble-name').value = device.name || '(unnamed)'
    device.addEventListener('gattserverdisconnected', onDisconnected)

    setState('Connecting...')
    server = await device.gatt.connect()

    let opened = null
    let lastError = null
    for (const candidate of profile.transports) {
      try { opened = await openTransport(candidate); break }
      catch (error) { lastError = error }
    }

    if (!opened)
      throw lastError

    transport = opened.candidate
    notifyCharacteristic = opened.notify
    writeCharacteristic = opened.write

    await notifyCharacteristic.startNotifications()
    notifyCharacteristic.addEventListener('characteristicvaluechanged', onNotification)

    startedAt = Date.now()
    frames = 0
    bytes = 0

    for (const command of transport.init || []) {
      await write(writeCharacteristic, command)
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    if (transport.poll) {
      await poll()
      pollTimer = setInterval(poll, pollInterval)
    }

    setState('Connected', 'form-control bg-success text-white')
    flushTimer = setInterval(() => { flush(); updateCounters() }, flushInterval)
    updateCounters()
    updateButtons()
  }
  catch (error) {
    setState(`Failed: ${error.message}`, 'form-control bg-danger text-white')
    teardown()
  }
}

function teardown() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = 0 }
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = 0 }

  logging = false
  notifyCharacteristic = null
  writeCharacteristic = null
  server = null
  flush()
  updateButtons()
}

function onDisconnected() {
  if (logging)
    stopLogging('link lost')

  setState('Disconnected')
  teardown()
}

function disconnect() {
  if (device && device.gatt.connected)
    device.gatt.disconnect()
  else
    onDisconnected()
}

function startLogging() {
  const seconds = Math.max(1, Math.min(600, parseInt(el('duration').value) || 10))

  logging = true
  startedAt = Date.now()
  loggedFrames = 0
  loggedBytes = 0

  comment('euc-dash logger')
  comment(`brand    : ${profile.label}`)
  comment(`device   : ${device.name || '(unnamed)'}`)
  comment(`link     : ${transport.description}`)
  comment(`started  : ${new Date().toISOString()}`)
  comment(`duration : ${seconds} s`)

  stopTimer = setTimeout(() => stopLogging('duration reached'), seconds * 1000)
  setState(`Logging ${seconds}s...`, 'form-control bg-primary text-white')
  updateButtons()
}

function stopLogging(reason) {
  if (!logging)
    return

  const seconds = elapsed()
  logging = false
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = 0 }

  comment(`stopped  : ${reason} - ${seconds.toFixed(2)} s, ${loggedFrames} frames, ${loggedBytes} bytes`)
  comment('')
  flush()

  setState(notifyCharacteristic ? 'Connected' : 'Disconnected',
    notifyCharacteristic ? 'form-control bg-success text-white' : 'form-control')

  if (loggedFrames == 0)
    setInfo('no frames received - wrong brand selected, or the wheel needs waking up')
  else
    updateCounters()

  updateButtons()
}

function clearLog() {
  lines = []
  pending = []
  el('log').value = ''
  updateButtons()
}

function fileName() {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
  const time = `${pad(now.getHours(), 2)}-${pad(now.getMinutes(), 2)}-${pad(now.getSeconds(), 2)}`
  const name = (el('ble-name').value || 'wheel').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const prefix = profile ? profile.prefix : el('brand').value

  return `${prefix}_${name}_${date}_${time}.log`
}

function save() {
  flush()

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

window.addEventListener('load', () => {
  const brand = el('brand')

  for (const [key, value] of Object.entries(profiles)) {
    const option = document.createElement('option')
    option.value = key
    option.innerText = value.label
    brand.appendChild(option)
  }

  setState(navigator.bluetooth ? 'Disconnected' : 'Web Bluetooth unavailable - serve this page over https')
  updateButtons()
})
