// ============================================================
// XPP Protocol — must match puppet.py on the robot
// ============================================================

const DEBUG = true;  // Set false to silence console debug output
function dbg(...args) { if (DEBUG) console.log('[XPP]', ...args); }
function hex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' '); }

const XPP_START_1 = 0xAA;
const XPP_START_2 = 0x55;
const XPP_END_1   = 0x55;
const XPP_END_2   = 0xAA;

const MSG_TYPE_VAR_DEF       = 0x01;
const MSG_TYPE_VAR_UPDATE    = 0x02;
const MSG_TYPE_PROGRAM_START = 0x05;
const MSG_TYPE_PROGRAM_END   = 0x06;

const VAR_TYPE_INT   = 1;
const VAR_TYPE_FLOAT = 2;
const VAR_TYPE_BOOL  = 3;

const PERM_READ_ONLY  = 1;
const PERM_WRITE_ONLY = 2;
const PERM_READ_WRITE = 3;

// Standard variable IDs defined in puppet.py (_STANDARD_VAR_IDS).
// The robot never sends VAR_DEF for these, so we seed the registry directly.
const STANDARD_VARS = {
    20: { name: '$imu.yaw',              type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    21: { name: '$imu.roll',             type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    22: { name: '$imu.pitch',            type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    23: { name: '$imu.acc_x',            type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    24: { name: '$imu.acc_y',            type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    25: { name: '$imu.acc_z',            type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    34: { name: '$rangefinder.distance', type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    35: { name: '$reflectance.left',     type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    36: { name: '$reflectance.right',    type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
    37: { name: '$voltage',              type: VAR_TYPE_FLOAT, permissions: PERM_READ_ONLY },
};

// Custom variable IDs assigned by PuppetPassthrough.py (sequentially from FIRST_CUSTOM_VAR_ID=38).
// VAR_DEF packets for these names exceed the default BLE ATT MTU (20 bytes) and are silently
// truncated, so we pre-seed them here instead of relying on the VAR_DEF handshake.
const PUPPET_PASSTHROUGH_VARS = {
    38: { name: '$puppet.motor.0',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    39: { name: '$puppet.motor.1',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    40: { name: '$puppet.motor.2',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    41: { name: '$puppet.motor.3',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    42: { name: '$puppet.servo.0',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    43: { name: '$puppet.servo.1',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    44: { name: '$puppet.servo.2',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    45: { name: '$puppet.servo.3',             type: VAR_TYPE_FLOAT, permissions: PERM_WRITE_ONLY },
    46: { name: '$puppet.drivetrain.stop',     type: VAR_TYPE_BOOL,  permissions: PERM_WRITE_ONLY },
    47: { name: '$puppet.drivetrain.distance', type: VAR_TYPE_FLOAT, permissions: PERM_READ_WRITE },
    48: { name: '$puppet.drivetrain.angle',    type: VAR_TYPE_FLOAT, permissions: PERM_READ_WRITE },
    49: { name: '$puppet.led',                 type: VAR_TYPE_BOOL,  permissions: PERM_WRITE_ONLY },
    50: { name: '$puppet.board_type',          type: VAR_TYPE_INT,   permissions: PERM_READ_ONLY  },
    51: { name: '$encoder.0',                  type: VAR_TYPE_INT,   permissions: PERM_READ_ONLY  },
    52: { name: '$encoder.1',                  type: VAR_TYPE_INT,   permissions: PERM_READ_ONLY  },
    53: { name: '$encoder.2',                  type: VAR_TYPE_INT,   permissions: PERM_READ_ONLY  },
    54: { name: '$encoder.3',                  type: VAR_TYPE_INT,   permissions: PERM_READ_ONLY  },
    55: { name: '$puppet.button',              type: VAR_TYPE_BOOL,  permissions: PERM_READ_ONLY  },
};

// Variable registry: pre-seeded with all known variable IDs.
const varRegistry = (() => {
    const nameToInfo = {};
    const idToName   = {};
    for (const table of [STANDARD_VARS, PUPPET_PASSTHROUGH_VARS]) {
        for (const [id, info] of Object.entries(table)) {
            const numId = parseInt(id);
            nameToInfo[info.name] = { id: numId, type: info.type, permissions: info.permissions };
            idToName[numId] = info.name;
        }
    }
    return { nameToInfo, idToName };
})();

// ============================================================
// XPP Packet Builders
// ============================================================

function xppMessage(msgType, payload) {
    const buf = new Uint8Array(4 + payload.length + 2);
    buf[0] = XPP_START_1;
    buf[1] = XPP_START_2;
    buf[2] = msgType;
    buf[3] = payload.length;
    buf.set(payload, 4);
    buf[4 + payload.length] = XPP_END_1;
    buf[5 + payload.length] = XPP_END_2;
    return buf;
}

function xppVarUpdate(varId, varType, value) {
    const valBuf  = new ArrayBuffer(varType === VAR_TYPE_BOOL ? 1 : 4);
    const valView = new DataView(valBuf);
    if (varType === VAR_TYPE_FLOAT)     valView.setFloat32(0, value, true);
    else if (varType === VAR_TYPE_INT)  valView.setInt32(0, Math.round(value), true);
    else                                new Uint8Array(valBuf)[0] = value ? 1 : 0;

    const valBytes = new Uint8Array(valBuf);
    const payload  = new Uint8Array(3 + valBytes.length);
    payload[0] = 1;        // count = 1
    payload[1] = varId;
    payload[2] = varType;
    payload.set(valBytes, 3);
    return xppMessage(MSG_TYPE_VAR_UPDATE, payload);
}

function xppProgramStart() {
    return xppMessage(MSG_TYPE_PROGRAM_START, new Uint8Array(0));
}

// Send a named variable to the robot. No-op if the name is not yet in the registry.
function sendVar(name, value) {
    const info = varRegistry.nameToInfo[name];
    if (!info) {
        dbg('sendVar MISS (not in registry):', name);
        return false;
    }
    dbg('sendVar', name, '→ id=' + info.id, 'value=' + value);
    bleAgent.attemptSend(xppVarUpdate(info.id, info.type, value));
    return true;
}

// Send safe default values for all PuppetPassthrough control variables.
function sendInitialValues() {
    dbg('sendInitialValues called');
    for (let i = 0; i < 4; i++) sendVar('$puppet.motor.' + i, 0.0);
    for (let i = 0; i < 4; i++) sendVar('$puppet.servo.' + i, 90.0);
    sendVar('$puppet.drivetrain.stop',     false);
    sendVar('$puppet.drivetrain.distance', 0.0);
    sendVar('$puppet.drivetrain.angle',    0.0);
    sendVar('$puppet.led',                 false);
}

// ============================================================
// XPP Packet Parser
// ============================================================

function parseXppPackets(dataView) {
    const bytes   = new Uint8Array(dataView.buffer);
    const packets = [];
    let i = 0;
    while (i < bytes.length - 5) {
        if (bytes[i] !== XPP_START_1 || bytes[i + 1] !== XPP_START_2) { i++; continue; }
        const msgType    = bytes[i + 2];
        const payloadLen = bytes[i + 3];
        const total      = 4 + payloadLen + 2;
        if (i + total > bytes.length) break;
        if (bytes[i + 4 + payloadLen] !== XPP_END_1 || bytes[i + 5 + payloadLen] !== XPP_END_2) { i++; continue; }
        packets.push({ type: msgType, payload: bytes.slice(i + 4, i + 4 + payloadLen) });
        i += total;
    }
    return packets;
}

function handleVarDef(payload) {
    if (payload.length < 4) return;
    const nameLen = payload[0];
    if (payload.length < 1 + nameLen + 3) return;
    const name        = new TextDecoder().decode(payload.slice(1, 1 + nameLen));
    const varType     = payload[1 + nameLen];
    const permissions = payload[2 + nameLen];
    const varId       = payload[3 + nameLen];
    dbg('VAR_DEF received: id=' + varId, name, 'type=' + varType, 'perm=' + permissions);
    varRegistry.nameToInfo[name] = { id: varId, type: varType, permissions };
    varRegistry.idToName[varId]  = name;
}

function handleVarUpdate(payload) {
    if (payload.length < 1) return;
    const count = payload[0];
    let offset = 1;
    for (let i = 0; i < count; i++) {
        if (payload.length < offset + 2) break;
        const varId   = payload[offset];
        const varType = payload[offset + 1];
        offset += 2;
        let value;
        const view = new DataView(payload.buffer, payload.byteOffset + offset);
        if (varType === VAR_TYPE_FLOAT) {
            if (payload.length < offset + 4) break;
            value = view.getFloat32(0, true); offset += 4;
        } else if (varType === VAR_TYPE_INT) {
            if (payload.length < offset + 4) break;
            value = view.getInt32(0, true); offset += 4;
        } else if (varType === VAR_TYPE_BOOL) {
            if (payload.length < offset + 1) break;
            value = payload[offset] !== 0; offset += 1;
        } else { break; }
        const name = varRegistry.idToName[varId];
        if (name) updateTelemetry(name, value);
    }
}

// ============================================================
// Telemetry Display
// ============================================================

const TELEMETRY_DISPLAY = {
    '$imu.yaw':              'telemetry-imu-yaw',
    '$imu.roll':             'telemetry-imu-roll',
    '$imu.pitch':            'telemetry-imu-pitch',
    '$imu.acc_x':            'telemetry-acc-x',
    '$imu.acc_y':            'telemetry-acc-y',
    '$imu.acc_z':            'telemetry-acc-z',
    '$encoder.0':            'telemetry-enc-0',
    '$encoder.1':            'telemetry-enc-1',
    '$encoder.2':            'telemetry-enc-2',
    '$encoder.3':            'telemetry-enc-3',
    '$rangefinder.distance': 'telemetry-sonar',
    '$reflectance.left':     'telemetry-refl-left',
    '$reflectance.right':    'telemetry-refl-right',
    '$voltage':              'telemetry-voltage',
};

const BOARD_TYPE_NAMES = ['XRP Beta', 'XRP', 'NanoXRP'];

function updateTelemetry(name, value) {
    if (name === '$puppet.board_type') {
        const el = document.getElementById('telemetry-board-type');
        if (el) el.textContent = BOARD_TYPE_NAMES[value] ?? 'Unknown';
        return;
    }
    if (name === '$puppet.button') {
        const el = document.getElementById('telemetry-button');
        if (el) {
            el.textContent = value ? 'PRESSED' : 'open';
            el.style.color = value ? '#ff6b6b' : 'white';
        }
        return;
    }
    const elId = TELEMETRY_DISPLAY[name];
    if (elId) {
        const el = document.getElementById(elId);
        if (el) el.textContent = Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    if (name === '$voltage') {
        const badge = document.getElementById('telemetry');
        if (badge) badge.textContent = value.toFixed(1) + ' V';
    }
}

// ============================================================
// BLE Agent
// ============================================================

let bleAgent = createBleAgent();

document.addEventListener('DOMContentLoaded', function () {
    // Safety stop when the browser tab loses focus
    window.addEventListener('blur', () => {
        if (bleAgent.isConnected()) sendVar('$puppet.drivetrain.stop', true);
    });

    setupAxisSliders();
    setupMotorSliders();
    setupMotorButtons();
    setupDrivetrainButtons();
    setupLedButton();
});

// ============================================================
// Control Handlers
// ============================================================

function setupAxisSliders() {
    const axisValues = [90, 90, 90, 90];

    for (let i = 0; i < 4; i++) {
        const sliderBar        = document.getElementById('bar' + i);
        const axisValueDisplay = document.getElementById('axisValue' + i);

        const indicator = document.createElement('div');
        indicator.className  = 'slider-indicator';
        indicator.style.left = '50%';
        sliderBar.appendChild(indicator);

        const startDrag = (event) => {
            event.preventDefault();
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('mouseup',   endDrag);
            document.addEventListener('touchend',  endDrag);
        };

        const onDrag = (event) => {
            event.preventDefault();
            const rect       = sliderBar.getBoundingClientRect();
            const clientX    = event.touches ? event.touches[0].clientX : event.clientX;
            const x          = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const percentage = x / rect.width;
            const angle      = Math.round(percentage * 180);
            axisValueDisplay.textContent = angle;
            axisValues[i]                = angle;
            indicator.style.left         = `${percentage * 100}%`;
        };

        const endDrag = () => {
            sendVar('$puppet.servo.' + i, axisValues[i]);
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('mouseup',   endDrag);
            document.removeEventListener('touchend',  endDrag);
        };

        sliderBar.addEventListener('mousedown',  startDrag);
        sliderBar.addEventListener('touchstart', startDrag, { passive: false });
    }
}

function setupMotorSliders() {
    for (let i = 0; i < 4; i++) {
        const sliderBar    = document.getElementById('mbar' + i);
        const valueDisplay = document.getElementById('motorValue' + i);

        const indicator      = document.createElement('div');
        indicator.className  = 'slider-indicator';
        indicator.style.left = '50%';
        sliderBar.appendChild(indicator);

        const startDrag = (event) => {
            event.preventDefault();
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('mouseup',   endDrag);
            document.addEventListener('touchend',  endDrag);
        };

        const SNAP_THRESHOLD = 0.1;
        const onDrag = (event) => {
            event.preventDefault();
            const rect    = sliderBar.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const x       = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const pct     = x / rect.width;
            const raw     = (pct * 2 - 1);
            const effort  = Math.abs(raw) < SNAP_THRESHOLD ? 0 : Math.round(raw * 100) / 100;
            const dispPct = effort === 0 ? 50 : pct * 100;
            valueDisplay.textContent = effort.toFixed(2);
            indicator.style.left     = `${dispPct}%`;
            sendVar('$puppet.motor.' + i, effort);
        };

        const endDrag = () => {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('mouseup',   endDrag);
            document.removeEventListener('touchend',  endDrag);
        };

        sliderBar.addEventListener('mousedown',  startDrag);
        sliderBar.addEventListener('touchstart', startDrag, { passive: false });
    }
}

function setupMotorButtons() {
    document.getElementById('desktop-axis-stop').addEventListener('click', () => {
        sendVar('$puppet.drivetrain.stop', true);
        for (let i = 0; i < 4; i++) {
            sendVar('$puppet.motor.' + i, 0.0);
            document.getElementById('motorValue' + i).textContent = '0.00';
            const bar = document.getElementById('mbar' + i);
            const indicator = bar.querySelector('.slider-indicator');
            if (indicator) indicator.style.left = '50%';
        }
    });
}

function setupLedButton() {
    let ledOn = false;
    const btn = document.getElementById('led-button');
    if (!btn) return;
    btn.addEventListener('click', () => {
        ledOn = !ledOn;
        sendVar('$puppet.led', ledOn);
        btn.textContent = ledOn ? 'LED ON' : 'LED OFF';
        btn.style.backgroundColor = ledOn ? '#f39c12' : '';
    });
}

function setupDrivetrainButtons() {
    document.getElementById('desktop-button').querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
            const text  = button.innerHTML;
            const value = parseFloat(text);
            if (isNaN(value)) return;
            if (text.includes('cm')) {
                sendVar('$puppet.drivetrain.distance', value);
            } else if (text.includes('°')) {
                sendVar('$puppet.drivetrain.angle', value);
            }
        });
    });
}

// ============================================================
// BLE Agent Implementation
// ============================================================

function createBleAgent() {
    const buttonBLE = document.getElementById('ble-button');
    const statusBLE = document.getElementById('ble-status');

    const SERVICE_UUID_UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const CHAR_DATA_RX = '92ae6088-f24d-4360-b1b1-a432a8ed36fe'; // notify  (robot → browser)
    const CHAR_DATA_TX = '92ae6088-f24d-4360-b1b1-a432a8ed36ff'; // write   (browser → robot)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
        buttonBLE.ontouchend = updateBLE;
    } else {
        buttonBLE.onclick = updateBLE;
    }

    let device = null;
    let characteristic_data_tx;
    let characteristic_data_rx;
    let isConnectedBLE     = false;
    let isConnecting       = false;
    let bleUpdateInProgress = false;
    let bleWriteQueue      = Promise.resolve();

    function displayBleStatus(status, color) {
        statusBLE.innerHTML             = status;
        statusBLE.style.backgroundColor = color;
    }

    async function updateBLE() {
        if (bleUpdateInProgress) return;
        bleUpdateInProgress = true;
        try {
            if (!isConnectedBLE) await connectBLE();
            else                  await disconnectBLE();
        } finally {
            bleUpdateInProgress = false;
        }
    }

    async function connectBLE() {
        if (isConnecting || isConnectedBLE) return;
        isConnecting = true;
        try {
            if (device == null) {
                displayBleStatus('Scanning...', 'black');
                device = await navigator.bluetooth.requestDevice({
                    filters: [{ namePrefix: 'XRP' }],
                    optionalServices: [SERVICE_UUID_UART]
                });
                device.addEventListener('gattserverdisconnected', robotDisconnect);
            } else {
                displayBleStatus(`Reconnecting to <br>${device.name}`, 'black');
            }

            const server  = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID_UART);
            characteristic_data_tx = await service.getCharacteristic(CHAR_DATA_TX);

            try {
                characteristic_data_rx = await service.getCharacteristic(CHAR_DATA_RX);
                await characteristic_data_rx.startNotifications();
                characteristic_data_rx.addEventListener('characteristicvaluechanged', handleIncomingData);
            } catch (e) {
                console.log('Data RX characteristic not available:', e);
            }

            isConnectedBLE = true;
            isConnecting   = false;
            buttonBLE.innerHTML = '❌';
            displayBleStatus(`Connected to <br>${device.name}`, '#4dae50');

            // Tell the robot a browser is connected; robot will send back PROGRAM_START
            await sendPacketBLE(xppProgramStart());
            // Registry is pre-seeded, so send initial values immediately
            sendInitialValues();

        } catch (error) {
            if      (error.name === 'NotFoundError') displayBleStatus('No Device Selected', '#eb5b5b');
            else if (error.name === 'SecurityError') displayBleStatus('Security error', '#eb5b5b');
            else { console.log(error); displayBleStatus('Connection failed', '#eb5b5b'); }
        } finally {
            isConnecting = false;
        }
    }

    function handleIncomingData(event) {
        const view  = event.target.value;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        dbg('BLE notify', bytes.length + 'B:', hex(bytes));
        for (const pkt of parseXppPackets(view)) {
            if      (pkt.type === MSG_TYPE_VAR_DEF)       handleVarDef(pkt.payload);
            else if (pkt.type === MSG_TYPE_VAR_UPDATE)    handleVarUpdate(pkt.payload);
            else if (pkt.type === MSG_TYPE_PROGRAM_START) { dbg('PROGRAM_START from robot → sendInitialValues'); sendInitialValues(); }
        }
    }

    async function disconnectBLE() {
        displayBleStatus('Disconnecting', 'gray');
        try {
            if (characteristic_data_rx) {
                try {
                    await characteristic_data_rx.stopNotifications();
                    characteristic_data_rx.removeEventListener('characteristicvaluechanged', handleIncomingData);
                } catch (e) { console.log(e); }
            }
            if (device && device.gatt.connected) await device.gatt.disconnect();
            displayBleStatus('Not Connected', 'black');
            isConnectedBLE      = false;
            buttonBLE.innerHTML = '🔗';
        } catch (error) {
            displayBleStatus('Error', '#eb5b5b');
            console.error(error);
        }
    }

    function robotDisconnect() {
        displayBleStatus('Not Connected', 'black');
        isConnectedBLE = false;
    }

    async function sendPacketBLE(byteArray) {
        if (!isConnectedBLE || !characteristic_data_tx) return;
        const arr = new Uint8Array(byteArray);
        dbg('BLE write', arr.length + 'B:', hex(arr));
        bleWriteQueue = bleWriteQueue.then(async () => {
            try {
                await characteristic_data_tx.writeValueWithResponse(arr);
            } catch (e) { console.error('BLE write failed:', e); }
        });
    }

    return {
        attemptSend: sendPacketBLE,
        isConnected: () => isConnectedBLE,
    };
}
