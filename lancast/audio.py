"""
LanCast Audio Streaming Engine
High-efficiency, low-latency audio capture and playback for LAN screen sharing.
Streams 16-bit 22050 Hz mono PCM across the local network with near-zero latency.
"""

import subprocess
import threading
import shutil
import time
import os

class AudioCapture:
    """Captures host system audio monitor output."""
    def __init__(self, on_audio_data):
        self.on_audio_data = on_audio_data
        self.running = False
        self._proc = None
        self._thread = None

    def start(self):
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def _get_capture_command(self):
        # Prefer pw-record for PipeWire systems, fallback to parec
        if shutil.which("pw-record"):
            return ["pw-record", "-", "--rate", "22050", "--channels", "1", "--format", "s16"]
        elif shutil.which("parec"):
            return ["parec", "--format=s16le", "--rate=22050", "--channels=1"]
        return None

    def _capture_loop(self):
        cmd = self._get_capture_command()
        if not cmd:
            print("[LanCast Audio] No audio capture utility (pw-record or parec) available.")
            return

        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=4096
            )
        except Exception as e:
            print(f"[LanCast Audio] Failed to launch audio recorder: {e}")
            return

        chunk_size = 2048
        while self.running and self._proc and self._proc.poll() is None:
            try:
                data = self._proc.stdout.read(chunk_size)
                if not data:
                    break
                if self.on_audio_data:
                    self.on_audio_data(data)
            except Exception:
                break

        self.stop()

    def stop(self):
        self.running = False
        if self._proc:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=0.5)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None


class AudioPlayer:
    """Plays received PCM audio on viewer device."""
    def __init__(self):
        self.running = False
        self.muted = False
        self._proc = None
        self._lock = threading.Lock()

    def start(self):
        if self.running:
            return
        self.running = True
        self._ensure_player()

    def _ensure_player(self):
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return

            cmd = None
            if shutil.which("pw-play"):
                cmd = ["pw-play", "-", "--rate", "22050", "--channels", "1", "--format", "s16"]
            elif shutil.which("paplay"):
                cmd = ["paplay", "--raw", "--format=s16le", "--rate=22050", "--channels=1"]
            elif shutil.which("aplay"):
                cmd = ["aplay", "-r", "22050", "-c", "1", "-f", "S16_LE", "-t", "raw", "-"]

            if not cmd:
                return

            try:
                self._proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    bufsize=4096
                )
            except Exception as e:
                print(f"[LanCast Audio] Failed to launch audio player: {e}")
                self._proc = None

    def feed_audio(self, pcm_bytes: bytes):
        if not self.running or self.muted or not pcm_bytes:
            return
        self._ensure_player()
        with self._lock:
            if self._proc and self._proc.stdin:
                try:
                    self._proc.stdin.write(pcm_bytes)
                    self._proc.stdin.flush()
                except Exception:
                    self._proc = None

    def set_muted(self, muted: bool):
        self.muted = muted

    def stop(self):
        self.running = False
        with self._lock:
            if self._proc:
                try:
                    if self._proc.stdin:
                        self._proc.stdin.close()
                    self._proc.terminate()
                except Exception:
                    pass
                self._proc = None
