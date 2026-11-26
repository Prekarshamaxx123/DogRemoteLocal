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
    const hostPinDisplay = document.getElementById('hostPinDisplay');
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
    const touchModeIconWrap = document.getElementById('touchModeIconWrap');
    const touchModeLabel = document.getElementById('touchModeLabel');
    const hudFullscreenBtn = document.getElementById('hudFullscreenBtn');
    const hudDisconnectBtn = document.getElementById('hudDisconnectBtn');
    const screenCanvas = document.getElementById('screenCanvas');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const virtualCursor = document.getElementById('virtualCursor');
    const virtualKeyToolbar = document.getElementById('virtualKeyToolbar');
    const triggerNativeKeyboardBtn = document.getElementById('triggerNativeKeyboardBtn');
    const hiddenKeyboardInput = document.getElementById('hiddenKeyboardInput');

    // Phone Screen Share Button
    const sharePhoneScreenBtn = document.getElementById('sharePhoneScreenBtn');
    const sharePhoneBtnText = document.getElementById('sharePhoneBtnText');
    let isPhoneSharing = false;

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
    const discoveredHosts = new Map(); // ip -> { name, pingStr, lastSeen }

    // Touch, Trackpad & Zoom tracking
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let startTouchClientX = 0;
    let startTouchClientY = 0;
    let isLongPress = false;
    let isTouchDragging = false;
    let longPressTimer = null;
    let lastTapTime = 0;
    let isTrackpadMode = false;
    let trackpadLastTapTime = 0;
    let trackpadIsDragging = false;
    let virtualMouseX = 0.5;
    let virtualMouseY = 0.5;
    let prevTouchClientX = 0;
    let prevTouchClientY = 0;
    let twoFingerStartTime = 0;
    let twoFingerMoved = false;

    // Pinch-to-zoom & Pan state
    let currentZoom = 1.0;
    let panX = 0;
    let panY = 0;
    let pinchStartDist = 0;
    let pinchStartZoom = 1.0;
    let isPinching = false;
    let twoFingerPrevMidY = 0;

    // Load saved settings
    const savedAddress = localStorage.getItem('dogremote_last_addr') || '';
    if (savedAddress && !savedAddress.startsWith('26.') && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(savedAddress)) {
        remoteAddressInput.value = savedAddress;
    } else {
        remoteAddressInput.value = '192.168.8.185';
    }
    remotePinInput.value = '';

    const savedHostPwd = localStorage.getItem('dogremote_host_pwd') || '';
    if (savedHostPwd) hostPasswordInput.value = savedHostPwd;

    function updateHostPinDisplay() {
        if (!hostPinDisplay) return;
        const req = requirePasswordCheckbox ? requirePasswordCheckbox.checked : true;
        const pwd = hostPasswordInput ? hostPasswordInput.value.trim() : '';
        if (!req) {
            hostPinDisplay.textContent = 'None';
            hostPinDisplay.style.color = '#94a3b8';
        } else {
            hostPinDisplay.textContent = pwd || '------';
            hostPinDisplay.style.color = '#38bdf8';
        }
    }

    function syncHostSecurityToNative() {
        const pwd = hostPasswordInput ? hostPasswordInput.value.trim() : '';
        const req = requirePasswordCheckbox ? requirePasswordCheckbox.checked : true;
        const allowCtrl = allowRemoteControlCheckbox ? allowRemoteControlCheckbox.checked : true;
        localStorage.setItem('dogremote_host_pwd', pwd);
        updateHostPinDisplay();
        if (window.DogRemoteNativeBridge) {
            if (window.DogRemoteNativeBridge.setHostSecurity) {
                try {
                    window.DogRemoteNativeBridge.setHostSecurity(pwd, req, allowCtrl);
                } catch (e) {
                    console.warn('Native bridge setHostSecurity error:', e);
                }
            } else if (window.DogRemoteNativeBridge.setHostPassword) {
                try {
                    window.DogRemoteNativeBridge.setHostPassword(pwd, req);
                } catch (e) {}
            }
        }
    }

    // Read host security from native bridge if in Android app
    if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.getHostPassword) {
        try {
            const nativeHostPwd = window.DogRemoteNativeBridge.getHostPassword();
            const nativeReq = window.DogRemoteNativeBridge.isPasswordRequired();
            const nativeCtrl = (window.DogRemoteNativeBridge.isControlAllowed) ? window.DogRemoteNativeBridge.isControlAllowed() : true;
            if (nativeHostPwd) {
                hostPasswordInput.value = nativeHostPwd;
                localStorage.setItem('dogremote_host_pwd', nativeHostPwd);
            }
            if (typeof nativeReq === 'boolean' && requirePasswordCheckbox) {
                requirePasswordCheckbox.checked = nativeReq;
                hostPasswordInput.disabled = !nativeReq;
                toggleHostMaskBtn.disabled = !nativeReq;
                generateNewPwdBtn.disabled = !nativeReq;
                copyHostPwdBtn.disabled = !nativeReq;
            }
            if (typeof nativeCtrl === 'boolean' && allowRemoteControlCheckbox) {
                allowRemoteControlCheckbox.checked = nativeCtrl;
            }
        } catch (e) {
            console.warn('Native bridge getHostPassword error:', e);
        }
    }
    updateHostPinDisplay();

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
                if (match && match[1] && !match[1].startsWith('127.') && match[1] !== '0.0.0.0' && !match[1].startsWith('26.')) {
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
        syncHostSecurityToNative();
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
        syncHostSecurityToNative();
    });

    requirePasswordCheckbox.addEventListener('change', () => {
        const enabled = requirePasswordCheckbox.checked;
        hostPasswordInput.disabled = !enabled;
        toggleHostMaskBtn.disabled = !enabled;
        generateNewPwdBtn.disabled = !enabled;
        copyHostPwdBtn.disabled = !enabled;
        syncHostSecurityToNative();
        showToast(enabled ? 'Password Protection Enabled' : 'Password Protection Disabled');
    });

    if (allowRemoteControlCheckbox) {
        allowRemoteControlCheckbox.addEventListener('change', () => {
            syncHostSecurityToNative();
        });
    }

    // Copy IP button
    copyIpBtn.addEventListener('click', () => {
        const ip = localIpText.textContent.replace('(Wi-Fi)', '').replace('(Local)', '').trim();
        if (ip && !ip.includes('Detecting')) {
            navigator.clipboard.writeText(ip).then(() => showToast('IP Address Copied!'));
        }
    });

    // Connect Button Handling (Instant 1-tap with keyboard active)
    let lastMainConnectTime = 0;
    function triggerMainConnect(e) {
        if (e && e.type === 'touchstart') {
            e.preventDefault();
        }
        const now = Date.now();
        if (now - lastMainConnectTime < 500) return;
        lastMainConnectTime = now;

        const rawAddr = remoteAddressInput.value.trim();
        const portStr = remotePortInput.value.trim();
        const pin = remotePinInput.value.trim();

        if (!rawAddr) {
            showToast('Please enter a Host Address');
            remoteAddressInput.focus();
            return;
        }

        remoteAddressInput.blur();
        remotePinInput.blur();
        targetHost = parseAddress(rawAddr);
        targetPort = parseInt(portStr, 10) || 5859;
        localStorage.setItem('dogremote_last_addr', rawAddr);
        startConnection(targetHost, targetPort, pin);
    }

    connectBtn.addEventListener('pointerdown', triggerMainConnect);
    connectBtn.addEventListener('touchstart', triggerMainConnect, { passive: false });
    connectBtn.addEventListener('click', triggerMainConnect);

    remotePinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            triggerMainConnect(e);
        }
    });
    remoteAddressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            triggerMainConnect(e);
        }
    });

    // WebSocket Connection
    function startConnection(host, port, password) {
        if (ws) {
            try { ws.close(); } catch (e) {}
            ws = null;
        }

        targetHost = host;
        targetPort = port;
        isScanningLocal = false;
        if (refreshDiscoveryBtn) refreshDiscoveryBtn.classList.remove('rotating');

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
        statusBadge.innerHTML = `<span class="status-dot" style="background:#34d399; box-shadow:0 0 8px #34d399;"></span> Connected: ${targetHost}`;
        statusBadge.className = 'status-badge status-connected';

        // Switch to Viewer View
        dashboardView.style.display = 'none';
        viewerView.style.display = 'flex';

        // Populate Screen switcher
        populateScreens(info.screens || [], info.active_screen || 0);

        // Initialize virtual cursor at center with immediate visibility
        virtualMouseX = 0.5;
        virtualMouseY = 0.5;
        setTimeout(updateVirtualCursor, 150);

        // Send immediate ping
        sendPing();
        pingInterval = setInterval(sendPing, 1000);

        showToast(`Connected to Host (${targetHost})!`);
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

    let lastModalSubmitTime = 0;
    function submitAuthModal(e) {
        if (e && e.type === 'touchstart') {
            e.preventDefault();
        }
        const now = Date.now();
        if (now - lastModalSubmitTime < 500) return;
        lastModalSubmitTime = now;

        const entered = modalPasswordInput.value.trim();
        remotePinInput.value = entered;
        modalPasswordInput.blur();
        closeAuthModal();
        startConnection(targetHost, targetPort, entered);
    }

    modalConnectBtn.addEventListener('pointerdown', submitAuthModal);
    modalConnectBtn.addEventListener('touchstart', submitAuthModal, { passive: false });
    modalConnectBtn.addEventListener('click', submitAuthModal);

    modalCancelBtn.addEventListener('pointerdown', (e) => {
        if (e && e.type === 'touchstart') e.preventDefault();
        closeAuthModal();
    });
    modalCancelBtn.addEventListener('click', closeAuthModal);

    modalPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            submitAuthModal(e);
        }
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
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
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
        if (!hudLatencyText) return;
        const hostLabel = targetHost ? `${targetHost} • ` : '';
        const msDisplay = rttMs > 0 ? Math.round(rttMs) : 1;
        hudLatencyText.textContent = `${hostLabel}${msDisplay} ms • ${currentFps} FPS`;
    }

    // Populate Screens Dropdown
    function populateScreens(screens, activeIdx) {
        screenSelect.innerHTML = '';
        if (!screens || screens.length === 0) {
            const opt = document.createElement('option');
            opt.value = '0';
            opt.textContent = 'Display 1';
            screenSelect.appendChild(opt);
            return;
        }

        screens.forEach((sc, idx) => {
            const opt = document.createElement('option');
            const screenId = (sc.id !== undefined) ? sc.id : idx;
            opt.value = screenId.toString();
            opt.textContent = `${sc.name || 'Display ' + (idx + 1)}`;
            if (screenId === activeIdx) opt.selected = true;
            screenSelect.appendChild(opt);
        });
    }

    // Display Switcher Change Event
    screenSelect.addEventListener('change', () => {
        const screenId = parseInt(screenSelect.value, 10);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'set_screen', screen_index: screenId }));
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

    // Canvas Zoom & Pan Transform
    function updateCanvasTransform() {
        if (currentZoom <= 1.0) {
            currentZoom = 1.0;
            panX = 0;
            panY = 0;
            screenCanvas.style.transform = '';
        } else {
            const maxPanX = (window.innerWidth * (currentZoom - 1)) / 1.8;
            const maxPanY = (window.innerHeight * (currentZoom - 1)) / 1.8;
            panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
            panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
            screenCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
        }
        updateVirtualCursor();
    }

    // Virtual Cursor Overlay (Zero-Lag Hardware Accelerated Pointer)
    function updateVirtualCursor() {
        if (!virtualCursor || !isConnected) {
            if (virtualCursor) virtualCursor.style.display = 'none';
            return;
        }
        const rect = screenCanvas.getBoundingClientRect();
        const wrapRect = canvasWrapper.getBoundingClientRect();
        const x = rect.left - wrapRect.left + virtualMouseX * rect.width;
        const y = rect.top - wrapRect.top + virtualMouseY * rect.height;
        virtualCursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        virtualCursor.style.display = 'block';
    }

    // Touch & Trackpad Event Handling
    function getNormalizedCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        const touch = (e.touches && e.touches.length > 0) ? e.touches[0] : ((e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : e);
        const clientX = touch.clientX;
        const clientY = touch.clientY;

        const nx = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
        const ny = Math.max(0, Math.min(1, (clientY - rect.top) / (rect.height || 1)));
        return { nx, ny };
    }

    // Listen on canvasWrapper: Enables mouse control on the entire screen (including top/bottom black bars!)
    canvasWrapper.addEventListener('touchstart', (e) => {
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;
        
        if (e.touches.length === 1) {
            touchStartTime = Date.now();
            startTouchClientX = e.touches[0].clientX;
            startTouchClientY = e.touches[0].clientY;
            prevTouchClientX = startTouchClientX;
            prevTouchClientY = startTouchClientY;
            const { nx, ny } = getNormalizedCoords(e);
            touchStartX = nx;
            touchStartY = ny;
            isLongPress = false;
            isTouchDragging = false;

            if (isTrackpadMode) {
                // In trackpad mode: check for double-tap-and-hold to start dragging
                const timeSinceLastTap = Date.now() - trackpadLastTapTime;
                if (timeSinceLastTap < 500) {
                    trackpadIsDragging = true;
                    sendMouseClick('left', 'down', virtualMouseX, virtualMouseY);
                    if (navigator.vibrate) navigator.vibrate(35);
                }
                updateVirtualCursor();
            } else {
                virtualMouseX = nx;
                virtualMouseY = ny;
                updateVirtualCursor();
            }

            longPressTimer = setTimeout(() => {
                if (!trackpadIsDragging && !isTouchDragging) {
                    isLongPress = true;
                    if (navigator.vibrate) navigator.vibrate(35);
                }
            }, 420);
        } else if (e.touches.length === 2) {
            clearTimeout(longPressTimer);
            if (isTouchDragging) {
                sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
                isTouchDragging = false;
            }
            if (trackpadIsDragging) {
                sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
                trackpadIsDragging = false;
            }
            isPinching = false;
            twoFingerStartTime = Date.now();
            twoFingerMoved = false;
            pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            pinchStartZoom = currentZoom;
            twoFingerPrevMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        }
    }, { passive: true });

    canvasWrapper.addEventListener('touchmove', (e) => {
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;

        if (e.touches.length === 1) {
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;
            const moveDistPx = Math.hypot(clientX - startTouchClientX, clientY - startTouchClientY);

            if (isTrackpadMode) {
                const rect = screenCanvas.getBoundingClientRect();
                const deltaX = (clientX - prevTouchClientX) / (rect.width || 1);
                const deltaY = (clientY - prevTouchClientY) / (rect.height || 1);
                prevTouchClientX = clientX;
                prevTouchClientY = clientY;

                virtualMouseX = Math.max(0, Math.min(1, virtualMouseX + deltaX * 1.5));
                virtualMouseY = Math.max(0, Math.min(1, virtualMouseY + deltaY * 1.5));

                if (moveDistPx > 14) {
                    clearTimeout(longPressTimer);
                    if (isLongPress && !trackpadIsDragging) {
                        // Long-press then move -> press left button and drag!
                        isLongPress = false;
                        trackpadIsDragging = true;
                        sendMouseClick('left', 'down', virtualMouseX, virtualMouseY);
                    }
                }

                sendMouseMove(virtualMouseX, virtualMouseY);
                updateVirtualCursor();
            } else {
                if (currentZoom > 1.05 && e.touches.length === 2) {
                    // Zoom pan handled in 2-finger mode
                } else {
                    const { nx, ny } = getNormalizedCoords(e);
                    if (moveDistPx > 8) {
                        clearTimeout(longPressTimer);
                        isLongPress = false;
                        if (!isTouchDragging) {
                            isTouchDragging = true;
                            // Instant Left Mouse Down at touch origin to initiate drag and drop!
                            sendMouseClick('left', 'down', touchStartX, touchStartY);
                        }
                    }
                    virtualMouseX = nx;
                    virtualMouseY = ny;
                    if (isTouchDragging) {
                        sendMouseMove(nx, ny);
                    }
                }
            }
        } else if (e.touches.length === 2) {
            const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const currentMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const distDelta = Math.abs(currentDist - pinchStartDist);
            const midYDelta = currentMidY - twoFingerPrevMidY;

            if (distDelta > 15) {
                // Pinch-to-zoom
                isPinching = true;
                twoFingerMoved = true;
                currentZoom = Math.min(4.0, Math.max(1.0, pinchStartZoom * (currentDist / (pinchStartDist || 1))));
                if (currentZoom === 1.0) { panX = 0; panY = 0; }
                updateCanvasTransform();
            } else if (!isPinching && Math.abs(midYDelta) > 8) {
                // Fixed two-finger vertical scroll
                twoFingerMoved = true;
                const steps = midYDelta > 0 ? 2 : -2;
                sendScroll(steps);
                twoFingerPrevMidY = currentMidY;
            }
        }
    }, { passive: true });

    canvasWrapper.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;

        // Two-finger tap -> Right Click
        if (e.touches.length === 0 && twoFingerStartTime > 0 && !twoFingerMoved && !isPinching && (Date.now() - twoFingerStartTime) < 320) {
            twoFingerStartTime = 0;
            sendMouseClick('right', 'click', virtualMouseX, virtualMouseY);
            if (navigator.vibrate) navigator.vibrate(30);
            return;
        }
        if (e.touches.length === 0) {
            twoFingerStartTime = 0;
        }

        if (e.changedTouches.length === 1 && !isPinching) {
            const clientX = e.changedTouches[0].clientX;
            const clientY = e.changedTouches[0].clientY;
            const moveDistPx = Math.hypot(clientX - startTouchClientX, clientY - startTouchClientY);
            const duration = Date.now() - touchStartTime;

            if (isTrackpadMode) {
                if (trackpadIsDragging) {
                    sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
                    trackpadIsDragging = false;
                    trackpadLastTapTime = 0;
                } else if (isLongPress && moveDistPx < 14) {
                    sendMouseClick('right', 'click', virtualMouseX, virtualMouseY);
                } else if (!isLongPress && duration < 420 && moveDistPx < 18) {
                    sendMouseClick('left', 'click', virtualMouseX, virtualMouseY);
                    trackpadLastTapTime = Date.now();
                }
            } else {
                const { nx, ny } = getNormalizedCoords(e.changedTouches[0]);
                if (isTouchDragging) {
                    // Release drag: Left Mouse Up at final drop coordinates
                    sendMouseClick('left', 'up', nx, ny);
                    isTouchDragging = false;
                } else if (isLongPress && moveDistPx < 14) {
                    // Long press release without moving -> Right Click!
                    sendMouseClick('right', 'click', touchStartX, touchStartY);
                } else if (duration < 400 && moveDistPx < 14) {
                    // Crisp single tap or double tap
                    const now = Date.now();
                    if (now - lastTapTime < 280) {
                        if (currentZoom > 1.0) {
                            currentZoom = 1.0;
                            panX = 0;
                            panY = 0;
                            updateCanvasTransform();
                            showToast('Zoom Reset');
                        } else {
                            sendMouseClick('left', 'dblclick', nx, ny);
                        }
                        lastTapTime = 0;
                    } else {
                        sendMouseClick('left', 'click', nx, ny);
                        lastTapTime = now;
                    }
                }
            }
        } else {
            if (isTouchDragging) {
                sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
                isTouchDragging = false;
            }
            if (trackpadIsDragging) {
                sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
                trackpadIsDragging = false;
            }
        }
    }, { passive: true });

    canvasWrapper.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer);
        twoFingerStartTime = 0;
        if (isTouchDragging) {
            sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
            isTouchDragging = false;
        }
        if (trackpadIsDragging) {
            sendMouseClick('left', 'up', virtualMouseX, virtualMouseY);
            trackpadIsDragging = false;
        }
    }, { passive: true });

    // Zero-lag throttled mouse move dispatcher
    let lastMouseMoveTime = 0;
    let pendingMouseMove = null;
    let mouseMoveTimer = null;

    function sendMouseMove(x, y) {
        // 1. Immediately update virtual cursor locally with 0ms latency
        virtualMouseX = x;
        virtualMouseY = y;
        updateVirtualCursor();

        // 2. Transmit to host throttled to max 60Hz to prevent queue lag and keep Wi-Fi smooth
        const now = performance.now();
        if (now - lastMouseMoveTime >= 16) {
            lastMouseMoveTime = now;
            if (mouseMoveTimer) {
                clearTimeout(mouseMoveTimer);
                mouseMoveTimer = null;
            }
            pendingMouseMove = null;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'mouse_move', x: x, y: y }));
            }
        } else {
            pendingMouseMove = { x, y };
            if (!mouseMoveTimer) {
                mouseMoveTimer = setTimeout(() => {
                    mouseMoveTimer = null;
                    if (pendingMouseMove && ws && ws.readyState === WebSocket.OPEN) {
                        lastMouseMoveTime = performance.now();
                        ws.send(JSON.stringify({ type: 'mouse_move', x: pendingMouseMove.x, y: pendingMouseMove.y }));
                        pendingMouseMove = null;
                    }
                }, 16);
            }
        }
    }

    // Direct pointermove support for external mouse or stylus
    canvasWrapper.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') {
            if (!requestControlCheckbox.checked || !ws || ws.readyState !== WebSocket.OPEN) return;
            const { nx, ny } = getNormalizedCoords(e);
            sendMouseMove(nx, ny);
        }
    }, { passive: true });

    function sendMouseClick(button, action, x, y) {
        if (mouseMoveTimer) {
            clearTimeout(mouseMoveTimer);
            mouseMoveTimer = null;
        }
        pendingMouseMove = null;
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
                if (touchModeIconWrap) {
                    touchModeIconWrap.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="7"></rect><line x1="12" y1="6" x2="12" y2="10"></line></svg>';
                }
                touchModeLabel.textContent = 'TRACKPAD';
                toggleTouchModeBtn.classList.add('active-trackpad');
                updateVirtualCursor();
                showToast('Trackpad Mode Active (Swipe anywhere / black bars)');
            } else {
                if (touchModeIconWrap) {
                    touchModeIconWrap.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-6 0v7a2 2 0 0 1-2 2h-.5a2.5 2.5 0 0 0 0 5H14a7 7 0 0 0 7-7v-3a2 2 0 0 0-4 0v2"/></svg>';
                }
                touchModeLabel.textContent = 'TOUCH';
                toggleTouchModeBtn.classList.remove('active-trackpad');
                updateVirtualCursor();
                showToast('Direct Touch Mode Active');
            }
        });
    }

    // Phone Screen Share Button Handler (Bidirectional Streaming)
    window.isPhoneSharing = false;
    window.setPhoneSharingState = function(active) {
        window.isPhoneSharing = active;
        if (sharePhoneScreenBtn) {
            if (active) {
                sharePhoneScreenBtn.classList.add('active-sharing');
                if (sharePhoneBtnText) sharePhoneBtnText.textContent = 'Stop Sharing Screen';
                if (statusBadge && !statusBadge.classList.contains('status-connected')) {
                    statusBadge.innerHTML = '<span class="status-dot" style="background:#8b5cf6;"></span> Sharing Active (0 Viewers)';
                    statusBadge.className = 'status-badge status-ready';
                }
            } else {
                sharePhoneScreenBtn.classList.remove('active-sharing');
                if (sharePhoneBtnText) sharePhoneBtnText.textContent = 'Start Sharing Screen';
                const hostBox = document.getElementById('hostClientStatusBox');
                if (hostBox) hostBox.style.display = 'none';
                if (statusBadge) {
                    statusBadge.innerHTML = '<span class="status-dot"></span> Ready to Connect';
                    statusBadge.className = 'status-badge status-ready';
                }

                // Immediately notify known PCs that phone is no longer sharing screen
                discoveredIps.forEach(ip => {
                    try {
                        const wsOff = new WebSocket(`ws://${ip}:5859`);
                        wsOff.onopen = () => {
                            try {
                                wsOff.send(JSON.stringify({
                                    type: 'peer_announce',
                                    name: window.myDeviceName || 'Samsung Mobile',
                                    ip: myDetectedIp || '',
                                    sharing: false
                                }));
                            } catch(e) {}
                            setTimeout(() => { try { wsOff.close(); } catch(e) {} }, 100);
                        };
                        wsOff.onerror = () => { try { wsOff.close(); } catch(e) {} };
                    } catch(e) {}
                });
            }
        }
    };

    // Live Connected Clients Notification from Android ScreenShareService
    window.hasHostClients = false;
    window.onHostClientsChanged = function(count, clientName, clientIp, joined) {
        window.hasHostClients = (count > 0);
        const hostBox = document.getElementById('hostClientStatusBox');
        const countText = document.getElementById('hostClientCountText');
        const nameText = document.getElementById('hostClientNameText');
        const ipText = document.getElementById('hostClientIpText');

        if (count > 0) {
            const displayName = clientName || 'Linux PC';
            const displayIp = clientIp || '';
            const ipSuffix = displayIp ? ` (${displayIp})` : '';

            if (statusBadge) {
                statusBadge.innerHTML = `<span class="status-dot" style="background:#34d399; box-shadow:0 0 8px #34d399;"></span> Connected: ${displayName}${ipSuffix}`;
                statusBadge.className = 'status-badge status-connected';
            }
            if (hostBox) {
                hostBox.style.display = 'block';
                if (countText) countText.textContent = `${count} Device${count > 1 ? 's' : ''} Connected`;
                if (nameText) nameText.textContent = `${displayName}`;
                if (ipText) ipText.textContent = `${displayIp ? displayIp + ':5859 • ' : ''}Live View & Control Active`;
            }
            if (joined) {
                showToast(`Device Connected: ${displayName}${ipSuffix}`);
            }
        } else {
            if (hostBox) {
                hostBox.style.display = 'none';
            }
            if (window.isPhoneSharing) {
                if (statusBadge) {
                    statusBadge.innerHTML = '<span class="status-dot" style="background:#8b5cf6;"></span> Sharing Active (0 Viewers)';
                    statusBadge.className = 'status-badge status-ready';
                }
            } else {
                if (statusBadge) {
                    statusBadge.innerHTML = '<span class="status-dot"></span> Ready to Connect';
                    statusBadge.className = 'status-badge status-ready';
                }
            }
            if (!joined && count === 0) {
                showToast('Remote Device Disconnected');
            }
        }
    };

    if (sharePhoneScreenBtn) {
        sharePhoneScreenBtn.addEventListener('click', () => {
            if (!window.isPhoneSharing) {
                showToast('Starting Phone Screen Share...');
                if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.isAccessibilityEnabled && !window.DogRemoteNativeBridge.isAccessibilityEnabled()) {
                    showToast('Note: Turn ON DogRemote in Accessibility Settings to allow PC touch control');
                }
                if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.startSharing) {
                    window.DogRemoteNativeBridge.startSharing();
                } else if (window.startPhoneScreenShare) {
                    window.startPhoneScreenShare();
                } else {
                    showToast('Screen share not supported on this platform');
                }
            } else {
                showToast('Stopping Phone Screen Share...');
                if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.stopSharing) {
                    window.DogRemoteNativeBridge.stopSharing();
                } else if (window.stopPhoneScreenShare) {
                    window.stopPhoneScreenShare();
                }
            }
        });
    }

    const enableA11yBtn = document.getElementById('enableA11yBtn');
    function checkAccessibilityStatus() {
        if (enableA11yBtn && window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.isAccessibilityEnabled) {
            const isEnabled = window.DogRemoteNativeBridge.isAccessibilityEnabled();
            if (isEnabled) {
                enableA11yBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style="color:#34d399; font-weight:700;">Remote Control Active</span>
                `;
                enableA11yBtn.style.borderColor = 'rgba(52, 211, 153, 0.45)';
                enableA11yBtn.style.background = 'rgba(16, 185, 129, 0.12)';
            } else {
                enableA11yBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
                    <span>Remote Control Permission</span>
                `;
                enableA11yBtn.style.borderColor = '';
                enableA11yBtn.style.background = '';
            }
        }
    }

    if (enableA11yBtn) {
        enableA11yBtn.addEventListener('click', () => {
            if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.openAccessibilitySettings) {
                showToast('Opening Accessibility Settings. Turn ON DogRemote to enable remote control.');
                window.DogRemoteNativeBridge.openAccessibilitySettings();
            } else {
                showToast('Enable DogRemote under Settings -> Accessibility -> Installed apps');
            }
        });
    }

    function checkInitialState() {
        checkAccessibilityStatus();
        if (window.DogRemoteNativeBridge && window.DogRemoteNativeBridge.getConnectedClientsInfo) {
            try {
                const infoStr = window.DogRemoteNativeBridge.getConnectedClientsInfo();
                const info = JSON.parse(infoStr);
                if (info.count > 0) {
                    window.onHostClientsChanged(info.count, 'Linux PC', '192.168.8.185', false);
                }
                if (info.sharing) {
                    window.setPhoneSharingState(true);
                }
            } catch(e) {}
        }
    }
    setTimeout(checkInitialState, 350);
    setInterval(checkAccessibilityStatus, 3000);

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

    // Subnet Scanner with Deduplication, Dynamic Ping & Share-State Gating
    window.onPeerDiscovered = function(ip, name, sharing = true) {
        if (!ip || ip === myDetectedIp || ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('26.')) return;
        if (name && (name.includes('Mobile') || name.includes('Phone') || name.toLowerCase().includes('samsung'))) return;
        if (sharing === false) {
            removeDiscoveredCard(ip);
            return;
        }
        addDiscoveredCard(ip, name || 'DogRemote Host', 'LAN UDP');
        if (!remoteAddressInput.value || remoteAddressInput.value.startsWith('26.')) {
            remoteAddressInput.value = ip;
        }
    };

    window.onPeerLost = function(ip) {
        removeDiscoveredCard(ip);
    };

    window.clearDiscoveredDevices = function(reason) {
        clearAllDiscovered(reason || 'Wi-Fi Disconnected');
    };

    window.addEventListener('offline', () => {
        clearAllDiscovered('Wi-Fi Disconnected');
        localIpText.textContent = 'Wi-Fi Disconnected';
    });

    let isScanningLocal = false;

    // Subnet Scanner with Deduplication and Dynamic Ping
    function discoverLocalDevices() {
        if (isScanningLocal || isConnected || (window.isPhoneSharing && window.hasHostClients)) return;
        isScanningLocal = true;
        if (refreshDiscoveryBtn) refreshDiscoveryBtn.classList.add('rotating');

        const existingCards = discoveredList.querySelectorAll('.device-card');
        if (existingCards.length === 0) {
            discoveredList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
                    </div>
                    <div class="empty-title">Scanning Local Wi-Fi Subnet...</div>
                    <div class="empty-desc">Probing active DogRemote hosts...</div>
                </div>
            `;
        }

        const subnetBase = (myDetectedIp && myDetectedIp.includes('.') && !myDetectedIp.startsWith('26.')) 
            ? myDetectedIp.substring(0, myDetectedIp.lastIndexOf('.')) 
            : '192.168.8';

        const lastSaved = localStorage.getItem('dogremote_last_addr') || '';
        const inputVal = remoteAddressInput.value ? remoteAddressInput.value.trim() : '';

        // 1. High-priority targeted probes (strictly limited to active candidate hosts)
        const priorityTargets = [];
        if (inputVal && !inputVal.startsWith('26.') && !priorityTargets.includes(inputVal)) priorityTargets.push(inputVal);
        if (lastSaved && !lastSaved.startsWith('26.') && !priorityTargets.includes(lastSaved)) priorityTargets.push(lastSaved);
        ['192.168.8.185', '192.168.8.194'].forEach(ip => {
            if (!priorityTargets.includes(ip)) priorityTargets.push(ip);
        });

        // Probe priority targets first with dedicated sockets
        priorityTargets.forEach(ip => {
            probeHost(ip, 2500);
        });

        // 2. Focused nearby subnet offsets (low concurrency: 3 sockets max)
        const subnetTargets = [];
        for (let i = 180; i <= 195; i++) {
            const ip = `${subnetBase}.${i}`;
            if (!priorityTargets.includes(ip) && ip !== myDetectedIp) subnetTargets.push(ip);
        }
        for (let i = 1; i <= 15; i++) {
            const ip = `${subnetBase}.${i}`;
            if (!priorityTargets.includes(ip) && !subnetTargets.includes(ip) && ip !== myDetectedIp) subnetTargets.push(ip);
        }

        let checked = 0;
        const totalToCheck = subnetTargets.length;
        const BATCH_SIZE = 3;
        let curIdx = 0;

        function runNextBatch() {
            if (curIdx >= subnetTargets.length) {
                checkFinished();
                return;
            }
            const batch = subnetTargets.slice(curIdx, curIdx + BATCH_SIZE);
            curIdx += BATCH_SIZE;

            batch.forEach(ip => {
                probeHost(ip, 1200, () => {
                    checked++;
                    checkFinished();
                });
            });

            if (curIdx < subnetTargets.length) {
                setTimeout(runNextBatch, 500);
            } else {
                setTimeout(checkFinished, 1500);
            }
        }

        function probeHost(ip, timeoutMs, onDone) {
            if (!ip || ip === myDetectedIp || ip === 'localhost' || ip === '127.0.0.1' || ip.startsWith('26.')) {
                if (onDone) onDone();
                return;
            }

            const probeStart = Date.now();
            let probeWs = null;
            let done = false;

            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (probeWs) {
                    try { probeWs.close(); } catch(e) {}
                }
                if (onDone) onDone();
            };

            const timer = setTimeout(finish, timeoutMs);

            try {
                probeWs = new WebSocket(`ws://${ip}:5859`);
                probeWs.onopen = () => {
                    try {
                        probeWs.send(JSON.stringify({
                            type: 'peer_announce',
                            name: window.myDeviceName || 'Samsung Mobile',
                            ip: myDetectedIp || '',
                            sharing: Boolean(window.isPhoneSharing)
                        }));
                    } catch(e) {}
                    setTimeout(finish, 600);
                };
                probeWs.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        const hostName = msg.name || msg.host || msg.device_name;
                        const isSharing = msg.sharing !== false; // Only show if host is actively sharing
                        if (isSharing && hostName && !hostName.includes('Mobile') && !hostName.includes('Phone')) {
                            const dynamicPing = Math.max(1, Date.now() - probeStart);
                            addDiscoveredCard(ip, hostName, `${dynamicPing} ms`);
                        } else if (!isSharing) {
                            removeDiscoveredCard(ip);
                        }
                    } catch(err) {}
                };
                probeWs.onerror = finish;
            } catch(e) {
                finish();
            }
        }

        function checkFinished() {
            if (checked >= totalToCheck || curIdx >= subnetTargets.length) {
                isScanningLocal = false;
                if (refreshDiscoveryBtn) refreshDiscoveryBtn.classList.remove('rotating');
                checkEmptyDiscovered();
            }
        }

        // Slight delay before running background subnet sweep so priority hosts respond instantly
        setTimeout(runNextBatch, 300);
    }

    // Add Discovered Host Card (Strictly one card per unique IP)
    function addDiscoveredCard(ip, name, pingStr) {
        if (!ip || ip === myDetectedIp || ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('26.')) return;
        if (name && (name.includes('Mobile') || name.includes('Phone') || name.toLowerCase().includes('samsung'))) return;

        discoveredIps.add(ip);
        discoveredHosts.set(ip, { name: name || 'DogRemote Host', pingStr, lastSeen: Date.now() });

        // Check if card for this IP already exists in DOM
        const existingCard = discoveredList.querySelector(`[data-ip="${ip}"]`);
        if (existingCard) {
            const pingVal = existingCard.querySelector('.device-ping-val');
            if (pingVal && pingStr) pingVal.textContent = pingStr;
            const nameSpan = existingCard.querySelector('.device-name-text');
            if (nameSpan && name && name !== 'DogRemote Host' && !name.startsWith('Host-')) {
                nameSpan.textContent = name;
            }
            return;
        }

        // Remove empty state if present
        const emptyState = discoveredList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const card = document.createElement('div');
        card.className = 'device-card';
        card.setAttribute('data-ip', ip);
        card.innerHTML = `
            <div class="device-info-left">
                <div class="device-name">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                    <span class="device-name-text">${name || 'DogRemote Host'}</span>
                </div>
                <div class="device-ip">${ip}:5859 • <span style="color:#34d399; font-weight:700;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" style="display:inline-block; vertical-align:middle;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> <span class="device-ping-val">${pingStr}</span></span></div>
            </div>
            <button type="button" class="btn-secondary btn-xs connect-quick-btn">
                <span>Connect</span>
            </button>
        `;

        // Direct connect on click
        card.querySelector('.connect-quick-btn').addEventListener('click', () => {
            remoteAddressInput.value = ip;
            remotePortInput.value = '5859';
            showToast(`Connecting to ${ip}...`);
            startConnection(ip, 5859, remotePinInput.value.trim());
        });

        discoveredList.appendChild(card);
    }

    function removeDiscoveredCard(ip) {
        discoveredIps.delete(ip);
        discoveredHosts.delete(ip);
        const card = discoveredList.querySelector(`[data-ip="${ip}"]`);
        if (card) {
            card.remove();
        }
        checkEmptyDiscovered();
    }

    function clearAllDiscovered(emptyTitle = 'No Hosts Auto-Detected') {
        discoveredIps.clear();
        discoveredHosts.clear();
        discoveredList.querySelectorAll('.device-card').forEach(c => c.remove());
        checkEmptyDiscovered(emptyTitle);
    }

    function checkEmptyDiscovered(emptyTitle = 'No Hosts Auto-Detected') {
        if (discoveredList.querySelectorAll('.device-card').length === 0) {
            discoveredList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </div>
                    <div class="empty-title">${emptyTitle}</div>
                    <div class="empty-desc">Active hosts will appear here when their screen sharing is turned on.</div>
                </div>
            `;
        }
    }

    // Prune dead/unreachable hosts after 5 seconds of silence
    setInterval(() => {
        if (isConnected || (window.isPhoneSharing && window.hasHostClients)) return;
        const now = Date.now();
        discoveredHosts.forEach((val, ip) => {
            if (now - val.lastSeen > 5000) {
                removeDiscoveredCard(ip);
            }
        });
    }, 2500);

    refreshDiscoveryBtn.addEventListener('click', discoverLocalDevices);

    // Periodic announce heartbeat to keep mobile device discovered on Host PC ONLY when actively sharing
    setInterval(() => {
        if (isConnected || !window.isPhoneSharing || window.hasHostClients) return;
        discoveredIps.forEach(ip => {
            try {
                const wsAnnounce = new WebSocket(`ws://${ip}:5859`);
                wsAnnounce.onopen = () => {
                    try {
                        wsAnnounce.send(JSON.stringify({
                            type: 'peer_announce',
                            name: window.myDeviceName || 'Samsung Mobile',
                            ip: myDetectedIp || '',
                            sharing: true
                        }));
                    } catch(e) {}
                    setTimeout(() => {
                        try { wsAnnounce.close(); } catch(e) {}
                    }, 100);
                };
                wsAnnounce.onerror = () => {
                    try { wsAnnounce.close(); } catch(e) {}
                };
            } catch(e) {}
        });
    }, 5000);

    // Initial Run
    discoverLocalDevices();

})();

