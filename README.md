# ⚡ LanCast Pro - Ultra-Fast Same-Network Screen Sharing & Remote Desktop

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![GUI](https://img.shields.io/badge/GUI-PyQt6-green.svg)](https://riverbankcomputing.com/software/pyqt/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS%20%7C%20Android-orange.svg)](#cross-platform-packages)
[![Latency](https://img.shields.io/badge/LAN%20Latency-~1.1ms-brightgreen.svg)](#performance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **High-performance, ultra-low-latency screen sharing and remote desktop engine designed exclusively for local networks (Wi-Fi / Ethernet).**
>
> 100% Native C++/Qt6 pipeline, Direct TCP binary socket framing, and zero cloud dependency.

---

## 🌟 Key Features

* **⚡ Ultra-Low Latency (~1.1 ms RTT)**: Monotonic clock ping-pong engine with 512KB tuned socket buffers delivering fluid 60 FPS streams at 100% native display resolution.
* **🖥️ Multi-Display Support**: Stream individual monitors or a unified multi-screen canvas. Switch active displays in real-time from the remote viewer.
* **🛡️ Security & Authentication**:
  * Real-time connection approval modals (Accept / Decline with fine-grained permissions).
  * Dynamic random password generation with viewer authentication modal.
  * 100% peer-to-peer over local network; zero data leaves your local Wi-Fi.
* **🖱️ Full Remote Control**: Mouse tracking, left/right/middle clicks, mouse wheel scrolling, keyboard simulation, and bidirectional clipboard synchronization.
* **🔍 Auto-Discovery**: Automatic LAN peer detection using UDP broadcast and mDNS/Zeroconf beacons—no manual IP configuration needed.
* **📱 Mobile Companion (Android & iOS)**:
  * Native Android APK with mobile modifier keys toolbar (`Ctrl`, `Alt`, `Shift`, `Esc`, `Tab`, `Win`, and arrow keys).
  * Instant QR code connection for mobile browsers without app installation.
* **🎨 Sleek Dark Modern Interface**: Clean professional UI built with native PyQt6 widgets and high-contrast HUD statistics (ms, FPS, resolution).

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Host ["Host Device (Server)"]
        CAP["Screen Capture\n(MSS / X11)"] --> COMP["JPEG / TurboJPEG\nCompression"]
        COMP --> SVR["TCP Server\n(Port 5858)"]
        INP["Input Simulator\n(xdotool / pynput)"] <-- SVR
    end

    subgraph Discovery ["Local Network (LAN)"]
        BEACON["UDP Broadcast Beacon\n(Port 5859)"]
        DISC["Auto-Discovery\nEngine"]
    end

    subgraph Client ["Client Device (Viewer)"]
        CLI["TCP Client & Buffer"] --> DEC["Fast QPixmap\nDecoder"]
        DEC --> UI["Sleek PyQt6\nViewer HUD"]
        EVT["Mouse / Key\nEvent Filter"] --> CLI
    end

    BEACON <--> DISC
    SVR <== "Direct TCP Stream (~1.1ms RTT)" ==> CLI
```

---

## 📦 Cross-Platform Packages

Ready-to-use binaries are built in the [`dist/`](dist/) folder:

| Operating System | Package Format | Installation / Execution |
| :--- | :--- | :--- |
| **Universal Linux** | `.AppImage` | `chmod +x LanCast-1.0.0.AppImage && ./LanCast-1.0.0.AppImage` |
| **Arch Linux / Manjaro** | `.pkg.tar.zst` | `sudo pacman -U lancast-1.0.0-1-x86_64.pkg.tar.zst` |
| **Debian / Ubuntu / Kali** | `.deb` | `sudo dpkg -i lancast_1.0.0_amd64.deb` |
| **Linux Standalone** | `.tar.gz` | `tar -xzf LanCast-1.0.0-linux-x86_64.tar.gz && ./usr/bin/lancast` |
| **Android** | `.apk` | Transfer and install `LanCast-1.0.0.apk` on phone |
| **Windows** | `.exe` | Run `scripts\build-windows.bat` on Windows |
| **macOS** | `.dmg` | Run `./scripts/build-mac.sh` on macOS |

---

## 🚀 Quick Start (Running from Source)

### 1. Prerequisites
- Python 3.10 or newer
- Linux dependencies (Debian/Ubuntu/Kali):
  ```bash
  sudo apt install -y python3-pyqt6 xdotool
  ```

### 2. Install Python Dependencies
```bash
pip install -r requirements.txt
```

### 3. Launch LanCast
```bash
python3 main.py
```

---

## 🛠️ Build Scripts

Use the unified multi-platform build script to compile for various targets:

```bash
# Build Universal Linux AppImage, Debian .deb, Arch package, and Android APK:
./scripts/build-all.sh all

# Build only Android APK:
./scripts/build-all.sh android

# Build only Arch Linux package (.pkg.tar.zst):
./scripts/build-all.sh arch

# Build only Debian / Ubuntu package (.deb):
./scripts/build-all.sh deb

# Build only Linux AppImage:
./scripts/build-all.sh linux
```

### Building on Windows
Open Command Prompt in the repository folder and execute:
```cmd
scripts\build-windows.bat
```

### Building on macOS
In Terminal:
```bash
chmod +x scripts/build-mac.sh
./scripts/build-mac.sh
```

---

## 🔒 Security Model

1. **Interactive Consent**: Connections are refused unless the host accepts the prompt or validates against the optional host password.
2. **Strictly Local Communication**: All audio, video, clipboard, and input data remain strictly inside your private subnet.
3. **No External Servers**: Zero reliance on third-party STUN/TURN, signaling, or telemetry servers.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
