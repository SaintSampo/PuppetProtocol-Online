# [PuppetPassthrough](https://saintsampo.github.io/PuppetPassthrough/)

A browser-based controller for the [XRP robot](https://experiencerobotics.org/) over Bluetooth Low Energy. No app install required — open the page, connect, and drive.

---

## What it does

PuppetPassthrough gives you real-time control of an XRP robot from any Chrome-based browser (desktop or mobile) via BLE:

- **Motor sliders** — set effort for all 4 motors (-1.0 to 1.0), snap to zero near center
- **Servo sliders** — set angle for all 4 servo channels (0°–180°)
- **Drivetrain commands** — straight drive and turn by precise amounts
- **STOP button** — immediately stops drivetrain and resets all motors to 0
- **LED toggle** — control the onboard LED
- **Live telemetry** — sonar, reflectance, IMU (yaw/roll/pitch/accel), encoders (×4), button state, voltage, board type

---

## Setup

### 1. Upload the Python file to your XRP robot

Copy `PuppetPassthrough.py` onto the XRP's filesystem (via [XRP Web](https://xrpcode.wpi.edu/) or any MicroPython file manager).

Run it:

```python
# Option A — run directly from the REPL
import PuppetPassthrough
PuppetPassthrough.PuppetPassthrough.get_default_passthrough().run()

# Option B — execute as a main script
# The file already has an if __name__ == '__main__' block,
# so just run PuppetPassthrough.py directly from the IDE.
```

The robot will start advertising over BLE immediately. The onboard LED blinks to indicate it is waiting for a connection.

> Set `_DEBUG = False` at the top of the file to silence serial print output once everything is working.

### 2. Open the web app

Go to **[saintsampo.github.io/PuppetPassthrough](https://saintsampo.github.io/PuppetPassthrough/)** in Chrome (desktop or Android). Safari and Firefox do not support Web Bluetooth.

### 3. Connect

Click the **🔗 button** and select your XRP from the device picker (it will appear as `XRP-XXXXXX`). The status bar turns green and shows the device name when connected.

---

## How it works

PuppetPassthrough uses the **XPP (XRP Puppet Protocol)** — a lightweight framed binary protocol built into XRPLib — to exchange data bidirectionally over a BLE UART service.

### Protocol framing

Every packet is wrapped:
```
[0xAA 0x55] [Type] [Length] [Payload...] [0x55 0xAA]
```

Message types used:
| Type | Value | Direction |
|------|-------|-----------|
| `VAR_UPDATE` | `0x02` | Both directions |
| `PROGRAM_START` | `0x05` | Browser → Robot (on connect) |
| `PROGRAM_END` | `0x06` | Robot → Browser (on stop) |

### Variable IDs

Each control and telemetry channel is identified by a numeric ID. Standard XRPLib variables (IMU, sonar, reflectance, voltage) use predefined IDs 20–37. PuppetPassthrough registers custom variables starting at ID 38:

| ID | Name | Direction |
|----|------|-----------|
| 38–41 | `$puppet.motor.0`–`.3` | Browser → Robot |
| 42–45 | `$puppet.servo.0`–`.3` | Browser → Robot |
| 46 | `$puppet.drivetrain.stop` | Browser → Robot |
| 47 | `$puppet.drivetrain.distance` | Browser → Robot |
| 48 | `$puppet.drivetrain.angle` | Browser → Robot |
| 49 | `$puppet.led` | Browser → Robot |
| 50 | `$puppet.board_type` | Robot → Browser |
| 51–54 | `$encoder.0`–`.3` | Robot → Browser |
| 55 | `$puppet.button` | Robot → Browser |

### Connection handshake

1. Browser connects and enables BLE notifications.
2. Browser sends `PROGRAM_START` — this signals the robot that a controller is live.
3. Robot receives `PROGRAM_START`, sets a flag, and on the next main-loop tick resends all custom `VAR_DEF` packets followed by its own `PROGRAM_START`.
4. Browser receives `PROGRAM_START` from the robot and sends safe initial values (all motors/servos at default).
5. Telemetry streams from the robot at 5 Hz via `VAR_UPDATE` packets.

The handshake is designed around a BLE MTU constraint: `VAR_DEF` packets for names like `$puppet.motor.0` exceed the default 20-byte ATT payload and would be silently dropped. The browser pre-seeds all variable IDs directly in its registry, so it never depends on receiving `VAR_DEF` from the robot.

### Robot main loop

`PuppetPassthrough.run()` loops at ~50 Hz:
- Reads current variable values and applies them to motors, servos, LED, and drivetrain.
- Telemetry updates (IMU, encoders, sonar, etc.) are written from a hardware timer at 5 Hz and sent to the browser automatically by XRPLib.
