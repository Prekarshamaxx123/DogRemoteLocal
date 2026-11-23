"""
LanCast TCP Streaming Server & Input Simulator
High performance frame broadcasting, remote mouse/keyboard control,
password-protected security, interactive approval modal, two-way clipboard sync, and audio streaming.
"""

import socket
import threading
import json
import subprocess
import os
import queue
import sys

try:
    import websockets
    import asyncio
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

from .protocol import (
    TYPE_CONNECT_REQ, TYPE_CONNECT_RES, TYPE_INPUT_MOUSE_MOVE,
    TYPE_INPUT_MOUSE_CLICK, TYPE_INPUT_KEY, TYPE_INPUT_SCROLL,
    TYPE_CLIPBOARD, TYPE_AUDIO, TYPE_PING, TYPE_PONG, TYPE_DISCONNECT,
    TYPE_SET_SCREEN,
    pack_message, pack_json, pack_frame, pack_clipboard, pack_audio,
    unpack_mouse_move, unpack_scroll, unpack_clipboard, recv_message
)
from .audio import AudioCapture

class WsClientWrapper:
    """Zero-lag WebSocket frame dispatcher ensuring only the freshest frame is sent."""
    def __init__(self, ws, loop):
        self.ws = ws
        self.loop = loop
        self.is_sending = False
        self.pending_frame = None

    def push_frame(self, frame_bytes: bytes):
        if not self.is_sending:
            self.is_sending = True
            try:
                self.loop.call_soon_threadsafe(asyncio.create_task, self._send_frame(frame_bytes))
            except Exception:
                self.is_sending = False
        else:
            self.pending_frame = frame_bytes

    async def _send_frame(self, frame_bytes: bytes):
        try:
            await self.ws.send(frame_bytes)
        except Exception:
            self.is_sending = False
            return

        if self.pending_frame is not None:
            next_f = self.pending_frame
            self.pending_frame = None
            try:
                self.loop.call_soon_threadsafe(asyncio.create_task, self._send_frame(next_f))
            except Exception:
                self.is_sending = False
        else:
            self.is_sending = False

