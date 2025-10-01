let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

let bleAgent = createBleAgent();

let axisCallback = null
let buttonCallback = null

let desktopElements = document.getElementsByClassName("desktop-only");

let helpRow = document.getElementsByClassName("help-row");

let toggleMobile = document.getElementById('toggle-mobile-layout');
let toggleKeyboardWASD = document.getElementById('toggle-keyboard-style');
let toggleDebug = document.getElementById('toggle-debug-mode');

// Axis state, initialized to the neutral position (90 degrees)
let axisValues = [90, 90, 90, 90];

// State for the keyboard override toggle, defaults to off.
let isKeyboardOverrideEnabled = false;

// State for the debug mode toggle, defaults to off.
let isDebugModeEnabled = false;

// --------------------------- state management ------------------------------------ //


document.addEventListener('DOMContentLoaded', function () {
    const refreshButton = document.getElementById('refresh-button');
    const reloadPage = () => window.location.reload();

    refreshButton.addEventListener('click', reloadPage);
    refreshButton.addEventListener('touchend', reloadPage);

    updateToggle(toggleKeyboardWASD, isKeyboardOverrideEnabled, false);
    updateToggle(toggleDebug, isDebugModeEnabled, false);

    const keyboardToggleHandler = () => isKeyboardOverrideEnabled = updateToggle(toggleKeyboardWASD, isKeyboardOverrideEnabled, true);
    const debugToggleHandler = () => isDebugModeEnabled = updateToggle(toggleDebug, isDebugModeEnabled, true);

    toggleKeyboardWASD.addEventListener('mousedown', keyboardToggleHandler);
    toggleKeyboardWASD.addEventListener('touchstart', keyboardToggleHandler);
    toggleDebug.addEventListener('mousedown', debugToggleHandler);
    toggleDebug.addEventListener('touchstart', debugToggleHandler);

    window.setInterval(renderLoop, 100); // call renderLoop every num milliseconds

    setupAxisSliders();
    setupPuppetProtocolButtons();
    setupDrivetrainButtons();
});

function updateToggle(element, currentState, isToggling) {
    const newState = isToggling ? !currentState : currentState;
    if (newState) {
        element.style.backgroundColor = 'var(--alf-green)';
        element.firstElementChild.style.transform = 'translateX(2vw)';
    } else {
        element.style.backgroundColor = 'var(--button-default)';
        element.firstElementChild.style.transform = 'none';
    }
    return newState;
}

function setupAxisSliders() {
    for (let i = 0; i < 4; i++) {
        const sliderBar = document.getElementById(`bar${i}`);
        const axisValueDisplay = document.getElementById(`axisValue${i}`);

        const startDrag = (event) => {
            event.preventDefault();
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('mouseup', endDrag);
            document.addEventListener('touchend', endDrag);
        };

        const onDrag = (event) => {
            event.preventDefault();
            const rect = sliderBar.getBoundingClientRect();
            const clientX = event.touches ? event.touches[0].clientX : event.clientX;
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const percentage = x / rect.width;

            // Map percentage (0-1) to angle (0-180) for display and for the BLE packet
            const angle = Math.round(percentage * 180);
            axisValueDisplay.textContent = angle;
            axisValues[i] = angle;

            // Update the visual indicator
            const indicator = sliderBar.querySelector('.slider-indicator');
            if (indicator) {
                indicator.style.left = `${percentage * 100}%`;
            }
        };

        const endDrag = () => {
            // Send packet on drag end
            const packet = createPuppetPacket(FUNCTION_GROUPS.SERVO, 0x00, FUNCTION_TYPES.SET, [i, axisValues[i]]);
            bleAgent.attemptSend(packet);

            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('mouseup', endDrag);
            document.removeEventListener('touchend', endDrag);
        };

        sliderBar.addEventListener('mousedown', startDrag);
        sliderBar.addEventListener('touchstart', startDrag, { passive: false });

        // Create and add the visual indicator
        const indicator = document.createElement('div');
        indicator.className = 'slider-indicator';
        sliderBar.appendChild(indicator);
        
        // Set initial position (90 degrees is 50%)
        indicator.style.left = '50%';
    }
}

// ----------------------------------------- main --------------------------------------- //

function renderLoop() {
    // The render loop is no longer sending continuous packets.
    // All packets are now event-driven via the Puppet Protocol.
    // We can keep this for future features like keyboard overrides.

    if (!document.hasFocus()) {
        // If the window loses focus, send a drivetrain stop command for safety.
        bleAgent.attemptSend(createPuppetPacket(FUNCTION_GROUPS.DRIVETRAIN, 0x00, FUNCTION_TYPES.SET));
    }
}

// ----------------------------------------- Puppet Protocol (0x57) --------------------------------------- //

