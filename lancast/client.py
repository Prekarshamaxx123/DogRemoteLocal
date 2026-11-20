"""
LanCast TCP Client for Screen Viewing & Remote Control
Connects to host, decodes JPEG frames, handles audio playback,
synchronizes clipboard, and forwards mouse/keyboard input events.
"""

import socket
import threading
import json
import time
import struct
from .protocol import (
    TYPE_CONNECT_REQ, TYPE_CONNECT_RES, TYPE_FRAME,
    TYPE_INPUT_MOUSE_MOVE, TYPE_INPUT_MOUSE_CLICK, TYPE_INPUT_KEY,
    TYPE_INPUT_SCROLL, TYPE_CLIPBOARD, TYPE_AUDIO,
    TYPE_PING, TYPE_PONG, TYPE_DISCONNECT, TYPE_SET_SCREEN,
    pack_message, pack_json, pack_mouse_move, pack_scroll,
    pack_clipboard, unpack_frame, unpack_clipboard, recv_message
)
from .audio import AudioPlayer

class LanCastClient:
    def __init__(self, my_name: str = "Client"):
        self.my_name = my_name
        self.sock = None
        self.connected = False
        self.permissions = {"screen": True, "control": True, "audio": True}
        self.screens = []
        self.active_screen = 0
        self.current_rtt_ms = 1.0
        
        self.on_frame = None          # fn(jpeg_bytes: bytes, latency_ms: float)
        self.on_connected = None      # fn(conn_info: dict)
        self.on_rejected = None       # fn(reason: str)
        self.on_disconnected = None   # fn()
        self.on_clipboard = None      # fn(text: str)
        self.on_screen_changed = None # fn(screen_idx: int, screens: list)
        self.on_rtt_updated = None    # fn(rtt_ms: float)
        
        self.audio_player = AudioPlayer()
        self._thread = None
        self._write_lock = threading.Lock()
        self._disconnect_lock = threading.Lock()
        self._is_disconnecting = False
        self._last_move_time = 0.0

    def connect_to(self, host: str, port: int = 5858, password: str = "", req_control: bool = True):
        self._is_disconnecting = False
        threading.Thread(target=self._connect_worker, args=(host, port, password, req_control), daemon=True).start()

    def _connect_worker(self, host: str, port: int, password: str, req_control: bool):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 524288)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 524288)
            except Exception:
                pass
            s.settimeout(6.0)
            s.connect((host, port))
            s.settimeout(30.0)
            self.sock = s
            
            req = pack_json(TYPE_CONNECT_REQ, {
                "name": self.my_name,
                "password": password,
                "req_control": req_control
            })
            self.sock.sendall(req)

            msg_type, payload = recv_message(self.sock)
            if msg_type != TYPE_CONNECT_RES:
                if self.on_rejected:
                    self.on_rejected("Invalid response from host")
                self.disconnect()
                return

            res_data = json.loads(payload.decode('utf-8'))
            if not res_data.get("accepted"):
                reason = res_data.get("reason", "Connection declined by remote host")
                if self.on_rejected:
                    self.on_rejected(reason)
                self.disconnect()
                return

            self.connected = True
            self.permissions = res_data.get("permissions", {"screen": True, "control": True, "audio": True})
            self.screens = res_data.get("screens", [])
            self.active_screen = res_data.get("active_screen", 0)
            s.settimeout(None)

            if self.permissions.get("audio", True):
                self.audio_player.start()

            if self.on_connected:
                self.on_connected(res_data)

            # Send immediate ping to establish accurate LAN RTT
            try:
                self._send_raw(pack_message(TYPE_PING, struct.pack('>d', time.monotonic())))
            except Exception:
                pass

            self._thread = threading.Thread(target=self._recv_loop, daemon=True)
            self._thread.start()
            self._ping_thread = threading.Thread(target=self._ping_loop, daemon=True)
            self._ping_thread.start()

        except socket.timeout:
            if self.on_rejected:
                self.on_rejected("Connection timed out waiting for host response")
            self.disconnect()
        except Exception as e:
            if self.on_rejected:
                self.on_rejected(f"Could not connect to {host}:{port} ({e})")
            self.disconnect()

    def _ping_loop(self):
        while self.connected and self.sock:
            try:
                payload = struct.pack('>d', time.monotonic())
                self._send_raw(pack_message(TYPE_PING, payload))
            except Exception:
                pass
            time.sleep(0.5)

    def send_mouse_move(self, norm_x: float, norm_y: float):
        if not self.connected or not self.permissions.get("control"):
            return
        now = time.time()
        # High responsiveness: ~60 updates per second (16ms)
        if now - self._last_move_time < 0.016:
            return
        self._last_move_time = now
        
        msg = pack_mouse_move(norm_x, norm_y)
        self._send_raw(msg)

    def send_mouse_click(self, button: str, action: str, norm_x: float = None, norm_y: float = None):
        if not self.connected or not self.permissions.get("control"):
            return
        payload = {"button": button, "action": action}
        if norm_x is not None and norm_y is not None:
            payload["x"] = norm_x
            payload["y"] = norm_y
        msg = pack_json(TYPE_INPUT_MOUSE_CLICK, payload)
        self._send_raw(msg)

    def send_scroll(self, steps: int):
        if not self.connected or not self.permissions.get("control"):
            return
        msg = pack_scroll(steps)
        self._send_raw(msg)

    def send_key(self, key_name: str, action: str):
        if not self.connected or not self.permissions.get("control"):
            return
        msg = pack_json(TYPE_INPUT_KEY, {"key": key_name, "action": action})
        self._send_raw(msg)

    def send_text(self, text: str):
        if not self.connected or not self.permissions.get("control") or not text:
            return
        msg = pack_json(TYPE_INPUT_KEY, {"key": text, "action": "type"})
        self._send_raw(msg)

    def send_clipboard(self, text: str):
        if not self.connected or not text:
            return
        msg = pack_clipboard(text)
        self._send_raw(msg)

    def send_set_screen(self, screen_index: int):
        if not self.connected:
            return
        msg = pack_json(TYPE_SET_SCREEN, {"screen_index": screen_index})
        self._send_raw(msg)

    def set_audio_muted(self, muted: bool):
        self.audio_player.set_muted(muted)

    def _send_raw(self, data: bytes):
        if not self.sock or not self.connected:
            return
        with self._write_lock:
            try:
                self.sock.sendall(data)
            except Exception:
                self.disconnect()

    def disconnect(self):
        """Atomic clean disconnect that triggers callback exactly once."""
        with self._disconnect_lock:
            if self._is_disconnecting:
                return
            self._is_disconnecting = True

        self.connected = False
        self.audio_player.stop()
        if self.sock:
            try:
                self.sock.sendall(pack_message(TYPE_DISCONNECT, b''))
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

        if self.on_disconnected:
            self.on_disconnected()

    def _recv_loop(self):
        while self.connected and self.sock:
            msg_type, payload = recv_message(self.sock)
            if msg_type is None:
                break

            if msg_type == TYPE_FRAME:
                try:
                    ts, jpeg_bytes = unpack_frame(payload)
                    if self.on_frame:
                        self.on_frame(jpeg_bytes, self.current_rtt_ms)
                except Exception:
                    pass

            elif msg_type == TYPE_PONG:
                try:
                    sent_ts = struct.unpack('>d', payload)[0]
                    rtt = (time.monotonic() - sent_ts) * 1000.0
                    self.current_rtt_ms = max(1.0, rtt)
                    if self.on_rtt_updated:
                        self.on_rtt_updated(self.current_rtt_ms)
                except Exception:
                    pass

            elif msg_type == TYPE_AUDIO:
                if self.permissions.get("audio", True):
                    self.audio_player.feed_audio(payload)

            elif msg_type == TYPE_CLIPBOARD:
                try:
                    text = unpack_clipboard(payload)
                    if self.on_clipboard:
                        self.on_clipboard(text)
                except Exception:
                    pass

            elif msg_type == TYPE_SET_SCREEN:
                try:
                    data = json.loads(payload.decode('utf-8'))
                    s_idx = data.get("screen_index", 0)
                    screens = data.get("screens")
                    if screens is not None:
                        self.screens = screens
                    self.active_screen = s_idx
                    if self.on_screen_changed:
                        self.on_screen_changed(s_idx, self.screens)
                except Exception:
                    pass

            elif msg_type == TYPE_DISCONNECT:
                break

        self.disconnect()
