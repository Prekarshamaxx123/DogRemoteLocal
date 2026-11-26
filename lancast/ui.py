"""
LanCast Pro - Native PyQt6 User Interface
Ultra-modern dark violet/slate theme inspired by enterprise monitoring dashboards.
High performance screen streaming with zero-lag background capture,
random auto-generated default password, password authentication modal,
on-demand LAN scanner, two-way clipboard sync, and audio streaming.
"""

import sys
import socket
import os
import time
import random
import string
import threading
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QLineEdit, QComboBox, QCheckBox, QFrame,
    QScrollArea, QDialog, QMessageBox, QGraphicsDropShadowEffect
)
from PyQt6.QtGui import (
    QPixmap, QPainter, QColor, QFont, QCursor, QGuiApplication,
    QIcon, QLinearGradient, QBrush, QPen, QPolygon
)
from PyQt6.QtCore import (
    Qt, QTimer, pyqtSignal, QObject, QBuffer, QIODevice, QPoint, QSize
)

from .server import LanCastServer, ClientSession
from .client import LanCastClient
from .discovery import LanDiscovery

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
if not os.path.exists(PUBLIC_DIR):
    PUBLIC_DIR = os.path.join(getattr(sys, '_MEIPASS', os.path.abspath('.')), 'public')
APP_ICON = os.path.join(PUBLIC_DIR, 'icon.png').replace('\\', '/')

def generate_random_password(length=6):
    """Generate clean, 6-digit numeric random password."""
    return f"{random.randint(100000, 999999)}"

# ========================================================
# Ultra-Modern Professional Dark Theme (Deep Slate / Violet)
# ========================================================
DARK_THEME = """
/* Global Window & Text Settings */
QMainWindow, QDialog {
    background-color: #0b0e17;
}

QWidget {
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
}

QLabel {
    background: transparent;
    border: none;
}

QFrame {
    background: transparent;
}

/* Glassmorphic Container Cards */
QFrame.dashboard-card {
    background-color: #12172a;
    border: 1px solid rgba(139, 92, 246, 0.20);
    border-radius: 16px;
    padding: 22px;
}
QFrame.dashboard-card:hover {
    border-color: rgba(139, 92, 246, 0.40);
}

/* Section Header Badges */
QLabel.section-tag {
    font-size: 11px;
    font-weight: 800;
    color: #a78bfa;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    background: transparent;
}

/* Card Titles */
QLabel.card-title {
    font-size: 17px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.3px;
}

QLabel.card-subtitle {
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.4;
}

/* Machine Info Pill Container */
QFrame.info-container {
    background-color: #0d1222;
    border: 1px solid rgba(139, 92, 246, 0.28);
    border-radius: 12px;
    padding: 10px 14px;
}
QFrame.info-container:hover {
    border-color: #8b5cf6;
}

QLabel.info-label {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 600;
}

QLabel.info-value {
    font-family: "JetBrains Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
}

/* Modern Inputs */
QLineEdit {
    background-color: #0d1222;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 9px 14px;
    color: #ffffff;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    selection-background-color: #6366f1;
}
QLineEdit:focus {
    border: 1.5px solid #8b5cf6;
    background-color: #10162a;
}
QLineEdit::placeholder {
    color: #64748b;
}

/* Dropdown Menus */
QComboBox {
    background-color: #0d1222;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 9px;
    padding: 8px 14px;
    color: #f1f5f9;
    font-size: 12px;
    font-weight: 500;
}
QComboBox:hover {
    border-color: rgba(139, 92, 246, 0.5);
}
QComboBox::drop-down {
    border: none;
    width: 28px;
}
QComboBox QAbstractItemView {
    background-color: #12172a;
    border: 1px solid rgba(139, 92, 246, 0.35);
    border-radius: 8px;
    padding: 4px;
    color: #ffffff;
    selection-background-color: #6366f1;
    selection-color: #ffffff;
    outline: none;
}

/* Checkboxes */
QCheckBox {
    background: transparent;
    spacing: 10px;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 500;
}
QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1.5px solid #475569;
    background: #0d1222;
}
QCheckBox::indicator:hover {
    border-color: #a78bfa;
}
QCheckBox::indicator:checked {
    background: #6366f1;
    border-color: #8b5cf6;
}

/* CTA Primary Button (Violet to Indigo Radiant Gradient) */
QPushButton.btn-cta {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #6366f1, stop:1 #8b5cf6);
    color: #ffffff;
    font-weight: 700;
    font-size: 13px;
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
}
QPushButton.btn-cta:hover {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #4f46e5, stop:1 #7c3aed);
}
QPushButton.btn-cta:pressed {
    background: #4338ca;
}
QPushButton.btn-cta:disabled {
    background: #1e2538;
    color: #64748b;
}

/* Danger / Stop Button */
QPushButton.btn-danger-cta {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #dc2626, stop:1 #ef4444);
    color: #ffffff;
    font-weight: 700;
    font-size: 13px;
    border: none;
    border-radius: 10px;
    padding: 10px 18px;
}
QPushButton.btn-danger-cta:hover {
    background: #dc2626;
}

/* Secondary Button (Neutral Dark Slate) */
QPushButton.btn-secondary {
    background-color: #192138;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    border-radius: 8px;
    padding: 8px 13px;
    font-size: 12px;
    font-weight: 600;
}
QPushButton.btn-secondary:hover {
    background-color: #222d4c;
    border-color: #8b5cf6;
    color: #ffffff;
}
QPushButton.btn-secondary:disabled {
    background-color: #111624;
    color: #475569;
    border-color: transparent;
}

/* Header Status Badges */
QLabel.status-online {
    background-color: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.4);
    color: #34d399;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
}

QLabel.brand-badge {
    background-color: rgba(139, 92, 246, 0.18);
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: #c4b5fd;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
}

QLabel.ip-pill {
    background-color: #12182c;
    color: #cbd5e1;
    border: 1px solid rgba(139, 92, 246, 0.25);
    border-radius: 8px;
    padding: 5px 12px;
    font-family: monospace;
    font-size: 12px;
    font-weight: 600;
}

/* Scrollbars */
QScrollBar:vertical {
    background: transparent;
    width: 6px;
    margin: 0;
}
QScrollBar::handle:vertical {
    background: #334155;
    border-radius: 3px;
    min-height: 24px;
}
QScrollBar::handle:vertical:hover {
    background: #8b5cf6;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0px;
}
"""

def get_local_ip():
    for probe_target in ('192.168.8.1', '192.168.1.1', '8.8.8.8', '1.1.1.1'):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((probe_target, 80))
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith('127.') and not ip.startswith('172.'):
                return ip
        except Exception:
            pass

    try:
        import subprocess
        out = subprocess.check_output(['ip', '-4', 'addr', 'show'], text=True)
        for line in out.splitlines():
            line = line.strip()
            if line.startswith('inet ') and not any(v in line for v in ('127.0.0.1', 'docker', 'br-', 'veth')):
                parts = line.split()
                ip = parts[1].split('/')[0]
                if not ip.startswith('172.'):
                    return ip
    except Exception:
        pass

    return '192.168.8.185'


class SignalBridge(QObject):
    device_discovered = pyqtSignal(dict, bool)
    device_lost = pyqtSignal(str)
    scan_finished = pyqtSignal()
    incoming_request = pyqtSignal(object, dict)
    client_joined = pyqtSignal(object)
    client_left = pyqtSignal(object)
    frame_received = pyqtSignal(bytes, float)
    connected = pyqtSignal(dict)
    rejected = pyqtSignal(str, str, int)  # reason, ip, port
    disconnected = pyqtSignal()
    clipboard_received = pyqtSignal(str)
    screen_switch_requested = pyqtSignal(int)
    screen_changed = pyqtSignal(int, list)
    rtt_updated = pyqtSignal(float)
    sharing_toggled = pyqtSignal(bool)