const FUNCTION_GROUPS = {
    ROBOT_BOARD: 0x03,
    MOTOR: 0x12,
    DRIVETRAIN: 0x05,
    SERVO: 0x13,
    SENSOR: 0x07,
};

const FUNCTION_TYPES = {
    SET: 0x00,
    REQUEST: 0x01,
    DATA: 0x02,
};

/**
 * Creates a Puppet Protocol (0x57) packet.
 * @param {number} group - The function group (e.g., FUNCTION_GROUPS.MOTOR).
 * @param {number} func - The function within the group.
 * @param {number} type - The function type (e.g., FUNCTION_TYPES.SET).
 * @param {Array<number|boolean>} data - An array of data to be serialized (bytes, floats, booleans).
 * @returns {Uint8Array} The constructed packet.
 */
function createPuppetPacket(group, func, type, data = []) {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);

    view.setUint8(0, 0x57); // Packet Type
    view.setUint8(1, group);
    view.setUint8(2, func);
    view.setUint8(3, type);

    let offset = 4;
    data.forEach(value => {
        if (typeof value === 'number' && Number.isInteger(value)) {
            // Assume it's a byte if it's an integer
            view.setUint8(offset, value);
            offset += 1;
        } else if (typeof value === 'number') {
            // Assume it's a float
            view.setFloat32(offset, value, true); // true for little-endian
            offset += 4;
        } else if (typeof value === 'boolean') {
            view.setUint8(offset, value ? 1 : 0);
            offset += 1;
        }
    });

    return new Uint8Array(buffer);
}

function setupPuppetProtocolButtons() {
    const topContainer = document.getElementById('desktop-axis-top');
    const motorButtons = topContainer.querySelectorAll('button:not(#desktop-axis-stop)');
    const motorInputs = topContainer.querySelectorAll('input[type="text"]');

    // Motor Set Effort Buttons
    motorButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            const effort = parseFloat(motorInputs[index].value) || 0.0;
            const packet = createPuppetPacket(FUNCTION_GROUPS.MOTOR, 0x01, FUNCTION_TYPES.SET, [index, effort]);
            bleAgent.attemptSend(packet);
        });
    });

    // Drivetrain Stop Button
    document.getElementById('desktop-axis-stop').addEventListener('click', () => {
        const packet = createPuppetPacket(FUNCTION_GROUPS.DRIVETRAIN, 0x00, FUNCTION_TYPES.SET);
        bleAgent.attemptSend(packet);
    });

    const bottomContainer = document.getElementById('desktop-axis-bottom');
    const sensorButtons = bottomContainer.querySelectorAll('button');

    // Sensor Request Buttons
    // [Read Sonar, Read Reflectance, Read Magnetometer, Read Accelerometer]
    const sensorFunctions = [0x00, 0x01, 0x02, 0x03];
    sensorButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            let data = [];
            // Reflectance requires a sensor number, let's default to 0 for this example
            if (sensorFunctions[index] === 0x01) {
                data.push(0); // Requesting data from reflectance sensor 0
            }
            const packet = createPuppetPacket(FUNCTION_GROUPS.SENSOR, sensorFunctions[index], FUNCTION_TYPES.REQUEST, data);
            bleAgent.attemptSend(packet);
        });
    });
}

function setupDrivetrainButtons() {
    const container = document.getElementById('desktop-button');
    const buttons = container.querySelectorAll('button');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const text = button.innerHTML;
            const value = parseFloat(text);

            if (isNaN(value)) return;

            let packet;
            const maxEffort = 0.8; // Default max effort
            const timeout = 5.0;   // Default timeout in seconds

            if (text.includes('cm')) {
                // Drivetrain Straight: [0x05][0x04]
                // Data: (target distance CM, FLOAT)(max effort, FLOAT)(timeout FLOAT)
                packet = createPuppetPacket(FUNCTION_GROUPS.DRIVETRAIN, 0x04, FUNCTION_TYPES.SET, [value, maxEffort, timeout]);
            } else if (text.includes('°')) {
                // Drivetrain Turn: [0x05][0x05]
                // Data: (target angle DEG, FLOAT)(max effort, FLOAT)(timeout FLOAT)
                packet = createPuppetPacket(FUNCTION_GROUPS.DRIVETRAIN, 0x05, FUNCTION_TYPES.SET, [value, maxEffort, timeout]);
            }

            if (packet) bleAgent.attemptSend(packet);
        });
    });
}
// -------------------------------------------- bluetooth --------------------------------------- //

