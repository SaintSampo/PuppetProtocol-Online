# Upload this file to your XRP robot and run it directly, or import it:
#   from PuppetPassthrough import PuppetPassthrough
#   PuppetPassthrough.get_default_passthrough().run()

_DEBUG = False  # Set False to silence debug output

from XRPLib.encoded_motor import EncodedMotor
from XRPLib.servo import Servo
from XRPLib.differential_drive import DifferentialDrive
from XRPLib.rangefinder import Rangefinder
from XRPLib.imu import IMU
from XRPLib.reflectance import Reflectance
from XRPLib.board import Board
from XRPLib.puppet import (Puppet, VAR_TYPE_INT, VAR_TYPE_FLOAT, VAR_TYPE_BOOL,
                            PERM_READ_ONLY, PERM_WRITE_ONLY, PERM_READ_WRITE)
from machine import Timer, ADC, Pin
import sys
import time


class PuppetPassthrough:

    _DEFAULT_INSTANCE = None

    @classmethod
    def get_default_passthrough(cls):
        if cls._DEFAULT_INSTANCE is None:
            cls._DEFAULT_INSTANCE = cls()
        return cls._DEFAULT_INSTANCE

    def __init__(self):
        self._left_motor  = EncodedMotor.get_default_encoded_motor(index=1)
        self._right_motor = EncodedMotor.get_default_encoded_motor(index=2)
        self._motor_3     = EncodedMotor.get_default_encoded_motor(index=3)
        self._motor_4     = EncodedMotor.get_default_encoded_motor(index=4)
        self._drivetrain  = DifferentialDrive.get_default_differential_drive()
        self._imu         = IMU.get_default_imu()
        self._rangefinder = Rangefinder.get_default_rangefinder()
        self._reflectance = Reflectance.get_default_reflectance()
        self._board       = Board.get_default_board()

        # Detect board type: 0=XRP Beta (no NeoPixel), 1=XRP, 2=NanoXRP
        _m = sys.implementation._machine
        if 'NanoXRP' in _m:
            self._board_type = 2
        elif hasattr(Pin.board, 'BOARD_NEOPIXEL'):
            self._board_type = 1
        else:
            self._board_type = 0

        self._led_state = False
        self._motors = [self._left_motor, self._right_motor, self._motor_3, self._motor_4]

        # Some boards only expose servo ports 1-2; get_default_servo returns an Exception
        # object (not raise) for missing hardware, so filter those out.
        self._servos = []
        for idx in range(1, 5):
            s = Servo.get_default_servo(index=idx)
            self._servos.append(s if not isinstance(s, Exception) else None)

        self._resend_pending = False
        self._puppet = Puppet.get_default_puppet(transport_mode='BLE')
        self._register_variables()
        # Intercept _handle_program_start so the BLE IRQ only sets a flag.
        # gatts_notify() is re-entrant when called from the BLE IRQ, so the
        # actual VAR_DEF resend must happen from the main loop (see run()).
        def _on_program_start():
            if _DEBUG: print('DBG: PROGRAM_START received from browser')
            self._puppet._program_running = True
            self._resend_pending = True
        self._puppet._handle_program_start = _on_program_start
        # Hook the BLE data callback to log raw incoming bytes.
        if _DEBUG:
            _orig_cb = self._puppet._data_callback
            def _dbg_rx(data):
                print('DBG RX:', ' '.join('%02x' % b for b in bytes(data)))
                _orig_cb(data)
            self._puppet._transport.set_data_callback(_dbg_rx)
        self._telemetry_timer = Timer(-1)

    def _set_internal(self, name, value):
        vi = self._puppet._variables[name]
        self._puppet._variables[name] = (vi[0], vi[1], vi[2], value, vi[4], vi[5])

    def _register_variables(self):
        # --- Control variables (browser writes, robot reads) ---
        # IDs 38-41
        for i in range(4):
            self._puppet.define_variable('$puppet.motor.' + str(i), VAR_TYPE_FLOAT, PERM_WRITE_ONLY)
        # IDs 42-45
        for i in range(4):
            self._puppet.define_variable('$puppet.servo.' + str(i), VAR_TYPE_FLOAT, PERM_WRITE_ONLY)
            self._set_internal('$puppet.servo.' + str(i), 90.0)
        # ID 46
        self._puppet.define_variable('$puppet.drivetrain.stop',     VAR_TYPE_BOOL,  PERM_WRITE_ONLY)
        # ID 47
        self._puppet.define_variable('$puppet.drivetrain.distance', VAR_TYPE_FLOAT, PERM_READ_WRITE)
        # ID 48
        self._puppet.define_variable('$puppet.drivetrain.angle',    VAR_TYPE_FLOAT, PERM_READ_WRITE)
        # ID 49
        self._puppet.define_variable('$puppet.led',                 VAR_TYPE_BOOL,  PERM_WRITE_ONLY)

        # --- Read-only telemetry (robot writes, browser displays) ---
        # ID 50
        self._puppet.define_variable('$puppet.board_type', VAR_TYPE_INT,  PERM_READ_ONLY)
        # IDs 51-54
        for i in range(4):
            self._puppet.define_variable('$encoder.' + str(i), VAR_TYPE_INT, PERM_READ_ONLY)
        # ID 55
        self._puppet.define_variable('$puppet.button', VAR_TYPE_BOOL, PERM_READ_ONLY)

        # Standard telemetry vars (use predefined IDs 20-25, 34-37 — no VAR_DEF sent)
        for name in ['$imu.yaw', '$imu.roll', '$imu.pitch',
                     '$imu.acc_x', '$imu.acc_y', '$imu.acc_z']:
            self._puppet.define_variable(name, VAR_TYPE_FLOAT, PERM_READ_ONLY)
        for name in ['$rangefinder.distance', '$reflectance.left',
                     '$reflectance.right', '$voltage']:
            self._puppet.define_variable(name, VAR_TYPE_FLOAT, PERM_READ_ONLY)

    def _update_telemetry(self):
        try:
            self._puppet.set_variable('$imu.yaw',   self._imu.get_yaw())
            self._puppet.set_variable('$imu.roll',  self._imu.get_roll())
            self._puppet.set_variable('$imu.pitch', self._imu.get_pitch())
            self._puppet.set_variable('$imu.acc_x', self._imu.get_acc_x())
            self._puppet.set_variable('$imu.acc_y', self._imu.get_acc_y())
            self._puppet.set_variable('$imu.acc_z', self._imu.get_acc_z())
            self._puppet.set_variable('$encoder.0', self._left_motor.get_position_counts())
            self._puppet.set_variable('$encoder.1', self._right_motor.get_position_counts())
            self._puppet.set_variable('$encoder.2', self._motor_3.get_position_counts())
            self._puppet.set_variable('$encoder.3', self._motor_4.get_position_counts())
            self._puppet.set_variable('$rangefinder.distance', self._rangefinder.distance())
            self._puppet.set_variable('$reflectance.left',  self._reflectance.get_left())
            self._puppet.set_variable('$reflectance.right', self._reflectance.get_right())
            self._puppet.set_variable('$puppet.board_type', self._board_type)
            self._puppet.set_variable('$puppet.button', self._board.is_button_pressed())
            voltage = self._board.get_battery_voltage()
            self._puppet.set_variable('$voltage', voltage)
        except Exception:
            pass

    def _apply_controls(self):
        # Motor efforts (-1.0 to 1.0)
        for i, motor in enumerate(self._motors):
            val = self._puppet.get_variable('$puppet.motor.' + str(i))
            if _DEBUG and val != 0.0:
                print('DBG motor', i, '=', val)
            motor.set_effort(val)

        # Servo angles (0-180)
        for i, servo in enumerate(self._servos):
            if servo is not None:
                servo.set_angle(self._puppet.get_variable('$puppet.servo.' + str(i)))

        # LED (WRITE_ONLY: only act when state changes)
        led = self._puppet.get_variable('$puppet.led')
        if led != self._led_state:
            self._led_state = led
            self._board.led_on() if led else self._board.led_off()

        # Drivetrain stop
        if self._puppet.get_variable('$puppet.drivetrain.stop'):
            self._drivetrain.stop()
            self._set_internal('$puppet.drivetrain.stop', False)

        # Drivetrain straight
        dist = self._puppet.get_variable('$puppet.drivetrain.distance')
        if dist != 0.0:
            self._drivetrain.straight(dist, max_effort=0.8, timeout=5.0)
            self._puppet.set_variable('$puppet.drivetrain.distance', 0.0)

        # Drivetrain turn
        angle = self._puppet.get_variable('$puppet.drivetrain.angle')
        if angle != 0.0:
            self._drivetrain.turn(angle, max_effort=0.5, timeout=5.0)
            self._puppet.set_variable('$puppet.drivetrain.angle', 0.0)

    def _resend_var_defs(self):
        p = self._puppet
        for name, var_info in p._variables.items():
            if var_info[0] >= 38:  # 38 == FIRST_CUSTOM_VAR_ID
                p._send_var_def(name, var_info[1], var_info[2], var_info[0])
        p.send_program_start()

    def start(self, telemetry_hz=5):
        self._puppet.start()
        self._puppet.send_program_start()
        self._telemetry_timer.init(
            period=int(1000 / telemetry_hz),
            mode=Timer.PERIODIC,
            callback=lambda t: self._update_telemetry()
        )

    def stop(self):
        self._telemetry_timer.deinit()
        self._drivetrain.stop()
        for motor in self._motors:
            motor.set_effort(0.0)
        self._board.led_off()
        self._puppet.send_program_end()
        self._puppet.stop()

    def run(self, telemetry_hz=5):
        """Block forever, applying controls at ~50 Hz and streaming telemetry."""
        self.start(telemetry_hz)
        if _DEBUG: print('DBG: run() started, waiting for BLE connection')
        try:
            while True:
                if self._resend_pending:
                    self._resend_pending = False
                    if _DEBUG: print('DBG: resending VAR_DEFs + PROGRAM_START')
                    self._resend_var_defs()
                self._apply_controls()
                time.sleep_ms(20)
        finally:
            self.stop()


if __name__ == '__main__':
    PuppetPassthrough.get_default_passthrough().run()
