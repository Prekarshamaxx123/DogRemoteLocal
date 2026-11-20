"""
LanCast Protocol Definition
High-speed binary packet framing for screen streaming and remote control.
"""

import struct
import json
import time

# Packet Types
TYPE_FRAME = 1            # Screen frame (JPEG payload + timestamp)
TYPE_CONNECT_REQ = 2      # Incoming connection request from viewer
TYPE_CONNECT_RES = 3      # Host response (Accept/Decline + permissions)
TYPE_INPUT_MOUSE_MOVE = 4 # Mouse position (normalized 0.0 to 1.0)
TYPE_INPUT_MOUSE_CLICK = 5# Mouse clicks (left, right, middle, down, up, dblclick)
TYPE_INPUT_KEY = 6        # Keyboard key presses
TYPE_PING = 7             # Latency ping
TYPE_PONG = 8             # Latency pong
TYPE_DISCONNECT = 9       # Session termination
TYPE_INPUT_SCROLL = 10    # Mouse wheel scroll (steps: int)
TYPE_CLIPBOARD = 11       # Two-way clipboard text synchronization (UTF-8 payload)
TYPE_AUDIO = 12           # Low-latency raw PCM audio stream
TYPE_SET_SCREEN = 13      # Request or notify change of active display screen

# Header Format: 1 byte type + 4 bytes big-endian length
HEADER_FORMAT = '>BI'
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)

def pack_message(msg_type: int, payload: bytes) -> bytes:
    """Pack packet type and payload into length-prefixed binary message."""
    header = struct.pack(HEADER_FORMAT, msg_type, len(payload))
    return header + payload

def pack_json(msg_type: int, data: dict) -> bytes:
    """Pack JSON serializable dictionary into message."""
    payload = json.dumps(data).encode('utf-8')
    return pack_message(msg_type, payload)

def pack_frame(jpeg_bytes: bytes) -> bytes:
    """Pack JPEG image with a high-resolution 8-byte float timestamp for latency tracking."""
    ts = time.time()
    ts_bytes = struct.pack('>d', ts)
    payload = ts_bytes + jpeg_bytes
    return pack_message(TYPE_FRAME, payload)

def unpack_frame(payload: bytes):
    """Unpack frame payload into (timestamp, jpeg_bytes)."""
    ts = struct.unpack('>d', payload[:8])[0]
    jpeg_bytes = payload[8:]
    return ts, jpeg_bytes

def pack_mouse_move(norm_x: float, norm_y: float) -> bytes:
    """Pack normalized mouse coordinates (2 floats = 8 bytes)."""
    payload = struct.pack('>ff', float(norm_x), float(norm_y))
    return pack_message(TYPE_INPUT_MOUSE_MOVE, payload)

def unpack_mouse_move(payload: bytes):
    """Unpack normalized mouse coordinates."""
    return struct.unpack('>ff', payload)

def pack_scroll(steps: int) -> bytes:
    """Pack scroll steps as signed integer."""
    payload = struct.pack('>i', int(steps))
    return pack_message(TYPE_INPUT_SCROLL, payload)

def unpack_scroll(payload: bytes) -> int:
    """Unpack scroll steps."""
    return struct.unpack('>i', payload)[0]

def pack_clipboard(text: str) -> bytes:
    """Pack UTF-8 clipboard text."""
    payload = text.encode('utf-8')
    return pack_message(TYPE_CLIPBOARD, payload)

def unpack_clipboard(payload: bytes) -> str:
    """Unpack UTF-8 clipboard text."""
    return payload.decode('utf-8', errors='replace')

def pack_audio(pcm_bytes: bytes) -> bytes:
    """Pack raw PCM audio chunk."""
    return pack_message(TYPE_AUDIO, pcm_bytes)

def recv_exact(sock, n_bytes: int):
    """Read exactly n_bytes from socket, or return None on disconnect."""
    data = bytearray()
    while len(data) < n_bytes:
        try:
            chunk = sock.recv(min(n_bytes - len(data), 65536))
            if not chunk:
                return None
            data.extend(chunk)
        except Exception:
            return None
    return bytes(data)

def recv_message(sock):
    """Receive a complete packet (type, payload) from socket."""
    header_bytes = recv_exact(sock, HEADER_SIZE)
    if not header_bytes:
        return None, None
    msg_type, length = struct.unpack(HEADER_FORMAT, header_bytes)
    payload = recv_exact(sock, length) if length > 0 else b''
    if payload is None and length > 0:
        return None, None
    return msg_type, payload
