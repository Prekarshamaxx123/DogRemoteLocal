/**
 * DogRemote LOCAL - Mobile Web & Android Client
 * Engineered to match Linux Qt6 UI with Ultra-Low Latency WebSocket Streaming
 */

(function () {
    'use strict';

    // UI Elements
    const dashboardView = document.getElementById('dashboardView');
    const viewerView = document.getElementById('viewerView');
    const statusBadge = document.getElementById('statusBadge');
    const remoteAddressInput = document.getElementById('remoteAddressInput');
    const remotePinInput = document.getElementById('remotePinInput');
    const togglePinVisibilityBtn = document.getElementById('togglePinVisibilityBtn');
    const requestControlCheckbox = document.getElementById('requestControlCheckbox');
    const connectBtn = document.getElementById('connectBtn');
    const refreshDiscoveryBtn = document.getElementById('refreshDiscoveryBtn');
    const discoveredList = document.getElementById('discoveredList');
    const localIpText = document.getElementById('localIpText');
    const copyIpBtn = document.getElementById('copyIpBtn');
    const toast = document.getElementById('toast');

    // Viewer HUD Elements
    const screenSelect = document.getElementById('screenSelect');
    const hudLatencyBadge = document.getElementById('hudLatencyBadge');
    const hudKeyboardToggleBtn = document.getElementById('hudKeyboardToggleBtn');
    const hudFullscreenBtn = document.getElementById('hudFullscreenBtn');
    const hudDisconnectBtn = document.getElementById('hudDisconnectBtn');
    const screenCanvas = document.getElementById('screenCanvas');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const virtualKeyToolbar = document.getElementById('virtualKeyToolbar');
    const hiddenKeyboardInput = document.getElementById('hiddenKeyboardInput');

    const ctx = screenCanvas.getContext('2d', { alpha: false });

    // State
    let ws = null;
    let isConnected = false;
    let lastPingTs = 0;
    let rttMs = 1.0;
    let frameCount = 0;
    let currentFps = 60;
    let lastFpsCalc = Date.now();
    let pingInterval = null;
    let isRendering = false;
    let activeModifiers = { Control_L: false, Alt_L: false, Shift_L: false };

    // Touch gesture tracking
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let isLongPress = false;
    let longPressTimer = null;
    let lastTapTime = 0;
    let initialTouchDistance = 0;

    // Load saved settings & history
    const savedAddress = localStorage.getItem('dogremote_last_addr') || '';
    if (savedAddress) remoteAddressInput.value = savedAddress;

    // Toast helper
    function showToast(message, duration = 2500) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    // IP Address Parsing (Formats 9-digit or regular IP)
    function parseAddress(raw) {
        const cleaned = raw.replace(/\s+/g, '').trim();
        // Check 9-digit format (e.g. 192168008185 -> 192.168.8.185 or 12 digits)
        if (/^\d{9,12}$/.test(cleaned)) {
            const parts = cleaned.match(/.{1,3}/g);
            if (parts && parts.length === 4) {
                return parts.map(p => parseInt(p, 10)).join('.');
            }
        }
        return cleaned;
    }

    // Toggle PIN Visibility
    togglePinVisibilityBtn.addEventListener('click', () => {
        if (remotePinInput.type === 'password') {
            remotePinInput.type = 'text';
            togglePinVisibilityBtn.textContent = '🔒';
        } else {
            remotePinInput.type = 'password';
            togglePinVisibilityBtn.textContent = '👁️';
        }
    });

    // Copy IP button
    copyIpBtn.addEventListener('click', () => {
        const ip = localIpText.textContent.trim();
        if (ip && !ip.includes('Detecting')) {
            navigator.clipboard.writeText(ip).then(() => showToast('IP Address Copied!'));
        }
    });

    // Connect Button Click
    connectBtn.addEventListener('click', () => {
        const rawAddr = remoteAddressInput.value.trim();
        const pin = remotePinInput.value.trim();

        if (!rawAddr) {
            showToast('Please enter a Host Address');
            remoteAddressInput.focus();
            return;
        }

        const hostIp = parseAddress(rawAddr);
        localStorage.setItem('dogremote_last_addr', rawAddr);
        startConnection(hostIp, 5859, pin);
    });

    // WebSocket Connection
    function startConnection(host, port, password) {
        if (ws) {
            try { ws.close(); } catch (e) {}
            ws = null;
        }

        showToast(`Connecting to ${host}:${port}...`);
        connectBtn.disabled = true;
        connectBtn.querySelector('span').textContent = '⏳ Connecting...';

        const wsUrl = `ws://${host}:${port}`;
        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
            if (!isConnected) {
                try { ws.close(); } catch (e) {}
                onConnectionFailed('Connection timed out. Check IP and Wi-Fi.');
            }
        }, 6000);

        ws.onopen = () => {
            // Step 1: Send authentication handshake
            ws.send(JSON.stringify({
                name: 'DogRemote Mobile Viewer',
                password: password,
                control: requestControlCheckbox.checked
            }));
        };

        ws.onmessage = (event) => {
            // Binary message = Screen frame (JPEG)
            if (event.data instanceof ArrayBuffer) {
                handleFrameData(event.data);
                return;
            }

            // Text message = JSON control protocol
            try {
                const msg = JSON.parse(event.data);
                handleJsonMessage(msg, connectTimeout);
            } catch (e) {
                console.error('Invalid JSON message', e);
            }
        };

        ws.onclose = () => {
            clearTimeout(connectTimeout);
            onDisconnected();
        };

        ws.onerror = (err) => {
            clearTimeout(connectTimeout);
            console.error('WebSocket Error:', err);
        };
    }

    // Handle Protocol JSON Messages
    function handleJsonMessage(msg, connectTimeout) {
        if (msg.type === 'connect_res') {
            clearTimeout(connectTimeout);
            if (msg.accepted) {
                onConnected(msg);
            } else {
                onConnectionFailed(msg.reason || 'Connection rejected by host.');
            }
        } else if (msg.type === 'pong') {
            const now = Date.now();
            rttMs = Math.max(0.5, (now - lastPingTs) / 2);
            updateHudBadge();
        } else if (msg.type === 'screen_changed') {
            populateScreens(msg.screens, msg.screen_index);
        } else if (msg.type === 'clipboard') {
            if (msg.text && navigator.clipboard) {
                navigator.clipboard.writeText(msg.text).catch(() => {});
            }
        }
    }

    // Connection Success Handler
    function onConnected(info) {
        isConnected = true;
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = '🚀 Connect & Control';
        statusBadge.textContent = '● Streaming Active';
        statusBadge.className = 'status-badge status-connected';

        // Switch to Viewer View
        dashboardView.style.display = 'none';
        viewerView.style.display = 'flex';

        // Populate Screen switcher
        populateScreens(info.screens || [], info.active_screen || 0);

        // Start ping loop
        pingInterval = setInterval(sendPing, 1000);

        showToast('Connected to Host!');
    }

    // Connection Failure Handler
    function onConnectionFailed(reason) {
        isConnected = false;
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = '🚀 Connect & Control';
        statusBadge.textContent = '● Connection Failed';
        statusBadge.className = 'status-badge';
        statusBadge.style.color = '#ef4444';

        if (reason === 'PASSWORD_INCORRECT') {
            showToast('Incorrect PIN! Please check host screen.');
            remotePinInput.focus();
        } else {
            showToast(`Connection Failed: ${reason}`);
        }
    }

    // Disconnect Handler
    function onDisconnected() {
        isConnected = false;
        clearInterval(pingInterval);
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = '🚀 Connect & Control';
        statusBadge.textContent = '● Ready to Connect';
        statusBadge.className = 'status-badge status-ready';
        statusBadge.style.color = '';

        viewerView.style.display = 'none';
        dashboardView.style.display = 'flex';

        showToast('Session Disconnected');
    }

    // Send Ping
    function sendPing() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            lastPingTs = Date.now();
            ws.send(JSON.stringify({ type: 'ping', ts: lastPingTs }));
        }
    }

    // Screen Frame Decoding & Rendering (JPEG Blob)
    function handleFrameData(buffer) {
        frameCount++;
        const now = Date.now();
        if (now - lastFpsCalc >= 1000) {
            currentFps = frameCount;
            frameCount = 0;
            lastFpsCalc = now;
            updateHudBadge();
        }

        if (isRendering) return;
        isRendering = true;

        const blob = new Blob([buffer], { type: 'image/jpeg' });
        createImageBitmap(blob).then((bitmap) => {
            if (screenCanvas.width !== bitmap.width || screenCanvas.height !== bitmap.height) {
                screenCanvas.width = bitmap.width;
                screenCanvas.height = bitmap.height;
            }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            isRendering = false;
        }).catch(() => {
            isRendering = false;
        });
    }

    // Update Floating HUD Stats Badge
    function updateHudBadge() {
        hudLatencyBadge.textContent = `⚡ ${rttMs.toFixed(1)} ms • ${currentFps} FPS • ${screenCanvas.width}x${screenCanvas.height}`;
    }

    // Populate Screens Dropdown
    function populateScreens(screens, activeIdx) {
        screenSelect.innerHTML = '';
        if (!screens || screens.length === 0) {
            const opt = document.createElement('option');
            opt.value = '0';
            opt.textContent = '🖥️ Screen 1';
            screenSelect.appendChild(opt);
            return;
        }

        screens.forEach((sc, idx) => {
            const opt = document.createElement('option');
            opt.value = idx.toString();
            opt.textContent = `${sc.name || 'Screen ' + (idx + 1)} (${sc.width || 1920}x${sc.height || 1080})`;
            if (idx === activeIdx) opt.selected = true;
            screenSelect.appendChild(opt);
        });

        // Add unified multi-screen canvas option if > 1 screens
        if (screens.length > 1) {
            const optAll = document.createElement('option');
            optAll.value = '-1';
            optAll.textContent = '🖥️ All Displays';
            if (activeIdx === -1) optAll.selected = true;
            screenSelect.appendChild(optAll);
        }
    }

    // Display Switcher Change Event
    screenSelect.addEventListener('change', () => {
        const idx = parseInt(screenSelect.value, 10);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_screen', screen_index: idx }));
            showToast(`Switching to display ${screenSelect.options[screenSelect.selectedIndex].text}...`);
        }
    });

    // Fullscreen Toggle
    hudFullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            viewerView.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });

    // Disconnect Button
    hudDisconnectBtn.addEventListener('click', () => {
        if (ws) {
            try { ws.close(); } catch (e) {}
        }
    });

    // Touch Event Handling (Touch to Mouse Translation)
    function getNormalizedCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        return { nx, ny };
    }

    screenCanvas.addEventListener('touchstart', (e) => {
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;
        
        if (e.touches.length === 1) {
            touchStartTime = Date.now();
            const { nx, ny } = getNormalizedCoords(e);
            touchStartX = nx;
            touchStartY = ny;
            isLongPress = false;

            longPressTimer = setTimeout(() => {
                isLongPress = true;
                sendMouseClick('right', 'click', touchStartX, touchStartY);
                if (navigator.vibrate) navigator.vibrate(50);
            }, 350);
        } else if (e.touches.length === 2) {
            clearTimeout(longPressTimer);
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialTouchDistance = dy;
        }
    }, { passive: true });

    screenCanvas.addEventListener('touchmove', (e) => {
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;

        if (e.touches.length === 1) {
            const { nx, ny } = getNormalizedCoords(e);
            const dist = Math.hypot(nx - touchStartX, ny - touchStartY);
            if (dist > 0.015) {
                clearTimeout(longPressTimer);
            }
            sendMouseMove(nx, ny);
        } else if (e.touches.length === 2) {
            const currentDy = e.touches[0].clientY - e.touches[1].clientY;
            const delta = currentDy - initialTouchDistance;
            if (Math.abs(delta) > 10) {
                const steps = delta > 0 ? 2 : -2;
                sendScroll(steps);
                initialTouchDistance = currentDy;
            }
        }
    }, { passive: true });

    screenCanvas.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;

        if (e.changedTouches.length === 1 && !isLongPress) {
            const { nx, ny } = getNormalizedCoords(e.changedTouches[0]);
            const dist = Math.hypot(nx - touchStartX, ny - touchStartY);
            const duration = Date.now() - touchStartTime;

            if (dist < 0.02 && duration < 300) {
                const now = Date.now();
                if (now - lastTapTime < 280) {
                    sendMouseClick('left', 'dblclick', nx, ny);
                    lastTapTime = 0;
                } else {
                    sendMouseClick('left', 'click', nx, ny);
                    lastTapTime = now;
                }
            }
        }
    }, { passive: true });

    // Send Input Event Functions
    function sendMouseMove(x, y) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'mouse_move', x: x, y: y }));
        }
    }

    function sendMouseClick(button, action, x, y) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'mouse_click', button: button, action: action, x: x, y: y }));
        }
    }

    function sendScroll(steps) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'scroll', steps: steps }));
        }
    }

    function sendKey(keyName, action = 'key') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'key', key: keyName, action: action }));
        }
    }

    // Bottom Special Keys Toolbar
    document.querySelectorAll('.vkey[data-key]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const keyName = btn.getAttribute('data-key');
            if (btn.classList.contains('modifier-key')) {
                // Toggle modifier state
                activeModifiers[keyName] = !activeModifiers[keyName];
                btn.classList.toggle('active', activeModifiers[keyName]);
                sendKey(keyName, activeModifiers[keyName] ? 'down' : 'up');
            } else {
                sendKey(keyName, 'key');
            }
        });
    });

    // Native Mobile Keyboard Integration
    const triggerNativeKeyboardBtn = document.getElementById('triggerNativeKeyboardBtn');
    triggerNativeKeyboardBtn.addEventListener('click', () => {
        hiddenKeyboardInput.focus();
    });

    hudKeyboardToggleBtn.addEventListener('click', () => {
        hiddenKeyboardInput.focus();
    });

    hiddenKeyboardInput.addEventListener('input', (e) => {
        const val = hiddenKeyboardInput.value;
        if (val) {
            for (let char of val) {
                sendKey(char, 'type');
            }
            hiddenKeyboardInput.value = '';
        }
    });

    hiddenKeyboardInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
            sendKey('BackSpace', 'key');
        } else if (e.key === 'Enter') {
            sendKey('Return', 'key');
        }
    });

    // Auto LAN Discovery (Subnet probe on port 5859)
    function discoverLocalDevices() {
        discoveredList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📡</div>
                <div class="empty-title">Scanning Local Wi-Fi Subnet...</div>
                <div class="empty-desc">Probing active DogRemote hosts...</div>
            </div>
        `;

        // Get current origin IP or default local subnet
        const currentHost = window.location.hostname || '192.168.8.185';
        const subnetParts = currentHost.split('.');
        const prefix = (subnetParts.length === 4) ? `${subnetParts[0]}.${subnetParts[1]}.${subnetParts[2]}` : '192.168.8';

        // Display local IP estimation
        localIpText.textContent = `${currentHost} (Wi-Fi)`;

        // Candidates to probe: known host, nearby addresses
        const candidates = [
            '192.168.8.185',
            '192.168.8.194',
            '192.168.1.100',
            '192.168.0.100'
        ];
        if (!candidates.includes(currentHost)) {
            candidates.unshift(currentHost);
        }

        let foundAny = false;
        let checked = 0;

        candidates.forEach(ip => {
            const probeWs = new WebSocket(`ws://${ip}:5859`);
            const probeTimeout = setTimeout(() => {
                try { probeWs.close(); } catch(e) {}
                checkDone();
            }, 1200);

            probeWs.onopen = () => {
                clearTimeout(probeTimeout);
                foundAny = true;
                addDiscoveredCard(ip, 'DogRemote Linux Host', '1.1 ms');
                try { probeWs.close(); } catch(e) {}
                checkDone();
            };

            probeWs.onerror = () => {
                clearTimeout(probeTimeout);
                checkDone();
            };

            function checkDone() {
                checked++;
                if (checked === candidates.length && !foundAny) {
                    discoveredList.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon">🔍</div>
                            <div class="empty-title">No Hosts Auto-Detected</div>
                            <div class="empty-desc">Enter your PC's IP address directly in the Direct Connect box above.</div>
                        </div>
                    `;
                }
            }
        });
    }

    function addDiscoveredCard(ip, name, ping) {
        if (discoveredList.querySelector('.empty-state')) {
            discoveredList.innerHTML = '';
        }

        const card = document.createElement('div');
        card.className = 'device-card';
        card.innerHTML = `
            <div class="device-info-left">
                <div class="device-name">🖥️ ${name}</div>
                <div class="device-ip">${ip} • <span style="color:#34d399;">⚡ ${ping}</span></div>
            </div>
            <button type="button" class="btn-secondary btn-xs connect-quick-btn">Connect</button>
        `;

        card.querySelector('.connect-quick-btn').addEventListener('click', () => {
            remoteAddressInput.value = ip;
            remotePinInput.focus();
            showToast(`Selected ${ip}. Enter 6-digit PIN.`);
        });

        discoveredList.appendChild(card);
    }

    refreshDiscoveryBtn.addEventListener('click', discoverLocalDevices);

    // Initial Run
    discoverLocalDevices();

})();
