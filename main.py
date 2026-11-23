#!/usr/bin/env python3
"""
LanCast - Ultra-Fast Same-Network Screen Sharing & Remote Control
Pure Native GUI Application
"""

import sys
import signal
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QIcon
from lancast.ui import LanCastMainWindow

def main():
    # Allow clean exit on Ctrl+C in terminal
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    app = QApplication(sys.argv)
    app.setApplicationName("LanCast")
    app.setOrganizationName("LanCast")

    # Load icon if available
    import os
    icon_path = os.path.join(os.path.dirname(__file__), 'public', 'icon.png')
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))

    window = LanCastMainWindow()
    if "--share" in sys.argv or "-s" in sys.argv:
        window.start_sharing()
    window.show()

    sys.exit(app.exec())

if __name__ == '__main__':
    main()