class LanCastServer:
    def __init__(self, host='0.0.0.0', port=5858, screen_rect=(0, 0, 1920, 1080)):
        self.host = host
        self.port = port
        self.screen_offset_x = screen_rect[0]
        self.screen_offset_y = screen_rect[1]
        self.screen_w = screen_rect[2]
        self.screen_h = screen_rect[3]
        
        self.running = False
        self.is_sharing = False
        self.auto_accept = False  # If no password, prompt user with interactive popup
        self.access_password = ""  # Set by host
        self.audio_enabled = True
        
        self.clients = []
        self._lock = threading.RLock()
        
        self.on_incoming_request = None  # fn(session, data)
        self.on_client_joined = None     # fn(session)
        self.on_client_left = None       # fn(session)
        self.on_clipboard_received = None# fn(text: str)
        self.on_screen_switch_requested = None  # fn(screen_idx: int)
        self.on_quality_switch_requested = None # fn(quality_idx: int)
        self.on_peer_detected = None            # fn(ip: str, name: str, port: int)
        self.on_sharing_changed = None          # fn(enable: bool)
        
        self.screens_info = []
        self.active_screen_idx = 0
        
        self.sock = None
        self._server_thread = None
        self._input_proc = None
        self._input_lock = threading.Lock()
        self._audio_capture = None

        self.ws_port = 5859
        self.ws_clients = {}
        self.ws_loop = None

    def start(self):
        self.running = True
        self._ensure_input_simulator()
        
        current_port = self.port
        while current_port < self.port + 50:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except (AttributeError, OSError):
                    pass
                s.bind((self.host, current_port))
                s.listen(10)
                self.sock = s
                self.port = current_port
                break
            except OSError:
                current_port += 1

        self._server_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._server_thread.start()
        print(f"[DogRemote] Server listening on port {self.port}")

        if HAS_WEBSOCKETS:
            self._start_ws_server()

    def stop(self):
        self.running = False
        self.stop_audio()
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
        with self._lock:
            for c in list(self.clients):
                c.close()
            self.clients.clear()
        self._close_input_simulator()

    def start_audio(self):
        if not self.audio_enabled or self._audio_capture:
            return
        self._audio_capture = AudioCapture(on_audio_data=self.broadcast_audio)
        self._audio_capture.start()

    def stop_audio(self):
        if self._audio_capture:
            self._audio_capture.stop()
            self._audio_capture = None

    def set_screen_rect(self, x: int, y: int, width: int, height: int):
        self.screen_offset_x = x
        self.screen_offset_y = y
        self.screen_w = width
        self.screen_h = height

    def _ensure_input_simulator(self):
        with self._input_lock:
            if self._input_proc is None or self._input_proc.poll() is not None:
                display = os.environ.get('DISPLAY', ':0')
                env = dict(os.environ, DISPLAY=display)
                
                xauth = os.environ.get('XAUTHORITY')
                if not xauth or not os.path.exists(xauth):
                    uid = os.getuid() if hasattr(os, 'getuid') else 1000
                    candidates = [
                        os.path.expanduser('~/.Xauthority'),
                        f"/run/user/{uid}/gdm/Xauthority",
                        f"/run/user/{uid}/Xauthority",
                    ]
                    import glob
                    candidates.extend(glob.glob(f"/run/user/{uid}/*/Xauthority"))
                    candidates.extend(glob.glob(f"/run/user/{uid}/xauth_*"))
                    for cand in candidates:
                        if os.path.exists(cand):
                            xauth = cand
                            break

                if xauth and os.path.exists(xauth):
                    env['XAUTHORITY'] = xauth
                    
                try:
                    self._input_proc = subprocess.Popen(
                        ['xdotool', '-'],
                        stdin=subprocess.PIPE,
                        text=True,
                        env=env,
                        bufsize=1
                    )
                except Exception as e:
                    print(f"[LanCast] Warning: could not launch xdotool: {e}")

    def _send_xdotool(self, cmd_str: str):
        self._ensure_input_simulator()
        with self._input_lock:
            if self._input_proc and self._input_proc.stdin:
                try:
                    self._input_proc.stdin.write(cmd_str)
                    self._input_proc.stdin.flush()
                except Exception as e:
                    print(f"[LanCast] xdotool write error: {e}", flush=True)
                    self._input_proc = None

    def _close_input_simulator(self):
        with self._input_lock:
            if self._input_proc:
                try:
                    self._input_proc.stdin.close()
                    self._input_proc.terminate()
                except Exception:
                    pass
                self._input_proc = None

    def _listen_loop(self):
        while self.running:
            try:
                client_sock, addr = self.sock.accept()
                client_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                try:
                    client_sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 524288)
                    client_sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 524288)
                except Exception:
                    pass
                session = ClientSession(self, client_sock, addr)
                with self._lock:
                    self.clients.append(session)
                session.start()
            except Exception:
                if not self.running:
                    break
                import time
                time.sleep(0.1)

    def broadcast_frame(self, jpeg_bytes: bytes):
        """Dispatches latest frame to all clients with zero queue lag."""
        if self.ws_loop and self.ws_clients:
            for wrapper in list(self.ws_clients.values()):
                wrapper.push_frame(jpeg_bytes)

        with self._lock:
            if not self.clients:
                return
            targets = [c for c in self.clients if c.is_approved and c.running]

        if not targets:
            return

        frame_msg = pack_frame(jpeg_bytes)
        for client in targets:
            client.queue_frame(frame_msg)

    def broadcast_audio(self, pcm_bytes: bytes):
        if not self.audio_enabled or not pcm_bytes:
            return
        with self._lock:
            if not self.clients:
                return
            targets = [c for c in self.clients if c.is_approved and c.running and c.allow_audio]

        if not targets:
            return

        audio_msg = pack_audio(pcm_bytes)
        for client in targets:
            client.send_raw(audio_msg)

    def broadcast_clipboard(self, text: str, exclude_session=None):
        if not text:
            return
        if self.ws_loop and self.ws_clients:
            ws_msg = json.dumps({"type": "clipboard", "text": text})
            for ws in list(self.ws_clients.keys()):
                try:
                    self.ws_loop.call_soon_threadsafe(asyncio.create_task, ws.send(ws_msg))
                except Exception:
                    pass

        with self._lock:
            targets = [c for c in self.clients if c.is_approved and c.running and c != exclude_session]

        if not targets:
            return

        clip_msg = pack_clipboard(text)
        for client in targets:
            client.send_raw(clip_msg)

    def set_available_screens(self, screens: list, active_id: int = 0):
        self.screens_info = screens
        self.active_screen_idx = active_id

    def broadcast_screen_changed(self, screen_idx: int, screens_info=None):
        self.active_screen_idx = screen_idx
        if screens_info is not None:
            self.screens_info = screens_info

        if self.ws_loop and self.ws_clients:
            ws_msg = json.dumps({
                "type": "screen_changed",
                "screen_index": screen_idx,
                "screens": self.screens_info
            })
            for ws in list(self.ws_clients.keys()):
                try:
                    self.ws_loop.call_soon_threadsafe(asyncio.create_task, ws.send(ws_msg))
                except Exception:
                    pass

        msg = pack_json(TYPE_SET_SCREEN, {
            "screen_index": screen_idx,
            "screens": self.screens_info
        })
        with self._lock:
            targets = [c for c in self.clients if c.is_approved and c.running]
        for client in targets:
            client.send_raw(msg)

    def remove_client(self, session):
        with self._lock:
            if session in self.clients:
                self.clients.remove(session)
        if self.on_client_left:
            self.on_client_left(session)

    def execute_mouse_move(self, norm_x: float, norm_y: float):
        gx = self.screen_offset_x + max(0, min(self.screen_w, int(norm_x * self.screen_w)))
        gy = self.screen_offset_y + max(0, min(self.screen_h, int(norm_y * self.screen_h)))
        self._send_xdotool(f"mousemove {gx} {gy}\n")

    def execute_mouse_click(self, btn_name: str, action: str, norm_x: float = None, norm_y: float = None):
        btn_map = {'left': '1', 'middle': '2', 'right': '3'}
        b = btn_map.get(btn_name, '1')
        cmd = ""
        if norm_x is not None and norm_y is not None:
            gx = self.screen_offset_x + max(0, min(self.screen_w, int(norm_x * self.screen_w)))
            gy = self.screen_offset_y + max(0, min(self.screen_h, int(norm_y * self.screen_h)))
            cmd += f"mousemove {gx} {gy}\n"
        
        if action == 'down':
            cmd += f"mousedown {b}\n"
        elif action == 'up':
            cmd += f"mouseup {b}\n"
        elif action == 'click':
            cmd += f"click {b}\n"
        elif action == 'dblclick':
            cmd += f"click --repeat 2 --delay 50 {b}\n"
            
        self._send_xdotool(cmd)

    def execute_scroll(self, steps: int):
        btn = '4' if steps > 0 else '5'
        count = min(max(1, abs(steps)), 8)
        self._send_xdotool(f"click --repeat {count} {btn}\n")

    def execute_key(self, key_name: str, action: str):
        if not key_name:
            return
        if action == 'type':
            escaped = key_name.replace('"', '\\"')
            self._send_xdotool(f'type -- "{escaped}"\n')
        elif action == 'key':
            self._send_xdotool(f"key {key_name}\n")
        else:
            cmd = 'keydown' if action == 'down' else 'keyup'
            self._send_xdotool(f"{cmd} {key_name}\n")

    def _start_ws_server(self):
        def run_ws():
            async def ws_handler(websocket):
                await self._handle_ws_client(websocket)

            def proc_req(conn, req):
                import http
                if req.path.startswith("/api/share"):
                    if "start" in req.path:
                        self.is_sharing = True
                        if self.on_sharing_changed:
                            self.on_sharing_changed(True)
                    elif "stop" in req.path:
                        self.is_sharing = False
                        if self.on_sharing_changed:
                            self.on_sharing_changed(False)
                    body = json.dumps({
                        "service": "lancast",
                        "sharing": bool(self.is_sharing)
                    })
                    res = conn.respond(http.HTTPStatus.OK, body)
                    res.headers["Content-Type"] = "application/json"
                    res.headers["Access-Control-Allow-Origin"] = "*"
                    return res

                # Respond to HTTP GET probes for auto-discovery
                if req.path == "/info" or req.headers.get("Upgrade", "").lower() != "websocket":
                    body = json.dumps({
                        "service": "lancast",
                        "name": socket.gethostname(),
                        "host": socket.gethostname(),
                        "port": self.ws_port,
                        "sharing": bool(self.is_sharing)
                    })
                    res = conn.respond(http.HTTPStatus.OK, body)
                    res.headers["Content-Type"] = "application/json"
                    res.headers["Access-Control-Allow-Origin"] = "*"
                    return res
                return None

            async def main_ws():
                self.ws_loop = asyncio.get_running_loop()
                try:
                    async with websockets.serve(ws_handler, self.host, self.ws_port, process_request=proc_req):
                        print(f"[DogRemote] Mobile WebSocket server listening on port {self.ws_port}")
                        await asyncio.Future()
                except Exception as e:
                    print(f"[DogRemote] WebSocket server error: {e}")

            try:
                asyncio.run(main_ws())
            except Exception as e:
                print(f"[DogRemote] WebSocket runner exited: {e}")

        threading.Thread(target=run_ws, daemon=True).start()

    async def _handle_ws_client(self, websocket):
        client_name = "Mobile Device"
        client_ip = websocket.remote_address[0] if websocket.remote_address else ""

        try:
            raw = await websocket.recv()
            if isinstance(raw, str):
                data = json.loads(raw)
                client_name = data.get("name", client_name)
                mtype = data.get("type", "")

                if self.on_peer_detected and client_ip and not client_ip.startswith("127."):
                    try:
                        self.on_peer_detected(client_ip, client_name, 5859)
                    except Exception:
                        pass

                if mtype == "peer_announce":
                    await websocket.send(json.dumps({
                        "type": "announce_ack",
                        "name": socket.gethostname(),
                        "host": socket.gethostname(),
                        "sharing": bool(self.is_sharing)
                    }))
                    return

                req_pwd = str(data.get("password", "")).strip()

                if self.access_password:
                    if req_pwd == self.access_password:
                        pass
                    else:
                        reason = "PASSWORD_INCORRECT" if req_pwd else "PASSWORD_REQUIRED"
                        await websocket.send(json.dumps({
                            "type": "connect_res",
                            "accepted": False,
                            "reason": reason
                        }))
                        return

                wrapper = WsClientWrapper(websocket, self.ws_loop)
                self.ws_clients[websocket] = wrapper
                await websocket.send(json.dumps({
                    "type": "connect_res",
                    "accepted": True,
                    "screens": self.screens_info,
                    "active_screen": self.active_screen_idx,
                    "client_ip": client_ip
                }))
                print(f"[DogRemote] Mobile client connected & approved: {client_name}")
                if self.on_client_joined:
                    try:
                        self.on_client_joined(None)
                    except Exception:
                        pass

            async for message in websocket:
                if isinstance(message, str):
                    msg = json.loads(message)
                    mtype = msg.get("type")
                    if mtype == "ping":
                        import time
                        await websocket.send(json.dumps({
                            "type": "pong",
                            "client_ts": msg.get("ts"),
                            "server_ts": int(time.time() * 1000)
                        }))
                    elif mtype == "set_screen":
                        s_idx = msg.get("screen_index", 0)
                        if self.on_screen_switch_requested:
                            self.on_screen_switch_requested(s_idx)
                        self.broadcast_screen_changed(s_idx, self.screens_info)
                    elif mtype == "set_quality":
                        q_idx = int(msg.get("quality_index", 0))
                        if self.on_quality_switch_requested:
                            self.on_quality_switch_requested(q_idx)
                    elif mtype == "mouse_move":
                        self.execute_mouse_move(float(msg.get("x", 0.5)), float(msg.get("y", 0.5)))
                    elif mtype == "mouse_click":
                        self.execute_mouse_click(
                            msg.get("button", "left"),
                            msg.get("action", "click"),
                            float(msg["x"]) if "x" in msg and msg["x"] is not None else None,
                            float(msg["y"]) if "y" in msg and msg["y"] is not None else None
                        )
                    elif mtype == "scroll":
                        self.execute_scroll(int(msg.get("steps", 0)))
                    elif mtype == "key":
                        self.execute_key(str(msg.get("key", "")), str(msg.get("action", "key")))
                    elif mtype == "clipboard":
                        clip_text = str(msg.get("text", ""))
                        if self.on_clipboard_received:
                            self.on_clipboard_received(clip_text)
                        self.broadcast_clipboard(clip_text)
        except Exception:
            pass
        finally:
            self.ws_clients.pop(websocket, None)
            print(f"[DogRemote] Mobile client disconnected: {client_name}")
            if self.on_client_left:
                try:
                    self.on_client_left(None)
                except Exception:
                    pass

