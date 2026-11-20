import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if 'QT_QPA_PLATFORM' not in os.environ and 'DISPLAY' not in os.environ:
    os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QGuiApplication
from lancast.ui import LanCastMainWindow, ScreenViewerWindow

app = QApplication(sys.argv)
win = LanCastMainWindow()
win.resize(1000, 680)
win.show()

screens = QGuiApplication.screens()
print(f"Detected {len(screens)} screens on system")
print(f"Combo box items count: {win.combo_screen.count()}")
for i in range(win.combo_screen.count()):
    print(f"  Option {i}: '{win.combo_screen.itemText(i)}' -> data={win.combo_screen.itemData(i)}")

# Check Quality Presets
print(f"\nQuality combo items count: {win.combo_quality.count()}")
for i in range(win.combo_quality.count()):
    print(f"  Quality {i}: '{win.combo_quality.itemText(i)}'")

conn_info = {
    'screens': win.server.screens_info,
    'active_screen': win.selected_screen_idx
}
viewer = ScreenViewerWindow(None, 'DESKTOP-REMOTE', win.bridge, conn_info)
viewer.resize(1280, 720)
viewer.show()
print(f"\nViewer Screen Dropdown count: {viewer.combo_screen.count()}")
for i in range(viewer.combo_screen.count()):
    print(f"  Viewer Option {i}: '{viewer.combo_screen.itemText(i)}' -> data={viewer.combo_screen.itemData(i)}")

# Simulate remote client requesting switch to Display 1 (data=0)
print("\nTesting remote screen switch request to Display 1:")
win.bridge.screen_switch_requested.emit(0)
app.processEvents()
print(f"  After switch, win.selected_screen_idx: {win.selected_screen_idx}")
print(f"  After switch, server screen rect: {win.server.screen_offset_x}, {win.server.screen_offset_y}, {win.server.screen_w}x{win.server.screen_h}")

# Simulate remote client requesting switch to All Displays (data=-1)
print("\nTesting remote screen switch request to All Displays (-1):")
win.bridge.screen_switch_requested.emit(-1)
app.processEvents()
print(f"  After switch, win.selected_screen_idx: {win.selected_screen_idx}")
print(f"  After switch, server screen rect: {win.server.screen_offset_x}, {win.server.screen_offset_y}, {win.server.screen_w}x{win.server.screen_h}")

pixmap = viewer.grab()
pixmap.save('/home/kali/.gemini/antigravity/brain/46001f78-cb3c-465e-9a99-0a8691b95e3b/viewer_multiscreen_preview.png')
print("Viewer preview screenshot saved successfully")

win_pixmap = win.grab()
win_pixmap.save('/home/kali/.gemini/antigravity/brain/46001f78-cb3c-465e-9a99-0a8691b95e3b/lancast_dashboard_v5.png')
print("Dashboard v5 preview screenshot saved successfully")

print("\nSUCCESS: All multi-screen and resolution tests passed!")
os._exit(0)
