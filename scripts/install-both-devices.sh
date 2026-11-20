#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REMOTE_IP="192.168.8.194"
REMOTE_USER="kali"

echo "=========================================================="
echo "          DogRemote Local Dual-Device Installer           "
echo "=========================================================="

APPIMAGE="$ROOT_DIR/dist/DogRemote-1.0.0.AppImage"
ICON="$ROOT_DIR/public/icon.png"

if [ ! -f "$APPIMAGE" ]; then
    echo "❌ Error: $APPIMAGE not found. Run ./scripts/build-all.sh linux first."
    exit 1
fi

# ------------------------------------------------------------
# 1. Install on Local Machine (192.168.8.185)
# ------------------------------------------------------------
echo "📦 [1/2] Installing DogRemote Local on Local Machine..."
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/Desktop"

# Copy binary to user PATH
cp "$APPIMAGE" "$HOME/.local/bin/dogremote"
ln -sf "$HOME/.local/bin/dogremote" "$HOME/.local/bin/lancast"
chmod +x "$HOME/.local/bin/dogremote" "$HOME/.local/bin/lancast"

# Copy AppImage to Desktop
cp "$APPIMAGE" "$HOME/Desktop/DogRemote.AppImage"
chmod +x "$HOME/Desktop/DogRemote.AppImage"

# Copy Icon
cp "$ICON" "$HOME/.local/share/icons/hicolor/512x512/apps/dogremote.png"

# Create Desktop entry in Applications menu
cat << EOF > "$HOME/.local/share/applications/dogremote.desktop"
[Desktop Entry]
Name=DogRemote Local
Comment=Ultra-Fast P2P LAN Screen Sharing & Remote Desktop
Exec=$HOME/.local/bin/dogremote
Icon=$HOME/.local/share/icons/hicolor/512x512/apps/dogremote.png
Terminal=false
Type=Application
Categories=Network;RemoteAccess;Utility;
StartupNotify=true
EOF
chmod +x "$HOME/.local/share/applications/dogremote.desktop"

# Create Desktop launcher on user's Desktop
cp "$HOME/.local/share/applications/dogremote.desktop" "$HOME/Desktop/DogRemote.desktop"
chmod +x "$HOME/Desktop/DogRemote.desktop"
gio set "$HOME/Desktop/DogRemote.desktop" metadata::trusted true 2>/dev/null || true

echo "   ✅ Local installation complete! Desktop launcher & menu entry created."

# ------------------------------------------------------------
# 2. Install on Remote Machine (192.168.8.194)
# ------------------------------------------------------------
echo "📦 [2/2] Installing DogRemote Local on Remote Machine ($REMOTE_IP)..."

# Transfer AppImage, updated source, and icon
ssh "$REMOTE_USER@$REMOTE_IP" "mkdir -p ~/.local/bin ~/.local/share/applications ~/.local/share/icons/hicolor/512x512/apps ~/Desktop ~/lancast/dist"

rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/.local/bin/dogremote"
rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/Desktop/DogRemote.AppImage"
rsync -avz "$APPIMAGE" "$REMOTE_USER@$REMOTE_IP:~/lancast/dist/DogRemote-1.0.0.AppImage"
rsync -avz "$ROOT_DIR/lancast/" "$REMOTE_USER@$REMOTE_IP:~/lancast/lancast/"
rsync -avz "$ROOT_DIR/public/" "$REMOTE_USER@$REMOTE_IP:~/lancast/public/"
rsync -avz "$ROOT_DIR/main.py" "$REMOTE_USER@$REMOTE_IP:~/lancast/main.py"
rsync -avz "$ICON" "$REMOTE_USER@$REMOTE_IP:~/.local/share/icons/hicolor/512x512/apps/dogremote.png"

# Setup desktop entries on remote machine
ssh "$REMOTE_USER@$REMOTE_IP" "bash -s" << 'REMOTESH'
set -e
chmod +x ~/.local/bin/dogremote
ln -sf ~/.local/bin/dogremote ~/.local/bin/lancast
chmod +x ~/Desktop/DogRemote.AppImage

cat << EOF > ~/.local/share/applications/dogremote.desktop
[Desktop Entry]
Name=DogRemote Local
Comment=Ultra-Fast P2P LAN Screen Sharing & Remote Desktop
Exec=/home/kali/.local/bin/dogremote
Icon=/home/kali/.local/share/icons/hicolor/512x512/apps/dogremote.png
Terminal=false
Type=Application
Categories=Network;RemoteAccess;Utility;
StartupNotify=true
EOF
chmod +x ~/.local/share/applications/dogremote.desktop

cp ~/.local/share/applications/dogremote.desktop ~/Desktop/DogRemote.desktop
chmod +x ~/Desktop/DogRemote.desktop
gio set ~/Desktop/DogRemote.desktop metadata::trusted true 2>/dev/null || true

# Update running service
systemctl --user restart lancast-host 2>/dev/null || true
REMOTESH

echo "   ✅ Remote installation on $REMOTE_IP complete!"
echo ""
echo "=========================================================="
echo " 🎉 DogRemote Local is now installed on BOTH devices!"
echo "    - Local Machine  : Launch from Desktop or run 'dogremote'"
echo "    - Remote Machine : Launch from Desktop or run 'dogremote'"
echo "=========================================================="
