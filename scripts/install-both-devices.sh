#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REMOTE_IP="192.168.8.194"
REMOTE_USER="kali"

echo "=========================================================="
echo "          LanCast Pro Dual-Device Installer               "
echo "=========================================================="

APPIMAGE="$ROOT_DIR/dist/LanCast-1.0.0.AppImage"
ICON="$ROOT_DIR/public/icon.png"

if [ ! -f "$APPIMAGE" ]; then
    echo "❌ Error: $APPIMAGE not found. Run ./scripts/build-all.sh linux first."
    exit 1
fi

# ------------------------------------------------------------
# 1. Install on Local Machine (192.168.8.185)
# ------------------------------------------------------------
echo "📦 [1/2] Installing LanCast Pro on Local Machine..."
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/Desktop"

# Copy binary to user PATH
cp "$APPIMAGE" "$HOME/.local/bin/lancast"
chmod +x "$HOME/.local/bin/lancast"

# Copy AppImage to Desktop
cp "$APPIMAGE" "$HOME/Desktop/LanCast.AppImage"
chmod +x "$HOME/Desktop/LanCast.AppImage"

# Copy Icon
cp "$ICON" "$HOME/.local/share/icons/hicolor/512x512/apps/lancast.png"

# Create Desktop entry in Applications menu
cat << EOF > "$HOME/.local/share/applications/lancast.desktop"
[Desktop Entry]
Name=LanCast Pro
Comment=Ultra-Fast Same-Network Screen Sharing & Remote Desktop
Exec=$HOME/.local/bin/lancast
Icon=$HOME/.local/share/icons/hicolor/512x512/apps/lancast.png
Terminal=false
Type=Application
Categories=Network;RemoteAccess;Utility;
StartupNotify=true
EOF
chmod +x "$HOME/.local/share/applications/lancast.desktop"

# Create Desktop launcher on user's Desktop
cp "$HOME/.local/share/applications/lancast.desktop" "$HOME/Desktop/LanCast.desktop"
chmod +x "$HOME/Desktop/LanCast.desktop"
gio set "$HOME/Desktop/LanCast.desktop" metadata::trusted true 2>/dev/null || true

echo "   ✅ Local installation complete! Desktop launcher & menu entry created."

# ------------------------------------------------------------
# 2. Install on Remote Machine (192.168.8.194)
# ------------------------------------------------------------
echo "📦 [2/2] Installing LanCast Pro on Remote Machine ($REMOTE_IP)..."

# Transfer AppImage, updated source, and icon
ssh "$REMOTE_USER@$REMOTE_IP" "mkdir -p ~/.local/bin ~/.local/share/applications ~/.local/share/icons/hicolor/512x512/apps ~/Desktop ~/lancast/dist"

rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/.local/bin/lancast"
rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/Desktop/LanCast.AppImage"
rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/lancast/dist/LanCast-1.0.0.AppImage"
rsync -avz "$ROOT_DIR/lancast/" "$REMOTE_USER@$REMOTE_IP:~/lancast/lancast/"
rsync -avz "$ROOT_DIR/main.py" "$REMOTE_USER@$REMOTE_IP:~/lancast/main.py"
rsync -avz "$ICON" "$REMOTE_USER@$REMOTE_IP:~/.local/share/icons/hicolor/512x512/apps/lancast.png"

# Setup desktop entries on remote machine
ssh "$REMOTE_USER@$REMOTE_IP" "bash -s" << 'REMOTESH'
set -e
chmod +x ~/.local/bin/lancast
chmod +x ~/Desktop/LanCast.AppImage

cat << EOF > ~/.local/share/applications/lancast.desktop
[Desktop Entry]
Name=LanCast Pro
Comment=Ultra-Fast Same-Network Screen Sharing & Remote Desktop
Exec=/home/kali/.local/bin/lancast
Icon=/home/kali/.local/share/icons/hicolor/512x512/apps/lancast.png
Terminal=false
Type=Application
Categories=Network;RemoteAccess;Utility;
StartupNotify=true
EOF
chmod +x ~/.local/share/applications/lancast.desktop

cp ~/.local/share/applications/lancast.desktop ~/Desktop/LanCast.desktop
chmod +x ~/Desktop/LanCast.desktop
gio set ~/Desktop/LanCast.desktop metadata::trusted true 2>/dev/null || true

# Update running service
systemctl --user restart lancast-host 2>/dev/null || true
REMOTESH

echo "   ✅ Remote installation on $REMOTE_IP complete!"
echo ""
echo "=========================================================="
echo " 🎉 LanCast Pro is now installed on BOTH devices!"
echo "    - Local Machine  : Launch from Desktop or run 'lancast'"
echo "    - Remote Machine : Launch from Desktop or run 'lancast'"
echo "=========================================================="
