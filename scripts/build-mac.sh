#!/bin/bash
set -e

echo "========================================================"
echo "          LanCast Pro - macOS Native Build              "
echo "========================================================"

if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3 or brew install python"
    exit 1
fi

echo "📦 [1/3] Installing dependencies..."
python3 -m pip install -r requirements.txt

echo "📦 [2/3] Building macOS .app bundle..."
rm -rf build dist/LanCast.app dist/LanCast.dmg
pyinstaller --noconfirm --clean --windowed --name "LanCast" \
    --icon "public/icon.png" \
    --add-data "public:public" \
    --osx-bundle-identifier "com.lancast.pro" \
    main.py

echo "📦 [3/3] Packaging macOS .dmg installer..."
if command -v hdiutil &> /dev/null; then
    hdiutil create -volname "LanCast" -srcfolder "dist/LanCast.app" -ov -format UDZO "dist/LanCast-1.0.0.dmg"
    echo "✅ macOS DMG installer created: dist/LanCast-1.0.0.dmg"
else
    echo "⚠️ hdiutil not found (only available on macOS). App bundle created at dist/LanCast.app"
fi

echo "🎉 Build finished!"
