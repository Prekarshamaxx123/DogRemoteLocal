/**
 * DogRemote LOCAL - Mobile Web & Android Client
 * Engineered to match Linux Qt6 UI with Ultra-Low Latency WebSocket Streaming,
 * full host/client password configuration, accurate dynamic RTT tracking, and multi-display controls.
 */

(function () {
    'use strict';

    // UI Elements
    const dashboardView = document.getElementById('dashboardView');
    const viewerView = document.getElementById('viewerView');
    const statusBadge = document.getElementById('statusBadge');
    
    // Direct Connect Elements
    const remoteAddressInput = document.getElementById('remoteAddressInput');
    const remotePortInput = document.getElementById('remotePortInput');
    const remotePinInput = document.getElementById('remotePinInput');
    const togglePinVisibilityBtn = document.getElementById('togglePinVisibilityBtn');
    const clientQualitySelect = document.getElementById('clientQualitySelect');
    const requestControlCheckbox = document.getElementById('requestControlCheckbox');
    const connectBtn = document.getElementById('connectBtn');

    // Discovery Elements
    const refreshDiscoveryBtn = document.getElementById('refreshDiscoveryBtn');
    const discoveredList = document.getElementById('discoveredList');

    // Host Settings Elements
    const requirePasswordCheckbox = document.getElementById('requirePasswordCheckbox');
    const hostPasswordInput = document.getElementById('hostPasswordInput');
    const toggleHostMaskBtn = document.getElementById('toggleHostMaskBtn');
    const generateNewPwdBtn = document.getElementById('generateNewPwdBtn');
    const copyHostPwdBtn = document.getElementById('copyHostPwdBtn');
    const allowRemoteControlCheckbox = document.getElementById('allowRemoteControlCheckbox');
    const streamAudioCheckbox = document.getElementById('streamAudioCheckbox');

    // Info Elements
    const localIpText = document.getElementById('localIpText');
    const copyIpBtn = document.getElementById('copyIpBtn');
    const toast = document.getElementById('toast');

    // Auth Prompt Modal
    const authModal = document.getElementById('authModal');
    const authModalSubtitle = document.getElementById('authModalSubtitle');
    const modalPasswordInput = document.getElementById('modalPasswordInput');
    const modalToggleMaskBtn = document.getElementById('modalToggleMaskBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const modalConnectBtn = document.getElementById('modalConnectBtn');

    // Viewer HUD Elements
    const screenSelect = document.getElementById('screenSelect');
    const hudLatencyText = document.getElementById('hudLatencyText');
    const toggleTouchModeBtn = document.getElementById('toggleTouchModeBtn');
    const touchModeLabel = document.getElementById('touchModeLabel');
    const hudFullscreenBtn = document.getElementById('hudFullscreenBtn');
    const hudDisconnectBtn = document.getElementById('hudDisconnectBtn');
    const screenCanvas = document.getElementById('screenCanvas');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const virtualKeyToolbar = document.getElementById('virtualKeyToolbar');
    const triggerNativeKeyboardBtn = document.getElementById('triggerNativeKeyboardBtn');
    const hiddenKeyboardInput = document.getElementById('hiddenKeyboardInput');

    const ctx = screenCanvas.getContext('2d', { alpha: false });

    // Connection State
    let ws = null;
    let isConnected = false;
    let targetHost = '';
    let targetPort = 5859;
    let myDetectedIp = '';
    let lastPingTs = 0;
    let rttMs = 0;
    let frameCount = 0;
    let currentFps = 60;
    let lastFpsCalc = Date.now();
    let pingInterval = null;
    let isRendering = false;
    let activeModifiers = { Control_L: false, Alt_L: false, Shift_L: false };
    const discoveredIps = new Set();

    // Touch gesture tracking
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let isLongPress = false;
    let longPressTimer = null;
    let lastTapTime = 0;
    let initialTouchDistance = 0;
    let isTrackpadMode = false;
    let virtualMouseX = 0.5;
    let virtualMouseY = 0.5;
    let prevTouchClientX = 0;
    let prevTouchClientY = 0;

    // Load saved settings
    const savedAddress = localStorage.getItem('dogremote_last_addr') || '';
    if (savedAddress) remoteAddressInput.value = savedAddress;

    const savedHostPwd = localStorage.getItem('dogremote_host_pwd') || '';
    if (savedHostPwd) hostPasswordInput.value = savedHostPwd;

    // Toast helper
    function showToast(message, duration = 2500) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    // WebRTC Local IP Detection (Zero-cloud, works 100% offline inside Android WebView)
    function detectLocalIp() {
        try {
            const pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)({ iceServers: [] });
            pc.createDataChannel('ip-probe');
            pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
            pc.onicecandidate = (event) => {
                if (!event || !event.candidate || !event.candidate.candidate) return;
                const match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
                if (match && match[1] && !match[1].startsWith('127.') && match[1] !== '0.0.0.0') {
                    myDetectedIp = match[1];
                    localIpText.textContent = `${myDetectedIp} (Wi-Fi)`;
                    try { pc.close(); } catch(e) {}
                }
            };
        } catch (e) {
            console.warn('WebRTC IP probe unavailable:', e);
        }
    }
    detectLocalIp();

    // IP Address Parsing
    function parseAddress(raw) {
        const cleaned = raw.replace(/\s+/g, '').trim();
        if (/^\d{9,12}$/.test(cleaned)) {
            const parts = cleaned.match(/.{1,3}/g);
            if (parts && parts.length === 4) {
                return parts.map(p => parseInt(p, 10)).join('.');
            }
        }
        return cleaned;
    }

    // Client PIN Visibility Toggle
    togglePinVisibilityBtn.addEventListener('click', () => {
        if (remotePinInput.type === 'password') {
            remotePinInput.type = 'text';
            togglePinVisibilityBtn.textContent = 'Hide';
        } else {
            remotePinInput.type = 'password';
            togglePinVisibilityBtn.textContent = 'Show';
        }
    });

    // Modal PIN Visibility Toggle
    modalToggleMaskBtn.addEventListener('click', () => {
        if (modalPasswordInput.type === 'password') {
            modalPasswordInput.type = 'text';
            modalToggleMaskBtn.textContent = 'Hide';
        } else {
            modalPasswordInput.type = 'password';
            modalToggleMaskBtn.textContent = 'Show';
        }
    });

    // Host Password Controls
    toggleHostMaskBtn.addEventListener('click', () => {
        if (hostPasswordInput.type === 'password') {
            hostPasswordInput.type = 'text';
            toggleHostMaskBtn.textContent = 'Hide';
        } else {
            hostPasswordInput.type = 'password';
            toggleHostMaskBtn.textContent = 'Show';
        }
    });

    generateNewPwdBtn.addEventListener('click', () => {
        const newPwd = Math.floor(100000 + Math.random() * 900000).toString();
        hostPasswordInput.value = newPwd;
        localStorage.setItem('dogremote_host_pwd', newPwd);
        generateNewPwdBtn.textContent = 'Done!';
        showToast(`Generated New Password: ${newPwd}`);
        setTimeout(() => generateNewPwdBtn.textContent = 'New', 1200);
    });

    copyHostPwdBtn.addEventListener('click', () => {
        const pwd = hostPasswordInput.value.trim();
        if (pwd && navigator.clipboard) {
            navigator.clipboard.writeText(pwd).then(() => {
                copyHostPwdBtn.textContent = 'Copied!';
                showToast('Host Password Copied!');
                setTimeout(() => copyHostPwdBtn.textContent = 'Copy', 1500);
            });
        }
    });

    hostPasswordInput.addEventListener('input', () => {
        localStorage.setItem('dogremote_host_pwd', hostPasswordInput.value.trim());
    });

    requirePasswordCheckbox.addEventListener('change', () => {
        const enabled = requirePasswordCheckbox.checked;
        hostPasswordInput.disabled = !enabled;
        toggleHostMaskBtn.disabled = !enabled;
        generateNewPwdBtn.disabled = !enabled;
        copyHostPwdBtn.disabled = !enabled;
        showToast(enabled ? 'Password Protection Enabled' : 'Password Protection Disabled');
    });

    // Copy IP button
    copyIpBtn.addEventListener('click', () => {
        const ip = localIpText.textContent.replace('(Wi-Fi)', '').replace('(Local)', '').trim();
        if (ip && !ip.includes('Detecting')) {
            navigator.clipboard.writeText(ip).then(() => showToast('IP Address Copied!'));
        }
    });

    // Connect Button Click
    connectBtn.addEventListener('click', () => {
        const rawAddr = remoteAddressInput.value.trim();
        const portStr = remotePortInput.value.trim();
        const pin = remotePinInput.value.trim();

        if (!rawAddr) {
            showToast('Please enter a Host Address');
            remoteAddressInput.focus();
            return;
        }

        targetHost = parseAddress(rawAddr);
        targetPort = parseInt(portStr, 10) || 5859;
        localStorage.setItem('dogremote_last_addr', rawAddr);
        startConnection(targetHost, targetPort, pin);
    });

    // WebSocket Connection
    function startConnection(host, port, password) {
        if (ws) {
            try { ws.close(); } catch (e) {}
            ws = null;
        }

        targetHost = host;
        targetPort = port;

        showToast(`Connecting to ${host}:${port}...`);
        connectBtn.disabled = true;
        connectBtn.querySelector('span').textContent = 'Connecting...';

        const wsUrl = `ws://${host}:${port}`;
        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
            if (!isConnected) {
                try { ws.close(); } catch (e) {}
                onConnectionFailed('Connection timed out. Check IP and Wi-Fi.');
            }
        }, 5000);

        ws.onopen = () => {
            // Handshake with password and control
            ws.send(JSON.stringify({
                name: 'DogRemote Mobile Client',
                password: password,
                control: requestControlCheckbox.checked
            }));

            // Initial quality preset
            const qIdx = parseInt(clientQualitySelect.value, 10) || 0;
            ws.send(JSON.stringify({
                type: 'set_quality',
                quality_index: qIdx
            }));
        };

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                handleFrameData(event.data);
                return;
            }

            try {
                const msg = JSON.parse(event.data);
                handleJsonMessage(msg, connectTimeout);
            } catch (e) {
                console.error('Protocol parse error:', e);
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
                closeAuthModal();
                if (msg.client_ip && !msg.client_ip.startsWith('127.')) {
                    myDetectedIp = msg.client_ip;
                    localIpText.textContent = `${myDetectedIp} (Wi-Fi)`;
                }
                onConnected(msg);
            } else {
                onConnectionFailed(msg.reason || 'Connection rejected by host.');
            }
        } else if (msg.type === 'pong') {
            const now = Date.now();
            const rawRtt = Math.max(1, now - (msg.client_ts || lastPingTs));
            rttMs = rttMs > 0 ? (rttMs * 0.75 + rawRtt * 0.25) : rawRtt;
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
        connectBtn.querySelector('span').textContent = 'Connect & Control';
        statusBadge.innerHTML = '<span class="status-dot"></span> Streaming Active';
        statusBadge.className = 'status-badge status-connected';

        // Switch to Viewer View
        dashboardView.style.display = 'none';
        viewerView.style.display = 'flex';

        // Populate Screen switcher
        populateScreens(info.screens || [], info.active_screen || 0);

        // Send immediate ping
        sendPing();
        pingInterval = setInterval(sendPing, 1000);

        showToast('Connected to Host!');
    }

    // Connection Failure Handler (Pops up Password Modal when password is required or wrong)
    function onConnectionFailed(reason) {
        isConnected = false;
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = 'Connect & Control';
        statusBadge.innerHTML = '<span class="status-dot" style="background:#ef4444;"></span> Connection Failed';
        statusBadge.className = 'status-badge';
        statusBadge.style.color = '#ef4444';

        if (reason === 'PASSWORD_INCORRECT' || reason === 'PASSWORD_REQUIRED') {
            openAuthModal(reason === 'PASSWORD_INCORRECT');
        } else {
            showToast(`Connection Failed: ${reason}`);
        }
    }

    // Disconnect Handler
    function onDisconnected() {
        isConnected = false;
        clearInterval(pingInterval);
        connectBtn.disabled = false;
        connectBtn.querySelector('span').textContent = 'Connect & Control';
        statusBadge.innerHTML = '<span class="status-dot"></span> Ready to Connect';
        statusBadge.className = 'status-badge status-ready';
        statusBadge.style.color = '';

        viewerView.style.display = 'none';
        dashboardView.style.display = 'flex';

        showToast('Session Disconnected');
    }

    // Authentication Prompt Modal (Direct popup for password)
    function openAuthModal(isIncorrect = false) {
        authModalSubtitle.innerHTML = isIncorrect
            ? `<span style="color:#ef4444; font-weight:bold;">Incorrect Password!</span> Please try again for <b>${targetHost}:${targetPort}</b>:`
            : `The host at <b>${targetHost}:${targetPort}</b> requires a security password:`;
        
        modalPasswordInput.value = remotePinInput.value;
        authModal.style.display = 'flex';
        modalPasswordInput.focus();
    }

    function closeAuthModal() {
        authModal.style.display = 'none';
    }

    modalCancelBtn.addEventListener('click', closeAuthModal);

    modalConnectBtn.addEventListener('click', () => {
        const entered = modalPasswordInput.value.trim();
        remotePinInput.value = entered;
        closeAuthModal();
        startConnection(targetHost, targetPort, entered);
    });

    // Send Ping
    function sendPing() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            lastPingTs = Date.now();
            ws.send(JSON.stringify({ type: 'ping', ts: lastPingTs }));
        }
    }

    // Screen Frame Decoding & Rendering (Zero-Lag Direct Blob Decode)
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
        const msDisplay = rttMs > 0 ? Math.round(rttMs) : 1;
        hudLatencyText.textContent = `${msDisplay} ms • ${currentFps} FPS`;
    }

    // Populate Screens Dropdown
    function populateScreens(screens, activeIdx) {
        screenSelect.innerHTML = '';
        if (!screens || screens.length === 0) {
            const opt = document.createElement('option');
            opt.value = '0';
            opt.textContent = 'Screen 1';
            screenSelect.appendChild(opt);
            return;
        }

        screens.forEach((sc, idx) => {
            const opt = document.createElement('option');
            opt.value = idx.toString();
            opt.textContent = `${sc.name || 'Screen ' + (idx + 1)}`;
            if (idx === activeIdx) opt.selected = true;
            screenSelect.appendChild(opt);
        });
    }

    // Display Switcher Change Event
    screenSelect.addEventListener('change', () => {
        const idx = parseInt(screenSelect.value, 10);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_screen', screen_index: idx }));
            showToast(`Switching to ${screenSelect.options[screenSelect.selectedIndex].text}...`);
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

    // Touch & Trackpad Event Handling
    function getNormalizedCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const nx = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
        const ny = Math.max(0, Math.min(1, (clientY - rect.top) / (rect.height || 1)));
        return { nx, ny };
    }

    screenCanvas.addEventListener('touchstart', (e) => {
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;
        
        if (e.touches.length === 1) {
            touchStartTime = Date.now();
            prevTouchClientX = e.touches[0].clientX;
            prevTouchClientY = e.touches[0].clientY;
            const { nx, ny } = getNormalizedCoords(e);
            touchStartX = nx;
            touchStartY = ny;
            isLongPress = false;

            if (!isTrackpadMode) {
                virtualMouseX = nx;
                virtualMouseY = ny;
                sendMouseMove(nx, ny);
            }

            longPressTimer = setTimeout(() => {
                isLongPress = true;
                const targetX = isTrackpadMode ? virtualMouseX : touchStartX;
                const targetY = isTrackpadMode ? virtualMouseY : touchStartY;
                sendMouseClick('right', 'click', targetX, targetY);
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
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;

            if (isTrackpadMode) {
                const rect = screenCanvas.getBoundingClientRect();
                const deltaX = (clientX - prevTouchClientX) / (rect.width || 1);
                const deltaY = (clientY - prevTouchClientY) / (rect.height || 1);
                prevTouchClientX = clientX;
                prevTouchClientY = clientY;

                virtualMouseX = Math.max(0, Math.min(1, virtualMouseX + deltaX * 1.5));
                virtualMouseY = Math.max(0, Math.min(1, virtualMouseY + deltaY * 1.5));

                clearTimeout(longPressTimer);
                sendMouseMove(virtualMouseX, virtualMouseY);
            } else {
                const { nx, ny } = getNormalizedCoords(e);
                const dist = Math.hypot(nx - touchStartX, ny - touchStartY);
                if (dist > 0.015) {
                    clearTimeout(longPressTimer);
                }
                virtualMouseX = nx;
                virtualMouseY = ny;
                sendMouseMove(nx, ny);
            }
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
            const duration = Date.now() - touchStartTime;
            let movedDist = 0;
            let clickX = virtualMouseX;
            let clickY = virtualMouseY;

            if (isTrackpadMode) {
                const clientX = e.changedTouches[0].clientX;
                const clientY = e.changedTouches[0].clientY;
                movedDist = Math.hypot(clientX - prevTouchClientX, clientY - prevTouchClientY);
            } else {
                const { nx, ny } = getNormalizedCoords(e.changedTouches[0]);
                movedDist = Math.hypot(nx - touchStartX, ny - touchStartY);
                clickX = nx;
                clickY = ny;
            }

            if ((isTrackpadMode && duration < 250) || (!isTrackpadMode && movedDist < 0.02 && duration < 300)) {
                const now = Date.now();
                if (now - lastTapTime < 280) {
                    sendMouseClick('left', 'dblclick', clickX, clickY);
                    lastTapTime = 0;
                } else {
                    sendMouseClick('left', 'click', clickX, clickY);
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
                activeModifiers[keyName] = !activeModifiers[keyName];
                btn.classList.toggle('active', activeModifiers[keyName]);
                sendKey(keyName, activeModifiers[keyName] ? 'down' : 'up');
            } else {
                sendKey(keyName, 'key');
            }
        });
    });

    // Native Mobile Keyboard Integration (Prominent button on the far left)
    triggerNativeKeyboardBtn.addEventListener('click', () => {
        hiddenKeyboardInput.focus();
        showToast('Keyboard Active');
    });

    if (toggleTouchModeBtn) {
        toggleTouchModeBtn.addEventListener('click', () => {
            isTrackpadMode = !isTrackpadMode;
            if (isTrackpadMode) {
                touchModeLabel.textContent = '🖱️ Mouse';
                toggleTouchModeBtn.classList.add('active-trackpad');
                showToast('Mouse Trackpad Mode Active');
            } else {
                touchModeLabel.textContent = '👆 Touch';
                toggleTouchModeBtn.classList.remove('active-trackpad');
                showToast('Direct Touch Mode Active');
            }
        });
    }

    hiddenKeyboardInput.addEventListener('input', () => {
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

    // Subnet Scanner with Deduplication and Dynamic Ping
    function discoverLocalDevices() {
        discoveredList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
                </div>
                <div class="empty-title">Scanning Local Wi-Fi Subnet...</div>
                <div class="empty-desc">Probing active DogRemote hosts...</div>
            </div>
        `;

        discoveredIps.clear();

        // Subnet candidates
        const subnetBase = (myDetectedIp && myDetectedIp.includes('.')) 
            ? myDetectedIp.substring(0, myDetectedIp.lastIndexOf('.')) 
            : '192.168.8';
        const candidates = [
            '192.168.8.185',
            '192.168.8.194',
            '192.168.1.100',
            '192.168.0.100'
        ];

        // Add nearby IP candidates from detected subnet
        for (let i = 180; i <= 195; i++) {
            const ip = `${subnetBase}.${i}`;
            if (!candidates.includes(ip) && ip !== myDetectedIp) {
                candidates.push(ip);
            }
        }

        let foundAny = false;
        let checked = 0;

        candidates.forEach(ip => {
            // Strictly skip self and loopback
            if (ip === myDetectedIp || ip === 'localhost' || ip === '127.0.0.1') {
                checked++;
                return;
            }

            const probeStart = Date.now();
            const probeWs = new WebSocket(`ws://${ip}:5859`);
            
            const probeTimeout = setTimeout(() => {
                try { probeWs.close(); } catch(e) {}
                checkDone();
            }, 1000);

            probeWs.onopen = () => {
                clearTimeout(probeTimeout);
                foundAny = true;
                const dynamicPing = Math.max(1, Date.now() - probeStart);
                addDiscoveredCard(ip, 'DogRemote Host', `${dynamicPing} ms`);
                try { probeWs.close(); } catch(e) {}
                checkDone();
            };

            probeWs.onerror = () => {
                clearTimeout(probeTimeout);
                checkDone();
            };

            function checkDone() {
                checked++;
                if (checked >= candidates.length && !foundAny) {
                    discoveredList.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon">
                                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            </div>
                            <div class="empty-title">No Hosts Auto-Detected</div>
                            <div class="empty-desc">Enter your host IP address directly in the Remote Connection box above.</div>
                        </div>
                    `;
                }
            }
        });
    }

    // Add Discovered Host Card (Strictly one card per unique IP)
    function addDiscoveredCard(ip, name, pingStr) {
        if (discoveredIps.has(ip)) return;
        discoveredIps.add(ip);

        if (discoveredList.querySelector('.empty-state')) {
            discoveredList.innerHTML = '';
        }

        const card = document.createElement('div');
        card.className = 'device-card';
        card.innerHTML = `
            <div class="device-info-left">
                <div class="device-name">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    <span>${name}</span>
                </div>
                <div class="device-ip">${ip}:5859 • <span style="color:#34d399; font-weight:700;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" style="display:inline-block; vertical-align:middle;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> ${pingStr}</span></div>
            </div>
            <button type="button" class="btn-secondary btn-xs connect-quick-btn">
                <span>Connect</span>
            </button>
        `;

        // Direct connect on click: connects immediately, prompting password popup if host requires one!
        card.querySelector('.connect-quick-btn').addEventListener('click', () => {
            remoteAddressInput.value = ip;
            remotePortInput.value = '5859';
            showToast(`Connecting to ${ip}...`);
            startConnection(ip, 5859, remotePinInput.value.trim());
        });

        discoveredList.appendChild(card);
    }

    refreshDiscoveryBtn.addEventListener('click', discoverLocalDevices);

    // Initial Run
    discoverLocalDevices();

})();