# ========================================================
# Screen Viewer Window (Ultra-Compact Sleek Floating HUD)
# ========================================================
class ScreenViewerWindow(QMainWindow):
    def __init__(self, client: LanCastClient, peer_name: str, bridge: SignalBridge, conn_info: dict = None):
        super().__init__()
        self.client = client
        self.peer_name = peer_name
        self.bridge = bridge
        self.conn_info = conn_info or {}
        self.remote_control_enabled = True
        self.audio_enabled = True
        self.toolbar_collapsed = False
        self.user_initiated_close = False
        self._has_shown_disconnect = False
        self._last_copied_text = ""
        
        self.setWindowTitle(f"DogRemote Local Stream - {peer_name}")
        self.setWindowIcon(QIcon(APP_ICON))
        self.resize(1280, 720)
        self.setMinimumSize(640, 360)
        self.setStyleSheet(DARK_THEME)

        self.current_pixmap = None
        self.video_rect = None
        
        self.init_ui()
        self.bridge.frame_received.connect(self.on_new_frame)
        self.bridge.disconnected.connect(self.on_remote_disconnect)
        self.bridge.clipboard_received.connect(self.on_clipboard_sync)
        self.bridge.screen_changed.connect(self.on_host_screen_changed)
        self.bridge.rtt_updated.connect(self.on_rtt_updated)

        # Performance & Stats Tracking
        self.frame_count = 0
        self.fps = 60
        self.last_fps_time = time.time()
        self.current_rtt = 1.0

        # Dedicated stats refresh timer (avoids burning CPU calling setText 60 FPS)
        self.stats_timer = QTimer(self)
        self.stats_timer.setInterval(500)
        self.stats_timer.timeout.connect(self.update_hud_stats)
        self.stats_timer.start()

        # Initialize screen dropdown with host's available displays
        screens = self.conn_info.get("screens", [])
        active_screen = self.conn_info.get("active_screen", 0)
        self.update_screens_list(screens, active_screen)

        app_clip = QApplication.clipboard()
        app_clip.dataChanged.connect(self.on_local_clipboard_changed)

    def init_ui(self):
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Sleek Floating HUD Bar (Deep slate / violet accent)
        self.toolbar = QFrame()
        self.toolbar.setStyleSheet("""
            QFrame {
                background-color: rgba(11, 14, 23, 0.95);
                border-bottom: 1px solid rgba(139, 92, 246, 0.3);
                padding: 3px 12px;
                max-height: 36px;
            }
        """)
        tb_layout = QHBoxLayout(self.toolbar)
        tb_layout.setContentsMargins(10, 2, 10, 2)
        tb_layout.setSpacing(12)

        self.lbl_live = QLabel("LIVE")
        self.lbl_live.setStyleSheet("""
            background-color: rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(239, 68, 68, 0.5);
            color: #f87171;
            font-weight: 800;
            font-size: 10px;
            letter-spacing: 0.8px;
            padding: 2px 8px;
            border-radius: 4px;
        """)
        tb_layout.addWidget(self.lbl_live)

        lbl_peer = QLabel(self.peer_name)
        lbl_peer.setStyleSheet("font-weight: 700; font-size: 12px; color: #ffffff;")
        tb_layout.addWidget(lbl_peer)

        self.lbl_stats = QLabel("1 ms | 60 FPS")
        self.lbl_stats.setStyleSheet("""
            background-color: rgba(139, 92, 246, 0.12);
            border: 1px solid rgba(139, 92, 246, 0.28);
            border-radius: 4px;
            padding: 2px 8px;
            font-family: monospace;
            font-size: 10px;
            font-weight: bold;
            color: #c4b5fd;
        """)
        tb_layout.addWidget(self.lbl_stats)

        tb_layout.addStretch()

        # Multi-Screen Switcher in Viewer Toolbar
        lbl_screen_tag = QLabel("Screen:")
        lbl_screen_tag.setStyleSheet("color: #94a3b8; font-size: 11px; font-weight: 700; margin-left: 2px;")
        tb_layout.addWidget(lbl_screen_tag)

        self.combo_screen = QComboBox()
        self.combo_screen.setStyleSheet("""
            QComboBox {
                background-color: #151b30;
                border: 1px solid rgba(139, 92, 246, 0.45);
                color: #e2e8f0;
                border-radius: 6px;
                padding: 2px 8px;
                font-size: 11px;
                font-weight: 600;
                min-width: 140px;
                max-width: 220px;
            }
            QComboBox:hover {
                border-color: #8b5cf6;
            }
            QComboBox::drop-down {
                border: none;
                width: 14px;
            }
            QComboBox QAbstractItemView {
                background-color: #0f1527;
                color: #ffffff;
                selection-background-color: #7c3aed;
                border: 1px solid rgba(139, 92, 246, 0.5);
                border-radius: 6px;
                padding: 4px;
            }
        """)
        self.combo_screen.currentIndexChanged.connect(self.on_viewer_screen_selected)
        tb_layout.addWidget(self.combo_screen)

        self.btn_audio = QPushButton("Audio: ON")
        self.btn_audio.setStyleSheet("""
            QPushButton {
                background-color: rgba(139, 92, 246, 0.2);
                border: 1px solid rgba(139, 92, 246, 0.4);
                color: #c4b5fd;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #8b5cf6; color: #ffffff; }
        """)
        self.btn_audio.clicked.connect(self.toggle_audio)
        tb_layout.addWidget(self.btn_audio)

        self.btn_control = QPushButton("Control: ON")
        self.btn_control.setStyleSheet("""
            QPushButton {
                background-color: rgba(99, 102, 241, 0.25);
                border: 1px solid rgba(139, 92, 246, 0.5);
                color: #a78bfa;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #6366f1; color: #ffffff; }
        """)
        self.btn_control.clicked.connect(self.toggle_control)
        tb_layout.addWidget(self.btn_control)

        self.btn_fs = QPushButton("Fullscreen")
        self.btn_fs.setStyleSheet("""
            QPushButton {
                background-color: #192138;
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #e2e8f0;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 600;
            }
            QPushButton:hover { border-color: #8b5cf6; color: #ffffff; }
        """)
        self.btn_fs.clicked.connect(self.toggle_fullscreen)
        tb_layout.addWidget(self.btn_fs)

        self.btn_collapse = QPushButton("Hide HUD")
        self.btn_collapse.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: 1px solid rgba(255, 255, 255, 0.08);
                color: #94a3b8;
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 10px;
            }
            QPushButton:hover { color: #ffffff; border-color: rgba(255, 255, 255, 0.2); }
        """)
        self.btn_collapse.clicked.connect(self.toggle_bar_collapse)
        tb_layout.addWidget(self.btn_collapse)

        btn_disc = QPushButton("Exit Stream")
        btn_disc.setStyleSheet("""
            QPushButton {
                background-color: rgba(239, 68, 68, 0.18);
                border: 1px solid rgba(239, 68, 68, 0.4);
                color: #fca5a5;
                border-radius: 6px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #ef4444; color: #ffffff; }
        """)
        btn_disc.clicked.connect(self.user_exit)
        tb_layout.addWidget(btn_disc)

        layout.addWidget(self.toolbar)

        self.uncollapse_handle = QPushButton("Show HUD")
        self.uncollapse_handle.setStyleSheet("""
            QPushButton {
                background-color: rgba(11, 14, 23, 0.9);
                border: 1px solid rgba(139, 92, 246, 0.4);
                border-top: none;
                color: #c4b5fd;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.5px;
                padding: 3px 16px;
                border-bottom-left-radius: 10px;
                border-bottom-right-radius: 10px;
            }
            QPushButton:hover { background-color: #6366f1; color: #ffffff; }
        """)
        self.uncollapse_handle.clicked.connect(self.toggle_bar_collapse)
        self.uncollapse_handle.hide()
        layout.addWidget(self.uncollapse_handle, alignment=Qt.AlignmentFlag.AlignHCenter)

        self.canvas = ScreenCanvas(self)
        layout.addWidget(self.canvas, stretch=1)

        self.setCentralWidget(container)

    def toggle_bar_collapse(self, *args):
        self.toolbar_collapsed = not self.toolbar_collapsed
        if self.toolbar_collapsed:
            self.toolbar.hide()
            self.uncollapse_handle.show()
        else:
            self.toolbar.show()
            self.uncollapse_handle.hide()

    def on_new_frame(self, jpeg_bytes: bytes, latency_ms: float):
        self.frame_count += 1
        self.current_rtt = latency_ms
        pix = QPixmap()
        if pix.loadFromData(jpeg_bytes, 'JPEG'):
            self.current_pixmap = pix
            self.canvas.update()

    def on_rtt_updated(self, rtt: float):
        self.current_rtt = rtt

    def update_hud_stats(self):
        now = time.time()
        dt = now - self.last_fps_time
        if dt > 0.3:
            self.fps = max(1, int(self.frame_count / dt))
            self.frame_count = 0
            self.last_fps_time = now
        w = self.current_pixmap.width() if self.current_pixmap else 1920
        h = self.current_pixmap.height() if self.current_pixmap else 1080
        self.lbl_stats.setText(f"{int(self.current_rtt)} ms | {self.fps} FPS | {w}x{h}")

    def update_screens_list(self, screens: list, active_screen: int = 0):
        self.combo_screen.blockSignals(True)
        self.combo_screen.clear()
        if screens:
            for sc in screens:
                self.combo_screen.addItem(sc.get("name", "Screen"), sc.get("id", 0))
            matched = False
            for i in range(self.combo_screen.count()):
                if self.combo_screen.itemData(i) == active_screen:
                    self.combo_screen.setCurrentIndex(i)
                    matched = True
                    break
            if not matched and self.combo_screen.count() > 0:
                self.combo_screen.setCurrentIndex(0)
        else:
            self.combo_screen.addItem("Primary Screen", 0)
        self.combo_screen.blockSignals(False)

    def on_viewer_screen_selected(self, index):
        if self.combo_screen.signalsBlocked():
            return
        selected_id = self.combo_screen.currentData()
        if selected_id is not None and self.client and self.client.connected:
            self.client.send_set_screen(selected_id)

    def on_host_screen_changed(self, active_screen: int, screens: list):
        if screens:
            self.update_screens_list(screens, active_screen)
        else:
            self.combo_screen.blockSignals(True)
            for i in range(self.combo_screen.count()):
                if self.combo_screen.itemData(i) == active_screen:
                    self.combo_screen.setCurrentIndex(i)
                    break
            self.combo_screen.blockSignals(False)

    def user_exit(self, *args):
        self.user_initiated_close = True
        self.close()

    def on_remote_disconnect(self):
        if not self.user_initiated_close and not self._has_shown_disconnect:
            self._has_shown_disconnect = True
            QMessageBox.information(self, "Session Ended", "The remote screen sharing session has ended.")
        self.close()

    def toggle_audio(self, *args):
        self.audio_enabled = not self.audio_enabled
        self.client.set_audio_muted(not self.audio_enabled)
        if self.audio_enabled:
            self.btn_audio.setText("Audio: ON")
            self.btn_audio.setStyleSheet("background-color: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.4); color: #c4b5fd; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: bold;")
        else:
            self.btn_audio.setText("Audio: MUTED")
            self.btn_audio.setStyleSheet("background-color: #192138; border: 1px solid rgba(255, 255, 255, 0.1); color: #64748b; border-radius: 6px; padding: 3px 10px; font-size: 11px;")

    def toggle_control(self, *args):
        self.remote_control_enabled = not self.remote_control_enabled
        if self.remote_control_enabled:
            self.btn_control.setText("Control: ON")
            self.btn_control.setStyleSheet("background-color: rgba(99, 102, 241, 0.25); border: 1px solid rgba(139, 92, 246, 0.5); color: #a78bfa; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: bold;")
        else:
            self.btn_control.setText("Control: OFF")
            self.btn_control.setStyleSheet("background-color: #192138; border: 1px solid rgba(255, 255, 255, 0.1); color: #64748b; border-radius: 6px; padding: 3px 10px; font-size: 11px;")
        self.client.permissions["control"] = self.remote_control_enabled

    def toggle_fullscreen(self, *args):
        if self.isFullScreen():
            self.showNormal()
            self.btn_fs.setText("Fullscreen")
        else:
            self.showFullScreen()
            self.btn_fs.setText("Exit Fullscreen")

    def on_local_clipboard_changed(self):
        if not self.client or not self.client.connected:
            return
        text = QApplication.clipboard().text()
        if text and text != self._last_copied_text:
            self._last_copied_text = text
            self.client.send_clipboard(text)

    def on_clipboard_sync(self, text: str):
        if text and text != self._last_copied_text:
            self._last_copied_text = text
            cb = QApplication.clipboard()
            cb.blockSignals(True)
            cb.setText(text)
            cb.blockSignals(False)

    def closeEvent(self, event):
        self.user_initiated_close = True
        self.client.disconnect()
        event.accept()


class ScreenCanvas(QWidget):
    def __init__(self, viewer: ScreenViewerWindow):
        super().__init__()
        self.viewer = viewer
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#080b14"))
        
        pix = self.viewer.current_pixmap
        if pix and not pix.isNull():
            scaled = pix.scaled(
                self.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            x = (self.width() - scaled.width()) // 2
            y = (self.height() - scaled.height()) // 2
            self.viewer.video_rect = (x, y, scaled.width(), scaled.height())
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
            painter.drawPixmap(x, y, scaled)
        else:
            painter.setPen(QColor("#64748b"))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "Waiting for video stream from host...")

    def _get_norm_coords(self, pos):
        if not self.viewer.video_rect:
            return None
        vx, vy, vw, vh = self.viewer.video_rect
        if vw <= 0 or vh <= 0:
            return None
        x = pos.x() - vx
        y = pos.y() - vy
        if -4 <= x <= vw + 4 and -4 <= y <= vh + 4:
            return (max(0.0, min(1.0, x / vw)), max(0.0, min(1.0, y / vh)))
        return None

    def mouseMoveEvent(self, event):
        coords = self._get_norm_coords(event.position())
        if coords:
            self.viewer.client.send_mouse_move(coords[0], coords[1])

    def mousePressEvent(self, event):
        self.setFocus()
        coords = self._get_norm_coords(event.position())
        btn = 'left' if event.button() == Qt.MouseButton.LeftButton else ('right' if event.button() == Qt.MouseButton.RightButton else 'middle')
        nx, ny = coords if coords else (None, None)
        self.viewer.client.send_mouse_click(btn, 'down', nx, ny)

    def mouseReleaseEvent(self, event):
        coords = self._get_norm_coords(event.position())
        btn = 'left' if event.button() == Qt.MouseButton.LeftButton else ('right' if event.button() == Qt.MouseButton.RightButton else 'middle')
        nx, ny = coords if coords else (None, None)
        self.viewer.client.send_mouse_click(btn, 'up', nx, ny)

    def mouseDoubleClickEvent(self, event):
        coords = self._get_norm_coords(event.position())
        btn = 'left' if event.button() == Qt.MouseButton.LeftButton else 'right'
        nx, ny = coords if coords else (None, None)
        self.viewer.client.send_mouse_click(btn, 'dblclick', nx, ny)

    def wheelEvent(self, event):
        steps = event.angleDelta().y() // 120
        if steps != 0:
            self.viewer.client.send_scroll(steps)

    def keyPressEvent(self, event):
        key = self._map_qt_key(event.key(), event.text())
        if key:
            self.viewer.client.send_key(key, 'down')

    def keyReleaseEvent(self, event):
        key = self._map_qt_key(event.key(), event.text())
        if key:
            self.viewer.client.send_key(key, 'up')

    def _map_qt_key(self, k, text=""):
        map_tbl = {
            Qt.Key.Key_Return: "Return",
            Qt.Key.Key_Enter: "Return",
            Qt.Key.Key_Backtab: "BackSpace",
            Qt.Key.Key_Backspace: "BackSpace",
            Qt.Key.Key_Tab: "Tab",
            Qt.Key.Key_Escape: "Escape",
            Qt.Key.Key_Delete: "Delete",
            Qt.Key.Key_Up: "Up",
            Qt.Key.Key_Down: "Down",
            Qt.Key.Key_Left: "Left",
            Qt.Key.Key_Right: "Right",
            Qt.Key.Key_Shift: "Shift_L",
            Qt.Key.Key_Control: "Control_L",
            Qt.Key.Key_Alt: "Alt_L",
            Qt.Key.Key_Meta: "Super_L",
            Qt.Key.Key_Super_L: "Super_L",
            Qt.Key.Key_Super_R: "Super_R",
            Qt.Key.Key_Space: "space",
        }
        if k in map_tbl:
            return map_tbl[k]
        if text and ord(text[0]) >= 32:
            return text
        if 32 <= k <= 126:
            return chr(k).lower()
        return None


# ========================================================
# Dedicated Background Screen Capture Worker (Zero-Lag)
# ========================================================
class ScreenCaptureWorker(threading.Thread):
    def __init__(self, main_window):
        super().__init__(daemon=True)
        self.win = main_window
        self.running = False

    def run(self):
        self.running = True
        while self.running:
            t0 = time.time()
            if not self.win.is_sharing or not self.win.server:
                time.sleep(0.04)
                continue

            # Only do capture work if at least one client is actively connected
            if not self.win.server.has_active_clients():
                time.sleep(0.05)
                continue

            target_interval = 0.025
            try:
                screen_idx = self.win.selected_screen_idx
                screens = QGuiApplication.screens()
                
                # Capture All Connected Displays (Virtual Desktop Canvas)
                if screen_idx == -1:
                    if len(screens) > 1:
                        vgeom = QGuiApplication.primaryScreen().virtualGeometry()
                        combined = QPixmap(vgeom.width(), vgeom.height())
                        combined.fill(Qt.GlobalColor.black)
                        painter = QPainter(combined)
                        for s in screens:
                            sgeo = s.geometry()
                            spix = s.grabWindow(0, 0, 0, sgeo.width(), sgeo.height())
                            painter.drawPixmap(sgeo.x() - vgeom.x(), sgeo.y() - vgeom.y(), spix)
                        painter.end()
                        pix = combined
                    else:
                        pgeo = QGuiApplication.primaryScreen().geometry()
                        pix = QGuiApplication.primaryScreen().grabWindow(0, 0, 0, pgeo.width(), pgeo.height())
                elif 0 <= screen_idx < len(screens):
                    sgeo = screens[screen_idx].geometry()
                    pix = screens[screen_idx].grabWindow(0, 0, 0, sgeo.width(), sgeo.height())
                else:
                    pgeo = QGuiApplication.primaryScreen().geometry()
                    pix = QGuiApplication.primaryScreen().grabWindow(0, 0, 0, pgeo.width(), pgeo.height())

                if pix and not pix.isNull():
                    # Draw system mouse cursor directly onto frame for stream viewers
                    try:
                        cursor_pos = QCursor.pos()
                        if screen_idx == -1:
                            vgeom = QGuiApplication.primaryScreen().virtualGeometry()
                            cur_x = cursor_pos.x() - vgeom.x()
                            cur_y = cursor_pos.y() - vgeom.y()
                        elif 0 <= screen_idx < len(screens):
                            sgeo = screens[screen_idx].geometry()
                            cur_x = cursor_pos.x() - sgeo.x()
                            cur_y = cursor_pos.y() - sgeo.y()
                        else:
                            sgeo = QGuiApplication.primaryScreen().geometry()
                            cur_x = cursor_pos.x() - sgeo.x()
                            cur_y = cursor_pos.y() - sgeo.y()

                        if 0 <= cur_x < pix.width() and 0 <= cur_y < pix.height():
                            cpainter = QPainter(pix)
                            cpainter.setRenderHint(QPainter.RenderHint.Antialiasing)
                            arrow = QPolygon([
                                QPoint(cur_x, cur_y),
                                QPoint(cur_x, cur_y + 19),
                                QPoint(cur_x + 5, cur_y + 14),
                                QPoint(cur_x + 9, cur_y + 23),
                                QPoint(cur_x + 12, cur_y + 21),
                                QPoint(cur_x + 8, cur_y + 13),
                                QPoint(cur_x + 14, cur_y + 13),
                            ])
                            cpainter.setBrush(QBrush(QColor(255, 255, 255)))
                            cpainter.setPen(QPen(QColor(0, 0, 0), 1.5, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
                            cpainter.drawPolygon(arrow)
                            cpainter.end()
                    except Exception:
                        pass

                    q_idx = self.win.selected_quality_idx
                    if q_idx == 0:    # Native Display Resolution (Ultra-Crisp 100% • Original Clarity)
                        if pix.width() > 1920:
                            pix = pix.scaledToWidth(1920, Qt.TransformationMode.SmoothTransformation)
                        quality = 82
                        target_interval = 0.025
                    elif q_idx == 1:  # 1080p Full HD (Crisp • Smooth 60 FPS)
                        if pix.width() > 1920:
                            pix = pix.scaledToWidth(1920, Qt.TransformationMode.SmoothTransformation)
                        quality = 76
                        target_interval = 0.025
                    else:             # 720p HD (Balanced • Low Bandwidth)
                        if pix.width() > 1280:
                            pix = pix.scaledToWidth(1280, Qt.TransformationMode.SmoothTransformation)
                        quality = 65
                        target_interval = 0.025

                    buf = QBuffer()
                    buf.open(QIODevice.OpenModeFlag.WriteOnly)
                    pix.save(buf, 'JPEG', quality)
                    jpeg_bytes = bytes(buf.data())
                    self.win.server.broadcast_frame(jpeg_bytes)
            except Exception:
                pass

            elapsed = time.time() - t0
            sleep_time = max(0.002, target_interval - elapsed)
            time.sleep(sleep_time)

    def stop(self):
        self.running = False


# ========================================================
# Main Window: LanCast Pro Dashboard
# ========================================================
class LanCastMainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("DogRemote Local - Ultra-Fast P2P LAN Screen Share & Remote Desktop")
        self.setWindowIcon(QIcon(APP_ICON))
        self.resize(1040, 710)
        self.setMinimumSize(920, 620)
        self.setStyleSheet(DARK_THEME)

        self.bridge = SignalBridge()
        self.my_ip = get_local_ip()
        self.my_name = socket.gethostname()
        self.default_password = generate_random_password(6)
        print(f"[DogRemote] Current Session PIN: {self.default_password}")
        self._last_copied_text = ""

        self.is_sharing = False
        self.selected_screen_idx = 0
        self.selected_quality_idx = 0

        self.server = None
        self.discovery = None
        self.active_viewer_window = None
        self.capture_worker = None

        self.init_ui()
        self.setup_backend()

        app_clip = QApplication.clipboard()
        app_clip.dataChanged.connect(self.on_host_clipboard_changed)

    def init_ui(self):
        central = QWidget()
        root_layout = QVBoxLayout(central)
        root_layout.setContentsMargins(32, 26, 32, 28)
        root_layout.setSpacing(24)

        # --- TOP HEADER ---
        header = QHBoxLayout()
        header.setSpacing(14)

        brand_box = QHBoxLayout()
        brand_box.setSpacing(10)
        
        lbl_brand = QLabel("🐕 DogRemote")
        lbl_brand.setStyleSheet("font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;")
        brand_box.addWidget(lbl_brand)

        lbl_pro = QLabel("LOCAL")
        lbl_pro.setProperty("class", "brand-badge")
        brand_box.addWidget(lbl_pro)
        header.addLayout(brand_box)

        lbl_status = QLabel("LAN MESH ACTIVE")
        lbl_status.setProperty("class", "status-online")
        header.addWidget(lbl_status)

        header.addStretch()

        self.lbl_ip = QLabel(f"LAN IP: {self.my_ip}:5858")
        self.lbl_ip.setProperty("class", "ip-pill")
        header.addWidget(self.lbl_ip)

        btn_test_self = QPushButton("Quick Preview")
        btn_test_self.setProperty("class", "btn-secondary")
        btn_test_self.setToolTip("Open a local screen share viewer window immediately to preview streaming")
        btn_test_self.clicked.connect(self.test_local_view)
        header.addWidget(btn_test_self)

        root_layout.addLayout(header)

        # --- 2-COLUMN MAIN DASHBOARD ---
        grid_layout = QHBoxLayout()
        grid_layout.setSpacing(24)

        # ========================================================
        # LEFT CARD: Broadcast This Screen (Host)
        # ========================================================
        card_host = QFrame()
        card_host.setProperty("class", "dashboard-card")
        host_layout = QVBoxLayout(card_host)
        host_layout.setSpacing(15)

        # Header
        host_head = QVBoxLayout()
        host_head.setSpacing(4)
        lbl_this_desk = QLabel("Host Display")
        lbl_this_desk.setProperty("class", "card-title")
        host_head.addWidget(lbl_this_desk)

        lbl_desc = QLabel("Broadcast high-speed screen stream to any device on this network")
        lbl_desc.setProperty("class", "card-subtitle")
        host_head.addWidget(lbl_desc)
        host_layout.addLayout(host_head)

        # Machine Identifier Card
        info_card = QFrame()
        info_card.setProperty("class", "info-container")
        info_layout = QHBoxLayout(info_card)
        info_layout.setContentsMargins(12, 8, 12, 8)
        
        info_v = QVBoxLayout()
        info_v.setSpacing(2)
        lbl_dev_title = QLabel("LOCAL MACHINE IDENTIFIER")
        lbl_dev_title.setProperty("class", "info-label")
        info_v.addWidget(lbl_dev_title)

        self.lbl_host_ident = QLabel(f"{self.my_name} ({self.my_ip})")
        self.lbl_host_ident.setProperty("class", "info-value")
        info_v.addWidget(self.lbl_host_ident)
        info_layout.addLayout(info_v, stretch=1)

        self.btn_copy_ip = QPushButton("Copy IP")
        self.btn_copy_ip.setProperty("class", "btn-secondary")
        self.btn_copy_ip.clicked.connect(self.copy_local_ip)
        info_layout.addWidget(self.btn_copy_ip)
        host_layout.addWidget(info_card)

        # Display Selector
        screen_select_layout = QVBoxLayout()
        screen_select_layout.setSpacing(5)
        lbl_disp_title = QLabel("ACTIVE DISPLAY")
        lbl_disp_title.setProperty("class", "section-tag")
        screen_select_layout.addWidget(lbl_disp_title)

        self.combo_screen = QComboBox()
        self.screens = QGuiApplication.screens()
        primary_screen = QGuiApplication.primaryScreen()
        primary_idx = 0
        for i, s in enumerate(self.screens):
            if s == primary_screen:
                primary_idx = i
                break

        for i, s in enumerate(self.screens):
            geo = s.geometry()
            is_primary = "  (Primary)" if s == primary_screen else ""
            self.combo_screen.addItem(f"Display {i+1}: {s.name()} ({geo.width()}x{geo.height()}){is_primary}", i)

        if len(self.screens) > 1:
            self.combo_screen.addItem(f"All Displays ({len(self.screens)} Screens Combined)", -1)

        for c in range(self.combo_screen.count()):
            if self.combo_screen.itemData(c) == primary_idx:
                self.combo_screen.setCurrentIndex(c)
                break

        self.combo_screen.currentIndexChanged.connect(self.on_screen_selected)
        screen_select_layout.addWidget(self.combo_screen)
        host_layout.addLayout(screen_select_layout)

        # Quality Preset Selector (Default: Native Ultra Crisp 100% @ 60 FPS)
        quality_layout = QVBoxLayout()
        quality_layout.setSpacing(5)
        lbl_q_title = QLabel("STREAM QUALITY PRESET")
        lbl_q_title.setProperty("class", "section-tag")
        quality_layout.addWidget(lbl_q_title)

        self.combo_quality = QComboBox()
        self.combo_quality.addItems([
            "Native Display Resolution (Ultra Crisp 100% • Original Clarity)",
            "1080p Full HD (Crisp • Smooth 60 FPS)",
            "720p HD (Balanced • Low Bandwidth)"
        ])
        self.combo_quality.currentIndexChanged.connect(self.on_quality_selected)
        quality_layout.addWidget(self.combo_quality)
        host_layout.addLayout(quality_layout)

        # Security & Password Settings (Default: Random auto-generated password)
        sec_layout = QVBoxLayout()
        sec_layout.setSpacing(8)
        lbl_sec_title = QLabel("SECURITY & ACCESS CONTROL")
        lbl_sec_title.setProperty("class", "section-tag")
        sec_layout.addWidget(lbl_sec_title)

        # Password Protection Row
        pwd_box = QHBoxLayout()
        pwd_box.setSpacing(8)
        self.chk_require_pwd = QCheckBox("Require Security Password:")
        self.chk_require_pwd.setChecked(True)
        self.chk_require_pwd.toggled.connect(self.on_password_toggle)
        pwd_box.addWidget(self.chk_require_pwd)

        self.txt_host_pwd = QLineEdit(self.default_password)
        self.txt_host_pwd.setMaxLength(6)
        self.txt_host_pwd.setEchoMode(QLineEdit.EchoMode.Normal)
        self.txt_host_pwd.setFixedWidth(125)
        self.txt_host_pwd.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.txt_host_pwd.setStyleSheet("font-family: monospace; font-size: 14px; font-weight: bold; padding: 6px 4px; letter-spacing: 2px;")
        self.txt_host_pwd.textChanged.connect(self.on_password_changed)
        pwd_box.addWidget(self.txt_host_pwd)

        self.btn_toggle_mask = QPushButton("Hide")
        self.btn_toggle_mask.setProperty("class", "btn-secondary")
        self.btn_toggle_mask.setStyleSheet("padding: 7px 10px; font-size: 11px;")
        self.btn_toggle_mask.clicked.connect(self.toggle_password_mask)
        pwd_box.addWidget(self.btn_toggle_mask)

        self.btn_new_pwd = QPushButton("New")
        self.btn_new_pwd.setProperty("class", "btn-secondary")
        self.btn_new_pwd.setStyleSheet("padding: 7px 10px; font-size: 11px;")
        self.btn_new_pwd.setToolTip("Generate a new random access password")
        self.btn_new_pwd.clicked.connect(self.generate_new_password)
        pwd_box.addWidget(self.btn_new_pwd)

        self.btn_copy_pwd = QPushButton("Copy")
        self.btn_copy_pwd.setProperty("class", "btn-secondary")
        self.btn_copy_pwd.setStyleSheet("padding: 7px 10px; font-size: 11px;")
        self.btn_copy_pwd.clicked.connect(self.copy_password)
        pwd_box.addWidget(self.btn_copy_pwd)

        sec_layout.addLayout(pwd_box)

        # Permissions Checklist
        self.chk_allow_control = QCheckBox("Grant remote mouse && keyboard control")
        self.chk_allow_control.setChecked(True)
        sec_layout.addWidget(self.chk_allow_control)

        self.chk_stream_audio = QCheckBox("Stream host system audio over LAN")
        self.chk_stream_audio.setChecked(True)
        self.chk_stream_audio.toggled.connect(self.on_audio_toggled)
        sec_layout.addWidget(self.chk_stream_audio)

        host_layout.addLayout(sec_layout)
        host_layout.addSpacing(2)

        # Primary Start / Stop Share CTA
        self.btn_share = QPushButton("Start Sharing Screen")
        self.btn_share.setProperty("class", "btn-cta")
        self.btn_share.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        self.btn_share.clicked.connect(self.toggle_sharing)
        host_layout.addWidget(self.btn_share)

        self.lbl_viewers = QLabel("0 Viewers Connected")
        self.lbl_viewers.setStyleSheet("font-size: 11px; font-weight: 600; color: #64748b; padding-left: 2px;")
        host_layout.addWidget(self.lbl_viewers)

        host_layout.addStretch()
        grid_layout.addWidget(card_host, stretch=1)

        # ========================================================
        # RIGHT CARD: Connect & View Remote Screen (Client)
        # ========================================================
        card_client = QFrame()
        card_client.setProperty("class", "dashboard-card")
        client_layout = QVBoxLayout(card_client)
        client_layout.setSpacing(15)

        # Header
        client_head = QVBoxLayout()
        client_head.setSpacing(4)
        lbl_remote = QLabel("Remote Connection")
        lbl_remote.setProperty("class", "card-title")
        client_head.addWidget(lbl_remote)

        lbl_rdesc = QLabel("Connect directly via IP/Port, or select a detected device below")
        lbl_rdesc.setProperty("class", "card-subtitle")
        client_head.addWidget(lbl_rdesc)
        client_layout.addLayout(client_head)

        # Connect Inputs
        target_box = QVBoxLayout()
        target_box.setSpacing(8)
        lbl_remote_code = QLabel("REMOTE HOST ADDRESS")
        lbl_remote_code.setProperty("class", "section-tag")
        target_box.addWidget(lbl_remote_code)

        connect_box = QHBoxLayout()
        connect_box.setSpacing(8)
        self.txt_remote_ip = QLineEdit()
        self.txt_remote_ip.setPlaceholderText("IP (e.g. 192.168.8.194)")
        self.txt_remote_ip.returnPressed.connect(self.connect_to_target)
        connect_box.addWidget(self.txt_remote_ip, stretch=2)

        self.txt_remote_port = QLineEdit("5858")
        self.txt_remote_port.setPlaceholderText("Port")
        self.txt_remote_port.setMaximumWidth(75)
        self.txt_remote_port.returnPressed.connect(self.connect_to_target)
        connect_box.addWidget(self.txt_remote_port)

        self.btn_conn = QPushButton("Connect")
        self.btn_conn.setProperty("class", "btn-cta")
        self.btn_conn.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        self.btn_conn.clicked.connect(self.connect_to_target)
        connect_box.addWidget(self.btn_conn)
        target_box.addLayout(connect_box)

        # Host Password Field
        pwd_client_box = QHBoxLayout()
        pwd_client_box.setSpacing(8)
        self.txt_client_pwd = QLineEdit()
        self.txt_client_pwd.setMaxLength(6)
        self.txt_client_pwd.setPlaceholderText("6-digit Host Password (if required)")
        self.txt_client_pwd.setEchoMode(QLineEdit.EchoMode.Password)
        self.txt_client_pwd.returnPressed.connect(self.connect_to_target)
        pwd_client_box.addWidget(self.txt_client_pwd, stretch=1)

        btn_show_cli_pwd = QPushButton("Show")
        btn_show_cli_pwd.setProperty("class", "btn-secondary")
        btn_show_cli_pwd.clicked.connect(lambda checked=False: (
            self.txt_client_pwd.setEchoMode(QLineEdit.EchoMode.Normal if self.txt_client_pwd.echoMode() == QLineEdit.EchoMode.Password else QLineEdit.EchoMode.Password),
            btn_show_cli_pwd.setText("Hide" if self.txt_client_pwd.echoMode() == QLineEdit.EchoMode.Normal else "Show")
        ))
        pwd_client_box.addWidget(btn_show_cli_pwd)
        target_box.addLayout(pwd_client_box)

        client_layout.addLayout(target_box)

        # Discovered on LAN Section
        disc_head = QHBoxLayout()
        lbl_discovered_title = QLabel("DISCOVERED ON LOCAL NETWORK")
        lbl_discovered_title.setProperty("class", "section-tag")
        disc_head.addWidget(lbl_discovered_title)
        
        disc_head.addStretch()
        self.btn_rescan = QPushButton("Refresh Scan")
        self.btn_rescan.setProperty("class", "btn-secondary")
        self.btn_rescan.setToolTip("Scan local network subnet on-demand for active DogRemote hosts")
        self.btn_rescan.clicked.connect(self.trigger_subnet_scan)
        disc_head.addWidget(self.btn_rescan)
        client_layout.addLayout(disc_head)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setMinimumHeight(160)
        scroll.setStyleSheet("""
            QScrollArea {
                background-color: #0d1222;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
            }
        """)
        self.discovered_container = QWidget()
        self.discovered_container.setStyleSheet("background: transparent;")
        self.discovered_layout = QVBoxLayout(self.discovered_container)
        self.discovered_layout.setContentsMargins(12, 12, 12, 12)
        self.discovered_layout.setSpacing(10)
        
        self.empty_state_frame = QFrame()
        self.empty_state_frame.setStyleSheet("background: rgba(255, 255, 255, 0.02); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px;")
        empty_layout = QVBoxLayout(self.empty_state_frame)
        empty_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_layout.setContentsMargins(16, 24, 16, 24)
        empty_layout.setSpacing(8)

        self.lbl_empty_devices = QLabel("Click 'Refresh Scan' to search your local network for active DogRemote hosts.")
        self.lbl_empty_devices.setStyleSheet("color: #94a3b8; font-size: 13px; font-weight: 500;")
        self.lbl_empty_devices.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_empty_devices.setWordWrap(True)
        empty_layout.addWidget(self.lbl_empty_devices)

        self.discovered_layout.addWidget(self.empty_state_frame)
        self.discovered_layout.addStretch()

        scroll.setWidget(self.discovered_container)
        client_layout.addWidget(scroll, stretch=1)

        grid_layout.addWidget(card_client, stretch=1)
        root_layout.addLayout(grid_layout, stretch=1)

        self.setCentralWidget(central)

    def setup_backend(self):
        initial_data = self.combo_screen.currentData()
        self.selected_screen_idx = initial_data if initial_data is not None else 0
        if self.selected_screen_idx == -1:
            total_rect = QGuiApplication.primaryScreen().virtualGeometry()
            rect = (total_rect.x(), total_rect.y(), total_rect.width(), total_rect.height())
        else:
            s_idx = self.selected_screen_idx if (self.selected_screen_idx is not None and 0 <= self.selected_screen_idx < len(self.screens)) else 0
            if s_idx < len(self.screens):
                geo = self.screens[s_idx].geometry()
                rect = (geo.x(), geo.y(), geo.width(), geo.height())
            else:
                rect = (0, 0, 1920, 1080)

        # 1. Start Server with default password active
        self.server = LanCastServer(host='0.0.0.0', port=5858, screen_rect=rect)
        self.server.access_password = self.default_password
        self.server.audio_enabled = self.chk_stream_audio.isChecked()
        self.server.on_incoming_request = lambda s, d: self.bridge.incoming_request.emit(s, d)
        self.server.on_client_joined = lambda s: self.bridge.client_joined.emit(s)
        self.server.on_client_left = lambda s: self.bridge.client_left.emit(s)
        self.server.on_clipboard_received = lambda txt: self.bridge.clipboard_received.emit(txt)
        self.server.on_screen_switch_requested = lambda sid: self.bridge.screen_switch_requested.emit(sid)
        self.server.on_quality_switch_requested = self.on_quality_selected
        self.server.on_peer_detected = lambda ip, name, port, sharing=True: (self.discovery._register_device(ip=ip, name=name, port=port) if sharing else self.discovery._remove_device(ip)) if self.discovery else None
        self.server.on_sharing_changed = lambda val: self.bridge.sharing_toggled.emit(val)
        self.update_available_screens()
        self.server.start()
        
        self.lbl_ip.setText(f"LAN IP: {self.my_ip}:{self.server.port}")
        self.lbl_host_ident.setText(f"{self.my_name} ({self.my_ip}:{self.server.port})")

        # 2. Start Background Screen Capture Worker (Zero-lag thread)
        self.capture_worker = ScreenCaptureWorker(self)
        self.capture_worker.start()

        # 3. Start UDP Discovery Beacon (Pauses when stream is active)
        self.discovery = LanDiscovery(
            device_name=self.my_name,
            local_ip=self.my_ip,
            tcp_port=self.server.port,
            on_device_found=lambda dev, is_new: self.bridge.device_discovered.emit(dev, is_new),
            on_device_lost=lambda dev_id: self.bridge.device_lost.emit(dev_id),
            is_sharing_fn=lambda: self.is_sharing,
            is_active_session_fn=lambda: bool(self.active_viewer_window or (self.server and self.server.has_active_clients()))
        )
        self.discovery.start()

        # Connect signals
        self.bridge.device_discovered.connect(self.on_device_discovered)
        self.bridge.device_lost.connect(self.on_device_lost)
        self.bridge.scan_finished.connect(self.on_scan_finished)
        self.bridge.incoming_request.connect(self.on_incoming_request)
        self.bridge.client_joined.connect(self.on_client_joined)
        self.bridge.client_left.connect(self.on_client_left)
        self.bridge.screen_switch_requested.connect(self.on_remote_requested_screen_switch)
        self.bridge.connected.connect(self.open_viewer_window)
        self.bridge.rejected.connect(self.on_connection_rejected)
        self.bridge.clipboard_received.connect(self.on_clipboard_from_viewer)
        self.bridge.sharing_toggled.connect(self.on_external_sharing_toggled)

    def on_external_sharing_toggled(self, enable: bool):
        if enable and not self.is_sharing:
            self.start_sharing()
        elif not enable and self.is_sharing:
            self.stop_sharing()

    def on_password_toggle(self, checked):
        self.txt_host_pwd.setEnabled(checked)
        self.btn_toggle_mask.setEnabled(checked)
        self.btn_new_pwd.setEnabled(checked)
        self.btn_copy_pwd.setEnabled(checked)
        if checked:
            self.server.access_password = self.txt_host_pwd.text().strip()
        else:
            self.server.access_password = ""

    def on_password_changed(self, text):
        if self.chk_require_pwd.isChecked():
            self.server.access_password = text.strip()

    def toggle_password_mask(self, *args):
        if self.txt_host_pwd.echoMode() == QLineEdit.EchoMode.Password:
            self.txt_host_pwd.setEchoMode(QLineEdit.EchoMode.Normal)
            self.btn_toggle_mask.setText("Hide")
        else:
            self.txt_host_pwd.setEchoMode(QLineEdit.EchoMode.Password)
            self.btn_toggle_mask.setText("Show")

    def generate_new_password(self, *args):
        new_pwd = generate_random_password(6)
        self.txt_host_pwd.setText(new_pwd)
        self.server.access_password = new_pwd
        self.btn_new_pwd.setText("Done!")
        QTimer.singleShot(1000, lambda: self.btn_new_pwd.setText("New"))

    def copy_password(self, *args):
        cb = QApplication.clipboard()
        cb.setText(self.txt_host_pwd.text().strip())
        self.btn_copy_pwd.setText("Copied!")
        QTimer.singleShot(1500, lambda: self.btn_copy_pwd.setText("Copy"))

    def on_audio_toggled(self, checked):
        if self.server:
            self.server.audio_enabled = checked
            if self.is_sharing and checked:
                self.server.start_audio()
            elif not checked:
                self.server.stop_audio()

    def on_host_clipboard_changed(self):
        if not self.server or not self.server.clients:
            return
        text = QApplication.clipboard().text()
        if text and text != self._last_copied_text:
            self._last_copied_text = text
            self.server.broadcast_clipboard(text)

    def on_clipboard_from_viewer(self, text: str):
        if text and text != self._last_copied_text:
            self._last_copied_text = text
            cb = QApplication.clipboard()
            cb.blockSignals(True)
            cb.setText(text)
            cb.blockSignals(False)

    def copy_local_ip(self, *args):
        cb = QApplication.clipboard()
        cb.setText(self.my_ip)
        self.btn_copy_ip.setText("Copied!")
        self.btn_copy_ip.setStyleSheet("background-color: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #34d399;")
        QTimer.singleShot(1800, lambda: (
            self.btn_copy_ip.setText("Copy IP"),
            self.btn_copy_ip.setStyleSheet("")
        ))

    def update_available_screens(self):
        self.screens = QGuiApplication.screens()
        screens_info = []
        for i, s in enumerate(self.screens):
            geo = s.geometry()
            is_prim = " (Primary)" if s == QGuiApplication.primaryScreen() else ""
            screens_info.append({"id": i, "name": f"Display {i+1}: {s.name()} ({geo.width()}x{geo.height()}){is_prim}"})
        if len(self.screens) > 1:
            screens_info.append({"id": -1, "name": f"All Displays ({len(self.screens)} Screens Combined)"})
        if self.server:
            self.server.set_available_screens(screens_info, active_id=self.selected_screen_idx)
        return screens_info

    def on_remote_requested_screen_switch(self, screen_id: int):
        for i in range(self.combo_screen.count()):
            if self.combo_screen.itemData(i) == screen_id:
                self.combo_screen.blockSignals(True)
                self.combo_screen.setCurrentIndex(i)
                self.combo_screen.blockSignals(False)
                break
        self.selected_screen_idx = screen_id
        if screen_id == -1:
            total_rect = QGuiApplication.primaryScreen().virtualGeometry()
            self.server.set_screen_rect(total_rect.x(), total_rect.y(), total_rect.width(), total_rect.height())
        else:
            s_idx = screen_id if 0 <= screen_id < len(self.screens) else 0
            if s_idx < len(self.screens):
                geo = self.screens[s_idx].geometry()
                self.server.set_screen_rect(geo.x(), geo.y(), geo.width(), geo.height())
        if self.server:
            self.server.broadcast_screen_changed(screen_id)

    def on_screen_selected(self, idx):
        self.selected_screen_idx = self.combo_screen.currentData()
        if not self.server:
            return
        if self.selected_screen_idx == -1:
            total_rect = QGuiApplication.primaryScreen().virtualGeometry()
            self.server.set_screen_rect(total_rect.x(), total_rect.y(), total_rect.width(), total_rect.height())
        else:
            s_idx = self.selected_screen_idx if self.selected_screen_idx is not None else 0
            if s_idx < len(self.screens):
                s = self.screens[s_idx]
                geo = s.geometry()
                self.server.set_screen_rect(geo.x(), geo.y(), geo.width(), geo.height())
        if self.server:
            self.server.broadcast_screen_changed(self.selected_screen_idx)

    def on_quality_selected(self, idx):
        self.selected_quality_idx = idx
        if 0 <= idx < self.combo_quality.count():
            self.combo_quality.blockSignals(True)
            self.combo_quality.setCurrentIndex(idx)
            self.combo_quality.blockSignals(False)

    def toggle_sharing(self, *args):
        if self.is_sharing:
            self.stop_sharing()
        else:
            self.start_sharing()

    def start_sharing(self):
        self.is_sharing = True
        if self.server:
            self.server.is_sharing = True
        self.btn_share.setText("Stop Sharing Screen")
        self.btn_share.setProperty("class", "btn-danger-cta")
        self.btn_share.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #dc2626, stop:1 #ef4444);
                color: #ffffff;
                font-weight: 700;
                font-size: 13px;
                border: none;
                border-radius: 10px;
                padding: 10px 18px;
            }
            QPushButton:hover { background: #dc2626; }
        """)

        if self.server.audio_enabled:
            self.server.start_audio()

    def stop_sharing(self):
        self.is_sharing = False
        if self.server:
            self.server.is_sharing = False
            self.server.stop_audio()
        self.btn_share.setText("Start Sharing Screen")
        self.btn_share.setProperty("class", "btn-cta")
        self.btn_share.setStyleSheet("")

    def on_incoming_request(self, session: ClientSession, data: dict):
        peer_name = data.get("name", session.peer_name)
        
        dlg = QDialog(self)
        dlg.setWindowTitle("Incoming Connection Request")
        dlg.setStyleSheet(DARK_THEME)
        dlg.setFixedSize(420, 240)

        v = QVBoxLayout(dlg)
        v.setContentsMargins(24, 20, 24, 20)
        v.setSpacing(14)

        t = QLabel("Incoming Session Request")
        t.setStyleSheet("font-size: 16px; font-weight: 800; color: #ffffff;")
        v.addWidget(t)

        msg = QLabel(f"<span style='color:#a78bfa; font-weight:bold;'>{peer_name}</span> ({session.addr[0]}) is requesting to connect to your screen.")
        msg.setStyleSheet("color: #cbd5e1; font-size: 13px; line-height: 1.4;")
        msg.setWordWrap(True)
        v.addWidget(msg)

        chk_ctrl = QCheckBox("Grant remote mouse and keyboard control")
        chk_ctrl.setChecked(self.chk_allow_control.isChecked())
        v.addWidget(chk_ctrl)

        btn_box = QHBoxLayout()
        btn_box.setSpacing(12)
        
        btn_decline = QPushButton("Decline")
        btn_decline.setProperty("class", "btn-secondary")
        btn_decline.setStyleSheet("background-color: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 10px 18px;")
        btn_decline.clicked.connect(lambda checked=False: (session.reject_connection("Connection declined by host"), dlg.reject()))
        btn_box.addWidget(btn_decline)

        btn_accept = QPushButton("Accept Session")
        btn_accept.setProperty("class", "btn-cta")
        btn_accept.setStyleSheet("padding: 10px 18px;")
        btn_accept.clicked.connect(lambda checked=False: (
            session.accept_connection(allow_control=chk_ctrl.isChecked()),
            self.start_sharing() if not self.is_sharing else None,
            dlg.accept()
        ))
        btn_box.addWidget(btn_accept)

        v.addLayout(btn_box)
        dlg.exec()

    def on_client_joined(self, session: ClientSession):
        tcp_cnt = len([c for c in self.server.clients if c.is_approved]) if self.server else 0
        ws_cnt = len(self.server.ws_clients) if self.server else 0
        cnt = tcp_cnt + ws_cnt
        self.lbl_viewers.setText(f"{cnt} Viewer{'s' if cnt != 1 else ''} Connected")
        self.lbl_viewers.setStyleSheet("font-size: 11px; font-weight: bold; color: #a78bfa; padding-left: 2px;")
        if not self.is_sharing:
            self.start_sharing()

    def on_client_left(self, session: ClientSession):
        tcp_cnt = len([c for c in self.server.clients if c.is_approved]) if self.server else 0
        ws_cnt = len(self.server.ws_clients) if self.server else 0
        cnt = tcp_cnt + ws_cnt
        self.lbl_viewers.setText(f"{cnt} Viewer{'s' if cnt != 1 else ''} Connected")
        if cnt == 0:
            self.lbl_viewers.setStyleSheet("font-size: 11px; font-weight: 600; color: #64748b; padding-left: 2px;")

    def on_device_discovered(self, dev: dict, is_new: bool):
        self.empty_state_frame.setVisible(False)
        target_id = f"dev_{dev['ip'].replace('.', '_')}"
        
        for i in range(self.discovered_layout.count()):
            w = self.discovered_layout.itemAt(i).widget()
            if w and w.objectName() == target_id:
                # Update label of existing card if name or port changed
                info_lbl = w.findChild(QLabel, "lbl_dev_info")
                if info_lbl and dev.get("name"):
                    info_lbl.setText(f"<span style='font-size: 13px; font-weight: bold; color: #ffffff;'>{dev['name']}</span>"
                                     f"<br><span style='color: #94a3b8; font-size: 11px; font-family: monospace;'>IP: {dev['ip']}:{dev.get('port', 5858)}</span>")
                return

        item = QFrame()
        item.setObjectName(target_id)
        item.setStyleSheet("""
            QFrame {
                background: #10162a;
                border: 1px solid rgba(139, 92, 246, 0.20);
                border-radius: 10px;
            }
            QFrame:hover {
                border-color: #8b5cf6;
                background: #141b34;
            }
        """)
        h = QHBoxLayout(item)
        h.setContentsMargins(14, 10, 14, 10)
        h.setSpacing(12)

        info = QLabel(f"<span style='font-size: 13px; font-weight: bold; color: #ffffff;'>{dev['name']}</span>"
                      f"<br><span style='color: #94a3b8; font-size: 11px; font-family: monospace;'>IP: {dev['ip']}:{dev.get('port', 5858)}</span>")
        info.setObjectName("lbl_dev_info")
        info.setStyleSheet("background: transparent; border: none;")
        info.setWordWrap(True)
        h.addWidget(info, stretch=1)

        btn_c = QPushButton("Connect")
        btn_c.setProperty("class", "btn-secondary")
        btn_c.setStyleSheet("""
            QPushButton {
                background-color: rgba(99, 102, 241, 0.2);
                border: 1px solid rgba(139, 92, 246, 0.45);
                color: #c4b5fd;
                font-weight: 700;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 11px;
            }
            QPushButton:hover {
                background-color: #6366f1;
                color: #ffffff;
            }
        """)
        btn_c.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        target_ip = dev['ip']
        target_port = dev.get('port', 5858)
        btn_c.clicked.connect(lambda checked=False, ip=target_ip, port=target_port: self.prefill_and_connect(ip, port))
        h.addWidget(btn_c)

        self.discovered_layout.insertWidget(self.discovered_layout.count() - 1, item)
        item.show()

    def on_device_lost(self, dev_id: str):
        target_id = f"dev_{dev_id.replace('.', '_')}"
        for i in range(self.discovered_layout.count()):
            w = self.discovered_layout.itemAt(i).widget()
            if w and w.objectName() == target_id:
                w.deleteLater()
                break
        QTimer.singleShot(150, self._check_empty_discovered)

    def _check_empty_discovered(self):
        count = 0
        for i in range(self.discovered_layout.count()):
            w = self.discovered_layout.itemAt(i).widget()
            if w and w != self.empty_state_frame and w.objectName().startswith("dev_"):
                count += 1
        if count == 0:
            self.empty_state_frame.setVisible(True)

    def trigger_subnet_scan(self, *args):
        if self.discovery and not self.discovery.is_scanning:
            self.btn_rescan.setText("Scanning...")
            self.btn_rescan.setEnabled(False)
            self.lbl_empty_devices.setText("Scanning local subnet for active DogRemote hosts...")
            self.discovery.scan_subnet(
                target_ports=[5858, 5859, 5860],
                on_complete=lambda: self.bridge.scan_finished.emit()
            )

    def on_scan_finished(self):
        self.btn_rescan.setText("Refresh Scan")
        self.btn_rescan.setEnabled(True)
        devices = self.discovery.get_devices() if self.discovery else []
        
        # Check if there are already device cards displayed in layout
        card_count = 0
        for i in range(self.discovered_layout.count()):
            w = self.discovered_layout.itemAt(i).widget()
            if w and w != self.empty_state_frame and w.objectName().startswith("dev_"):
                card_count += 1

        if card_count == 0 and not devices:
            self.lbl_empty_devices.setText("Scan completed. No other DogRemote hosts detected on this subnet.")
            self.empty_state_frame.setVisible(True)
        else:
            self.empty_state_frame.setVisible(False)
            for dev in devices:
                self.on_device_discovered(dev, False)

    def prefill_and_connect(self, ip: str, port: int):
        self.txt_remote_ip.setText(ip)
        self.txt_remote_port.setText(str(port))
        self.connect_to_target()

    def connect_to_target(self, *args):
        ip = self.txt_remote_ip.text().strip()
        if not ip:
            QMessageBox.warning(self, "Invalid Address", "Please enter a valid remote IP address.")
            return

        port_str = self.txt_remote_port.text().strip()
        port = int(port_str) if port_str.isdigit() else 5858
        password = self.txt_client_pwd.text().strip()

        self.connect_to_ip(ip, port, password)

    def test_local_view(self, *args):
        if not self.is_sharing:
            self.start_sharing()
        self.connect_to_ip("127.0.0.1", self.server.port, password=self.server.access_password)

    def connect_to_ip(self, ip: str, port: int = 5858, password: str = ""):
        client = LanCastClient(my_name=self.my_name)
        client.on_frame = lambda j, lat: self.bridge.frame_received.emit(j, lat)
        client.on_rejected = lambda r: self.bridge.rejected.emit(r, ip, port)
        client.on_disconnected = lambda: self.bridge.disconnected.emit()
        client.on_clipboard = lambda txt: self.bridge.clipboard_received.emit(txt)
        client.on_connected = lambda res_data: self.bridge.connected.emit({
            "client": client,
            "peer": f"{ip}:{port}",
            "perms": res_data.get("permissions", {}),
            "screens": res_data.get("screens", []),
            "active_screen": res_data.get("active_screen", 0)
        })
        client.on_screen_changed = lambda s_idx, scs: self.bridge.screen_changed.emit(s_idx, scs)
        client.on_rtt_updated = lambda rtt: self.bridge.rtt_updated.emit(rtt)

        client.connect_to(ip, port, password=password, req_control=True)

    def on_connection_rejected(self, reason: str, ip: str, port: int):
        """If password is required or incorrect, opens an elegant password prompt modal."""
        if reason in ("PASSWORD_REQUIRED", "PASSWORD_INCORRECT", "Incorrect or missing security password"):
            dlg = QDialog(self)
            dlg.setWindowTitle("Authentication Required")
            dlg.setStyleSheet(DARK_THEME)
            dlg.setFixedSize(380, 200)

            v = QVBoxLayout(dlg)
            v.setContentsMargins(22, 18, 22, 18)
            v.setSpacing(12)

            t = QLabel("Host Password Required")
            t.setStyleSheet("font-size: 15px; font-weight: 800; color: #ffffff;")
            v.addWidget(t)

            is_incorrect = ("INCORRECT" in reason or "Incorrect" in reason)
            prompt_msg = f"<span style='color: #ef4444;'>Incorrect password!</span> Please try again for <b>{ip}:{port}</b>:" if is_incorrect else f"The host at <b>{ip}:{port}</b> requires a security password:"
            lbl_m = QLabel(prompt_msg)
            lbl_m.setStyleSheet("color: #cbd5e1; font-size: 12px; line-height: 1.4;")
            lbl_m.setWordWrap(True)
            v.addWidget(lbl_m)

            inp_row = QHBoxLayout()
            inp_row.setSpacing(8)
            txt_p = QLineEdit()
            txt_p.setMaxLength(6)
            txt_p.setPlaceholderText("Enter 6-digit password")
            txt_p.setEchoMode(QLineEdit.EchoMode.Password)
            inp_row.addWidget(txt_p, stretch=1)

            btn_eye = QPushButton("Show")
            btn_eye.setProperty("class", "btn-secondary")
            btn_eye.clicked.connect(lambda checked=False: (
                txt_p.setEchoMode(QLineEdit.EchoMode.Normal if txt_p.echoMode() == QLineEdit.EchoMode.Password else QLineEdit.EchoMode.Password),
                btn_eye.setText("Hide" if txt_p.echoMode() == QLineEdit.EchoMode.Normal else "Show")
            ))
            inp_row.addWidget(btn_eye)
            v.addLayout(inp_row)

            btn_box = QHBoxLayout()
            btn_box.setSpacing(10)
            btn_cancel = QPushButton("Cancel")
            btn_cancel.setProperty("class", "btn-secondary")
            btn_cancel.clicked.connect(dlg.reject)
            btn_box.addWidget(btn_cancel)

            btn_conn = QPushButton("Connect")
            btn_conn.setProperty("class", "btn-cta")
            btn_conn.clicked.connect(dlg.accept)
            txt_p.returnPressed.connect(dlg.accept)
            btn_box.addWidget(btn_conn)
            v.addLayout(btn_box)

            if dlg.exec() == QDialog.DialogCode.Accepted:
                entered_pwd = txt_p.text().strip()
                self.txt_client_pwd.setText(entered_pwd)
                self.connect_to_ip(ip, port, password=entered_pwd)
        else:
            QMessageBox.warning(self, "Connection Declined", f"Connection was not accepted:\n{reason}")

    def open_viewer_window(self, info: dict):
        client = info["client"]
        peer_name = info["peer"]
        self.active_viewer_window = ScreenViewerWindow(client, peer_name, self.bridge, info)
        self.active_viewer_window.show()
        self.active_viewer_window.raise_()
        self.active_viewer_window.activateWindow()

    def closeEvent(self, event):
        if self.capture_worker:
            self.capture_worker.stop()
        if self.discovery:
            self.discovery.stop()
        if self.server:
            self.server.stop()
        event.accept()
