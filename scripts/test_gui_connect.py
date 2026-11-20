import sys
import time
import os
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer
from lancast.ui import LanCastMainWindow

def run_test():
    app = QApplication(sys.argv)
    win = LanCastMainWindow()
    win.show()

    win.bridge.connected.connect(lambda info: print("BRIDGE CONNECTED SIGNAL RECEIVED!", flush=True))
    win.bridge.rejected.connect(lambda r: print(f"BRIDGE REJECTED: {r}", flush=True))

    def do_connect():
        print("Connecting to 192.168.8.194...", flush=True)
        win.txt_remote_target.setText("192.168.8.194")
        win.connect_to_target()

    start_wait = time.time()

    def poll_viewer():
        vw = getattr(win, "active_viewer_window", None)
        if vw:
            print("✅ GUI Viewer Window successfully opened!", flush=True)
            print(f"Toolbar height: {vw.toolbar.height()}px", flush=True)
            print(f"Window title: {vw.windowTitle()}", flush=True)
            print("Testing collapse toolbar...", flush=True)
            vw.toggle_bar_collapse()
            print(f"Collapsed toolbar hidden: {vw.toolbar.isHidden()}, Handle visible: {vw.uncollapse_handle.isVisible()}", flush=True)
            vw.toggle_bar_collapse()
            print(f"Restored toolbar visible: {vw.toolbar.isVisible()}", flush=True)
            vw.close()
            win.close()
            app.quit()
            print("GUI Test Completed Successfully!", flush=True)
            os._exit(0)
        elif time.time() - start_wait > 6.0:
            print("❌ Timed out waiting for viewer window", flush=True)
            win.close()
            app.quit()
            os._exit(1)
        else:
            QTimer.singleShot(200, poll_viewer)

    QTimer.singleShot(200, do_connect)
    QTimer.singleShot(400, poll_viewer)

    app.exec()

if __name__ == "__main__":
    run_test()
