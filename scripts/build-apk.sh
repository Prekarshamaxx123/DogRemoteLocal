#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================"
echo "          DogRemote Android APK Build System            "
echo "========================================================"

mkdir -p "$ROOT_DIR/dist"

# Set JDK 21
JAVA_HOME_PATH=""
if [ -d "$HOME/.local/jvm/jdk-21.0.6+7" ]; then
    JAVA_HOME_PATH="$HOME/.local/jvm/jdk-21.0.6+7"
elif [ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]; then
    JAVA_HOME_PATH="/usr/lib/jvm/java-21-openjdk-amd64"
fi

if [ -n "$JAVA_HOME_PATH" ]; then
    export JAVA_HOME="$JAVA_HOME_PATH"
    export PATH="$JAVA_HOME/bin:$PATH"
fi

# Ensure local.properties
cat << EOF > "$ROOT_DIR/android/local.properties"
sdk.dir=/home/kali/Android/Sdk
EOF

# Ensure cordova variables
mkdir -p "$ROOT_DIR/android/capacitor-cordova-android-plugins"
touch "$ROOT_DIR/android/capacitor-cordova-android-plugins/cordova.variables.gradle"

echo "📦 Syncing web assets to Capacitor Android..."
cd "$ROOT_DIR"
npx cap copy android

echo "📦 Compiling Android APK with Gradle..."
cd "$ROOT_DIR/android"
./gradlew assembleDebug --no-daemon

APK_SRC="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_SRC" ]; then
    cp "$APK_SRC" "$ROOT_DIR/dist/DogRemote-1.0.0.apk"
    echo "✅ Android APK ready: dist/DogRemote-1.0.0.apk"
else
    echo "❌ APK build failed"
    exit 1
fi
