#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================"
echo "          LanCast Multi-Platform Build System           "
echo "========================================================"

TARGET=${1:-"all"}
mkdir -p "$ROOT_DIR/dist"

build_linux_appimage() {
    echo "📦 [Linux] Building native Linux executable using PyInstaller..."
    rm -rf "$ROOT_DIR/build/dogremote" "$ROOT_DIR/dist/dogremote"
    pyinstaller --noconfirm --clean --windowed --name "dogremote" \
        --add-data "public:public" \
        "$ROOT_DIR/main.py"

    echo "📦 [Linux] Preparing AppDir for AppImage..."
    APP_DIR="$ROOT_DIR/dist/AppDir"
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR/usr/bin" "$APP_DIR/usr/share/icons/hicolor/512x512/apps"

    cp -r "$ROOT_DIR/dist/dogremote/"* "$APP_DIR/usr/bin/" 2>/dev/null || cp "$ROOT_DIR/dist/dogremote" "$APP_DIR/usr/bin/"
    cp "$ROOT_DIR/public/icon.png" "$APP_DIR/dogremote.png"
    cp "$ROOT_DIR/public/icon.png" "$APP_DIR/usr/share/icons/hicolor/512x512/apps/dogremote.png"

    cat << 'EOF' > "$APP_DIR/dogremote.desktop"
[Desktop Entry]
Name=DogRemote Local
Comment=Ultra-Fast P2P LAN Screen Sharing & Remote Control
Exec=dogremote
Icon=dogremote
Terminal=false
Type=Application
Categories=Network;RemoteAccess;Utility;
EOF

    cat << 'EOF' > "$APP_DIR/AppRun"
#!/bin/sh
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export PATH="${HERE}/usr/bin:${PATH}"
export LD_LIBRARY_PATH="${HERE}/usr/lib:${LD_LIBRARY_PATH}"
exec "${HERE}/usr/bin/dogremote" "$@"
EOF
    chmod +x "$APP_DIR/AppRun"

    echo "📦 [Linux] Generating Universal Linux AppImage..."
    APPIMAGETOOL="/tmp/appimagetool"
    if [ ! -f "$APPIMAGETOOL" ]; then
        curl -sL https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage -o "$APPIMAGETOOL"
        chmod +x "$APPIMAGETOOL"
    fi

    rm -f "$ROOT_DIR/dist/DogRemote-1.0.0.AppImage"
    ARCH=x86_64 "$APPIMAGETOOL" "$APP_DIR" "$ROOT_DIR/dist/DogRemote-1.0.0.AppImage"
    chmod +x "$ROOT_DIR/dist/DogRemote-1.0.0.AppImage"
    cp "$ROOT_DIR/dist/DogRemote-1.0.0.AppImage" "$ROOT_DIR/dist/LanCast-1.0.0.AppImage" 2>/dev/null || true
    echo "✅ Universal Linux AppImage ready: dist/DogRemote-1.0.0.AppImage"
}

build_deb() {
    echo "📦 [Debian/Ubuntu/Kali] Generating .deb package..."
    DEB_DIR="$ROOT_DIR/dist/deb_pkg"
    rm -rf "$DEB_DIR"
    mkdir -p "$DEB_DIR/DEBIAN" "$DEB_DIR/usr/bin" "$DEB_DIR/usr/share/applications" "$DEB_DIR/usr/share/icons/hicolor/512x512/apps"

    cp -r "$ROOT_DIR/dist/AppDir/usr/bin/"* "$DEB_DIR/usr/bin/"
    cp "$ROOT_DIR/dist/AppDir/dogremote.desktop" "$DEB_DIR/usr/share/applications/"
    cp "$ROOT_DIR/public/icon.png" "$DEB_DIR/usr/share/icons/hicolor/512x512/apps/dogremote.png"

    cat << 'EOF' > "$DEB_DIR/DEBIAN/control"
Package: dogremote
Version: 1.0.0
Section: utils
Priority: optional
Architecture: amd64
Maintainer: DogRemote Team <dogremote@local.lan>
Description: Ultra-Fast Same-Network Screen Sharing & Remote Control
 DogRemote Local is a high-performance, low-latency screen sharing and remote desktop
 tool engineered for seamless peer-to-peer productivity over local network.
EOF

    dpkg-deb --build --root-owner-group "$DEB_DIR" "$ROOT_DIR/dist/dogremote_1.0.0_amd64.deb"
    cp "$ROOT_DIR/dist/dogremote_1.0.0_amd64.deb" "$ROOT_DIR/dist/lancast_1.0.0_amd64.deb" 2>/dev/null || true
    rm -rf "$DEB_DIR"
    echo "✅ Debian package ready: dist/dogremote_1.0.0_amd64.deb"
}

