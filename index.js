let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

let bleAgent = createBleAgent();

let axisCallback = null
let buttonCallback = null

let desktopElements = document.getElementsByClassName("desktop-only");

let helpRow = document.getElementsByClassName("help-row");

let terminalElement = document.getElementById("terminal-container");
let hackSpacerElement = document.getElementById("hack-spacer");

let toggleMobile = document.getElementById('toggle-mobile-layout');
let toggleKeyboardWASD = document.getElementById('toggle-keyboard-style');
let toggleTerminal = document.getElementById('toggle-terminal');

// Axis state, initialized to the neutral position (90 degrees -> 127)
let axisValues = [127, 127, 127, 127];

// --------------------------- state management ------------------------------------ //


document.addEventListener('DOMContentLoaded', function () {
    const refreshButton = document.getElementById('refresh-button');
    const reloadPage = () => window.location.reload();

    refreshButton.addEventListener('click', reloadPage);
    refreshButton.addEventListener('touchend', reloadPage);

    updateSlider(toggleKeyboardWASD, toggleState=false);
    updateTerminalSlider(toggleTerminal, toggleState=false);

    toggleKeyboardWASD.onmousedown = updateSlider.bind(null, toggleKeyboardWASD, toggleState=true)
    toggleTerminal.onmousedown =     updateTerminalSlider.bind(null, toggleTerminal, toggleState=true)
    
    toggleKeyboardWASD.ontouchstart = updateSlider.bind(null, toggleKeyboardWASD, toggleState=true)
    toggleTerminal.ontouchstart =     updateTerminalSlider.bind(null, toggleTerminal, toggleState=true)
    
    window.setInterval(renderLoop, 100); // call renderLoop every num milliseconds

    setupAxisSliders();
});

function updateTerminalSlider(sliderElement, toggleState){
    updateSlider(sliderElement, toggleState);

    if (localStorage.getItem(toggleTerminal.id) === 'true') {
        terminalElement.style.display = "grid";
        hackSpacerElement.style.display = "none";
    } else {
        terminalElement.style.display = "none";
        hackSpacerElement.style.display = "grid";
    }
}

function updateSlider(sliderElement, toggleState){
    if(toggleState){
        if ( localStorage.getItem(sliderElement.id) === 'true') {
            localStorage.setItem(sliderElement.id, 'false');
        } else {
            localStorage.setItem(sliderElement.id, 'true');
        }        
    }

    if ( localStorage.getItem(sliderElement.id) === 'true') {
        sliderElement.style.backgroundColor = 'var(--alf-green)';
        sliderElement.firstElementChild.style.transform = 'translateX(2vw)';
        sliderElement.firstElementChild.style.webkitTransform  = 'translateX(2vw)';
        sliderElement.firstElementChild.style.msTransform = 'translateX(2vw)';

    } else {
        sliderElement.style.backgroundColor = 'rgb(189, 188, 188)';
        sliderElement.firstElementChild.style.transform = 'none';
        sliderElement.firstElementChild.style.webkitTransform  = 'none';
        sliderElement.firstElementChild.style.msTransform = 'none';
    }
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

            // Map percentage (0-1) to angle (0-180) for display
            const angle = Math.round(percentage * 180);
            axisValueDisplay.textContent = angle;

            // Map percentage (0-1) to data value (0-255) for BLE packet
            axisValues[i] = Math.round(percentage * 255);

            // Update the visual indicator
            const indicator = sliderBar.querySelector('.slider-indicator');
            if (indicator) {
                indicator.style.left = `${percentage * 100}%`;
            }
        };

        const endDrag = () => {
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
    //bytes 0: packet version
    //bytes 1-4: axes
    //bytes 5-6: button states
    //bytes 7-17: pressed keyboard keys
    let rawPacket = new Uint8Array(1 + 4 + 2 + 11)

    rawPacket[0] = 0x01; //packet version

    // Populate axis data from our state
    rawPacket[1] = clampUint8(axisValues[0]);
    rawPacket[2] = clampUint8(axisValues[1]);
    rawPacket[3] = clampUint8(axisValues[2]);
    rawPacket[4] = clampUint8(axisValues[3]);

    function clampUint8(value) { return Math.max(0, Math.min(value, 255)) }

    if (!document.hasFocus()) { 
        rawPacket.fill(0, 0, 20);
        rawPacket[0] = 1;
        rawPacket[1] = 127;
        rawPacket[2] = 127;
        rawPacket[3] = 127;
        rawPacket[4] = 127;
    }

    //console.log(rawPacket)
    bleAgent.attemptSend(rawPacket);
}