function createBleAgent() {
    let buttonBLE = document.getElementById('ble-button')
    let statusBLE = document.getElementById('ble-status')
    let telemetryDisplay = document.getElementById('telemetry')
    let terminalLog = document.getElementById("terminal-log");
    let terminalClearButton = document.getElementById("terminal-clear-button");
    let terminalLockButton = document.getElementById("terminal-lock-button");


    const SERVICE_UUID_UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    // The peripheral's TX becomes our RX and vice-versa.
    const CHARACTERISTIC_UUID_UART_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notifications
    const CHARACTERISTIC_UUID_UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
    const CHARACTERISTIC_UUID_DATA_RX = '92ae6088-f24d-4360-b1b1-a432a8ed36fe'; // Notifications
    const CHARACTERISTIC_UUID_DATA_TX = '92ae6088-f24d-4360-b1b1-a432a8ed36ff'; // Write
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile){
        buttonBLE.ontouchend = updateBLE;
        terminalClearButton.ontouchend = clearTerminal;
        terminalLockButton.ontouchend = toggleTerminalLock;
    } else {
        buttonBLE.onclick = updateBLE;
        terminalClearButton.onclick = clearTerminal;
        terminalLockButton.onclick = toggleTerminalLock;
    }

    function displayBleStatus(status, color) {
        statusBLE.innerHTML = status;
        console.log(status)
        statusBLE.style.backgroundColor = color;
    }

    let device = null;
    let server;
    let service;
    let characteristic_data_tx;
    let characteristic_data_rx;
    let isConnectedBLE = false;
    let isConnecting = false;
    let bleUpdateInProgress = false;

    async function updateBLE() {
        if (bleUpdateInProgress) return
        bleUpdateInProgress = true;
        try {
            if (!isConnectedBLE) await connectBLE();
            else await disconnectBLE();
        } finally {
            bleUpdateInProgress = false;
        }
        
    }

    async function connectBLE() {
        if (isConnecting || isConnectedBLE) return;
        isConnecting = true;
        try {
            if (device == null){
                displayBleStatus('Scanning...', 'black');
                device = await navigator.bluetooth.requestDevice({ 
                    filters: [{ namePrefix: 'XRP' }],
                    optionalServices: [SERVICE_UUID_UART] // Grant access to the service
                });
                device.addEventListener('gattserverdisconnected', robotDisconnect);
            } else {
                displayBleStatus(`Reconnecting to <br> ${device.name}`, 'black');
            }

            const connectWithTimeout = (device, timeoutMs) => new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error("Connection timed out")), timeoutMs);
                device.gatt.connect()
                    .then(server => { clearTimeout(timeoutId); resolve(server); })
                    .catch(err => { clearTimeout(timeoutId); reject(err); });
            });

            server = await connectWithTimeout(device, 10000);
            service = await server.getPrimaryService(SERVICE_UUID_UART);
            
            // Get Data TX Characteristic for sending packets
            characteristic_data_tx = await service.getCharacteristic(CHARACTERISTIC_UUID_DATA_TX);

            // Get Data RX Characteristic and subscribe to notifications
            try {
                characteristic_data_rx = await service.getCharacteristic(CHARACTERISTIC_UUID_DATA_RX);
                await characteristic_data_rx.startNotifications();
                characteristic_data_rx.addEventListener('characteristicvaluechanged', handleTerminalCharacteristic);
            } catch (error) {
                console.log("Data RX characteristic not available.", error);
            }

            // Also try to subscribe to the standard UART RX for any other terminal output
            const characteristic_uart_rx = await service.getCharacteristic(CHARACTERISTIC_UUID_UART_RX);
            await characteristic_uart_rx.startNotifications();
            characteristic_uart_rx.addEventListener('characteristicvaluechanged', handleTerminalCharacteristic);

            isConnectedBLE = true;
            isConnecting = false;
            buttonBLE.innerHTML = '❌';
            displayBleStatus(`Connected to <br> ${device.name}`, '#4dae50'); //green

        } catch (error) {
            if (error.name === 'NotFoundError') {
                displayBleStatus('No Device Selected', '#eb5b5b');
            } else if (error.name === 'SecurityError') {
                displayBleStatus('Security error', '#eb5b5b');
            } else {
                console.log( error);
                displayBleStatus('Connection failed', '#eb5b5b');
                connectBLE();
            }
        } finally {
            isConnecting = false;
        }
    }

    let terminalLocked = false;

    function handleTerminalCharacteristic(event){

        if (terminalLocked) return;

        const view = event.target.value; // DataView of the characteristic's value

        if (isDebugModeEnabled) {
            const byteArray = new Uint8Array(view.buffer);
            const hexString = Array.from(byteArray).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
            appendToTerminal(`IN: [ ${hexString} ]`);
        }

        const packetType = view.getUint8(0);
        let outputString = '';

        if (packetType === 0x57) { // Puppet Protocol Data
            const group = view.getUint8(1);
            const func = view.getUint8(2);
            const type = view.getUint8(3);

            if (type === FUNCTION_TYPES.DATA) {
                outputString = `DATA: `;
                if (group === FUNCTION_GROUPS.SENSOR && func === 0x00) { // Sonar
                    const distance = view.getFloat32(4, true).toFixed(2);
                    outputString += `Sonar Distance: ${distance} cm`;
                } else if (group === FUNCTION_GROUPS.SENSOR && func === 0x01) { // Reflectance
                    const sensorNum = view.getUint8(4); const value = view.getFloat32(5, true).toFixed(2);
                    outputString += `Reflectance[${sensorNum}]: ${value}`; 
                } else if (group === FUNCTION_GROUPS.SENSOR && func === 0x02) { // Magnetometer
                    const yaw = view.getFloat32(4, true).toFixed(2); const roll = view.getFloat32(8, true).toFixed(2); const pitch = view.getFloat32(12, true).toFixed(2);
                    outputString += `Mag: Y=${yaw}, R=${roll}, P=${pitch}`; 
                } else if (group === FUNCTION_GROUPS.SENSOR && func === 0x03) { // Accelerometer
                    const x = view.getFloat32(4, true).toFixed(2); const y = view.getFloat32(8, true).toFixed(2); const z = view.getFloat32(12, true).toFixed(2);
                    outputString += `Accel: X=${x}, Y=${y}, Z=${z}`; 
                } else {
                    // Generic data packet display
                    outputString = `PUPPET(0x57): G=${group}, F=${func}, Data=[`;
                    for (let i = 4; i < view.byteLength; i++) { outputString += ` ${view.getUint8(i)}`; }
                    outputString += " ]";
                }
            }
        } else { // Legacy Terminal Data
            let controlCharacter = view.getUint8(0);
            let asciiString = '';
            for (let i = 1; i < view.byteLength; i++) { asciiString += String.fromCharCode(view.getUint8(i)); }
            if (controlCharacter === 1) {
                outputString = asciiString;
            } else if (controlCharacter === 2) {
                terminalLog.innerHTML = "";
                return;
            }
        }

        if (outputString) {
            appendToTerminal(outputString);
        }
    }

    function appendToTerminal(text) {
        const lines = terminalLog.innerHTML.split('<br>').filter(line => line.trim() !== '');
        lines.push(text);
        while (lines.length > 7) lines.shift();
        terminalLog.innerHTML = lines.join('<br>');
    }

    function clearTerminal() {
        terminalLog.innerHTML = "";
    }
    
    function toggleTerminalLock() {
        if(terminalLocked){
            terminalLocked = false;
            terminalLockButton.innerHTML = "🔓";
        } else{
            terminalLocked = true;
            terminalLockButton.innerHTML = "🔒";
        }
    }

    async function disconnectBLE() {
        displayBleStatus('Disconnecting', 'gray');
        try {
            if (device && device.gatt.connected) {
                await device.gatt.disconnect();
            }
            displayBleStatus('Not Connected', 'black');
            isConnectedBLE = false;
            buttonBLE.innerHTML = '🔗';

        } catch (error) {
            displayBleStatus("Error", '#eb5b5b');
            console.error('Error:', error);
        }
    }

    function robotDisconnect(event) {
        displayBleStatus('Not Connected', 'black');
        if (isConnectedBLE) {
            isConnectedBLE = false;
            // Optional: try to reconnect automatically
            // displayBleStatus('Reconnecting...', 'black');
            // setTimeout(connectBLE, 1000); 
        }
    }

    /**
     *  bleQueue - If we haven't come back from the ble.writeValue then the GATT is still busy and we will miss items that are being sent
     * This can be seen if you type very fast in the Shell 
     */
    let bleWriteQueue = Promise.resolve();

    async function sendPacketBLE(byteArray) {
        if (!isConnectedBLE || !characteristic_data_tx) {
            return;
        }

        if (isDebugModeEnabled) {
            // Create a hex string representation of the outgoing packet
            const hexString = Array.from(new Uint8Array(byteArray)).map(b => b.toString(16).padStart(2, '0')).join(' ').toUpperCase();
            appendToTerminal(`OUT: [ ${hexString} ]`);
        }

        bleWriteQueue = bleWriteQueue.then(async () => {
            try {
                // Using writeValueWithResponse is more reliable for NUS, but writeValueWithoutResponse is faster.
                // Your Python code uses NOTIFY, so the client should use writeValueWithoutResponse.
                await characteristic_data_tx.writeValueWithoutResponse(new Uint8Array(byteArray));
            } catch (error) {
                console.error('BLE write failed:', error);
            }
        });
    }

    return {
        attemptSend: sendPacketBLE
    };
}