build_arch() {
    echo "📦 [Arch Linux] Generating Arch pacman package (.pkg.tar.zst)..."
    ARCH_DIR="$ROOT_DIR/dist/arch_pkg"
    rm -rf "$ARCH_DIR"
    mkdir -p "$ARCH_DIR/usr/bin" "$ARCH_DIR/usr/share/applications" "$ARCH_DIR/usr/share/icons/hicolor/512x512/apps"

    cp -r "$ROOT_DIR/dist/AppDir/usr/bin/"* "$ARCH_DIR/usr/bin/"
    cp "$ROOT_DIR/dist/AppDir/dogremote.desktop" "$ARCH_DIR/usr/share/applications/"
    cp "$ROOT_DIR/public/icon.png" "$ARCH_DIR/usr/share/icons/hicolor/512x512/apps/dogremote.png"

    cat << 'EOF' > "$ARCH_DIR/.PKGINFO"
pkgname = dogremote
pkgbase = dogremote
pkgver = 1.0.0-1
pkgdesc = Ultra-Fast Same-Network Screen Sharing & Remote Control
url = https://github.com/Prekarshamaxx123/DogRemoteLocal
builddate = 1732121700
packager = DogRemote Team <dogremote@local.lan>
size = 280000000
arch = x86_64
license = MIT
depend = glibc
depend = libx11
depend = libxfixes
depend = libxtst
EOF

    (cd "$ARCH_DIR" && tar --zstd -cf "$ROOT_DIR/dist/dogremote-1.0.0-1-x86_64.pkg.tar.zst" .PKGINFO usr)
    cp "$ROOT_DIR/dist/dogremote-1.0.0-1-x86_64.pkg.tar.zst" "$ROOT_DIR/dist/lancast-1.0.0-1-x86_64.pkg.tar.zst" 2>/dev/null || true
    rm -rf "$ARCH_DIR"
    echo "✅ Arch Linux package ready: dist/dogremote-1.0.0-1-x86_64.pkg.tar.zst"

    echo "📦 [Linux Portable] Generating portable tarball (.tar.gz)..."
    (cd "$ROOT_DIR/dist" && tar -czf DogRemote-1.0.0-linux-x86_64.tar.gz -C AppDir usr dogremote.desktop dogremote.png)
    cp "$ROOT_DIR/dist/DogRemote-1.0.0-linux-x86_64.tar.gz" "$ROOT_DIR/dist/LanCast-1.0.0-linux-x86_64.tar.gz" 2>/dev/null || true
    echo "✅ Portable Linux tarball ready: dist/DogRemote-1.0.0-linux-x86_64.tar.gz"
}

case $TARGET in
    "appimage"|"linux")
        build_linux_appimage
        ;;
    "deb")
        build_deb
        ;;
    "arch")
        build_arch
        ;;
    "all")
        build_linux_appimage
        build_deb
        build_arch
        echo ""
        echo "========================================================"
        echo " 🎉 ALL LINUX BUILDS COMPLETED SUCCESSFULLY!"
        echo "    Output files in $ROOT_DIR/dist/:"
        ls -lh "$ROOT_DIR/dist/"*.{AppImage,deb,zst,tar.gz} 2>/dev/null || true
        echo "========================================================"
        ;;
    *)
        echo "Usage: ./scripts/build-all.sh [linux|appimage|deb|arch|all]"
        exit 1
        ;;
esac