// -------------------------------------------- bluetooth --------------------------------------- //

function createBleAgent() {
    let buttonBLE = document.getElementById('ble-button')
    let statusBLE = document.getElementById('ble-status')
    let telemetryDisplay = document.getElementById('telemetry')
    let terminalLog = document.getElementById("terminal-log");
    let terminalClearButton = document.getElementById("terminal-clear-button");
    let terminalLockButton = document.getElementById("terminal-lock-button");


    const SERVICE_UUID_UART = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
    const CHARACTERISTIC_UUID_UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
    const CHARACTERISTIC_UUID_UART_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    const CHARACTERISTIC_UUID_DATA_TX = '92ae6088-f24d-4360-b1b1-a432a8ed36ff';
    const CHARACTERISTIC_UUID_DATA_RX = '92ae6088-f24d-4360-b1b1-a432a8ed36fe';

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
    let characteristic_uart_tx;
    let characteristic_uart_rx;

    let isConnectedBLE = false;
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

        try {
            if (device == null){
                displayBleStatus('Connecting', 'black');
                device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID_UART] }] });
            } else {
                displayBleStatus(`Reconnecting to <br> ${device.name}`, 'black');
            }

            server = await device.gatt.connect();
            service = await server.getPrimaryService(SERVICE_UUID_UART);
            

            characteristic_uart_tx = await service.getCharacteristic(CHARACTERISTIC_UUID_DATA_TX);

            // Try to get and subscribe to telemetry
            try {
                characteristic_uart_rx = await service.getCharacteristic(CHARACTERISTIC_UUID_DATA_RX);
                await characteristic_uart_rx.startNotifications();
                characteristic_uart_rx.addEventListener('characteristicvaluechanged', handleTerminalCharacteristic);
            } catch {
                console.log("Terminal characteristic not available.");
            }

            await device.addEventListener('gattserverdisconnected', robotDisconnect);

            isConnectedBLE = true;
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
        }
    }

    let terminalLocked = false;

    function handleTerminalCharacteristic(event){

        if(terminalLocked) return;

        const value = event.target.value; // DataView of the characteristic's value

        let controlCharacter = value.getUint8(0);
        let asciiString = '';

        for (let i = 0; i < Math.min(64, value.byteLength-1); i++) {
            asciiString += String.fromCharCode(value.getUint8(i+1));
        }

        if (controlCharacter == 1) {
            // Get current lines
            const lines = terminalLog.innerHTML.split('<br>').filter(line => line !== '');

            // Add new line
            lines.push(asciiString);

            // Keep only the last 7 lines
            while (lines.length > 7) {
                lines.shift(); // Remove the oldest line
            }

            // Re-render terminal
            terminalLog.innerHTML = lines.join('<br>');
        }

        if(controlCharacter == 2){
            terminalLog.innerHTML = "";
        }

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
            await device.removeEventListener('gattserverdisconnected', robotDisconnect);
            await device.gatt.disconnect();

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
        isConnectedBLE = false;
        connectBLE();
    }

    async function sendPacketBLE(byteArray) {
        if (!isConnectedBLE) return;

        try {
            await characteristic_uart_tx.writeValueWithoutResponse(new Uint8Array(byteArray));
        } catch (error) {
            console.error('Error:', error);
        }
    }

    return {
        attemptSend: sendPacketBLE
    };
}