class ClientSession:
    def __init__(self, server: LanCastServer, sock: socket.socket, addr):
        self.server = server
        self.sock = sock
        self.addr = addr
        self.is_approved = False
        self.allow_control = True
        self.allow_audio = True
        self.peer_name = f"Device-{addr[0]}"
        self.running = False
        self._thread = None
        self._sender_thread = None
        self._write_lock = threading.Lock()
        self._frame_queue = queue.Queue(maxsize=1)
        self._is_closing = False

    def start(self):
        self.running = True
        try:
            self.sock.settimeout(None)
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            try:
                self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 524288)
                self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 524288)
            except Exception:
                pass
        except Exception:
            pass
        self._thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._thread.start()
        self._sender_thread = threading.Thread(target=self._sender_loop, daemon=True)
        self._sender_thread.start()

    def queue_frame(self, frame_msg: bytes):
        """Pushes frame into 1-item queue; replaces stale frame to eliminate latency."""
        if not self.running or not self.is_approved:
            return
        try:
            self._frame_queue.put_nowait(frame_msg)
        except queue.Full:
            try:
                self._frame_queue.get_nowait()
                self._frame_queue.put_nowait(frame_msg)
            except Exception:
                pass

    def _sender_loop(self):
        while self.running:
            try:
                frame_msg = self._frame_queue.get(timeout=0.4)
            except queue.Empty:
                continue
            self.send_raw(frame_msg)

    def send_raw(self, data: bytes):
        if not self.running or not self.sock:
            return
        if not self._write_lock.acquire(timeout=0.25):
            return
        try:
            self.sock.sendall(data)
        except Exception:
            self.close()
        finally:
            try:
                self._write_lock.release()
            except RuntimeError:
                pass

    def accept_connection(self, allow_control: bool = True, allow_audio: bool = True):
        self.is_approved = True
        self.allow_control = allow_control
        self.allow_audio = allow_audio
        resp = pack_json(TYPE_CONNECT_RES, {
            "accepted": True,
            "permissions": {"screen": True, "control": allow_control, "audio": allow_audio},
            "screens": self.server.screens_info,
            "active_screen": self.server.active_screen_idx
        })
        self.send_raw(resp)
        if self.server.on_client_joined:
            self.server.on_client_joined(self)

    def reject_connection(self, reason: str = "Connection declined"):
        resp = pack_json(TYPE_CONNECT_RES, {"accepted": False, "reason": reason})
        self.send_raw(resp)
        self.close()

    def close(self):
        if self._is_closing:
            return
        self._is_closing = True
        self.running = False
        try:
            self.sock.close()
        except Exception:
            pass
        self.server.remove_client(self)

    def _recv_loop(self):
        while self.running:
            msg_type, payload = recv_message(self.sock)
            if msg_type is None:
                break

            if msg_type == TYPE_CONNECT_REQ:
                try:
                    data = json.loads(payload.decode('utf-8'))
                    self.peer_name = data.get("name", self.peer_name)
                    req_control = data.get("req_control", True)
                    req_password = data.get("password", "").strip()
                    
                    # 1. Host has a security password configured
                    if self.server.access_password:
                        if req_password == self.server.access_password:
                            self.accept_connection(allow_control=req_control)
                        else:
                            # Reject with specific password code so client can prompt user
                            reason_code = "PASSWORD_INCORRECT" if req_password else "PASSWORD_REQUIRED"
                            self.reject_connection(reason_code)
                    else:
                        # 2. Host has NO password configured
                        if self.server.auto_accept:
                            self.accept_connection(allow_control=req_control)
                        elif self.server.on_incoming_request:
                            # Pop up interactive Accept/Decline modal on host screen!
                            self.server.on_incoming_request(self, data)
                        else:
                            self.accept_connection(allow_control=req_control)
                except Exception:
                    pass

            elif msg_type == TYPE_INPUT_MOUSE_MOVE:
                if self.is_approved and self.allow_control:
                    try:
                        nx, ny = unpack_mouse_move(payload)
                        self.server.execute_mouse_move(nx, ny)
                    except Exception:
                        pass

            elif msg_type == TYPE_INPUT_MOUSE_CLICK:
                if self.is_approved and self.allow_control:
                    try:
                        info = json.loads(payload.decode('utf-8'))
                        self.server.execute_mouse_click(
                            info.get('button', 'left'),
                            info.get('action', 'click'),
                            info.get('x'),
                            info.get('y')
                        )
                    except Exception:
                        pass

            elif msg_type == TYPE_INPUT_SCROLL:
                if self.is_approved and self.allow_control:
                    try:
                        steps = unpack_scroll(payload)
                        self.server.execute_scroll(steps)
                    except Exception:
                        pass

            elif msg_type == TYPE_INPUT_KEY:
                if self.is_approved and self.allow_control:
                    try:
                        info = json.loads(payload.decode('utf-8'))
                        self.server.execute_key(info.get('key', ''), info.get('action', 'down'))
                    except Exception:
                        pass

            elif msg_type == TYPE_CLIPBOARD:
                if self.is_approved:
                    try:
                        clip_text = unpack_clipboard(payload)
                        if self.server.on_clipboard_received:
                            self.server.on_clipboard_received(clip_text)
                        self.server.broadcast_clipboard(clip_text, exclude_session=self)
                    except Exception:
                        pass

            elif msg_type == TYPE_PING:
                self.send_raw(pack_message(TYPE_PONG, payload))

            elif msg_type == TYPE_SET_SCREEN:
                if self.is_approved:
                    try:
                        info = json.loads(payload.decode('utf-8'))
                        sid = info.get("screen_index", 0)
                        if self.server.on_screen_switch_requested:
                            self.server.on_screen_switch_requested(sid)
                    except Exception:
                        pass

            elif msg_type == TYPE_DISCONNECT:
                break

        self.close()
