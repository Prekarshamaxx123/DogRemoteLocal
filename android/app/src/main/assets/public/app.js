// DogRemote / LanCast Mobile & Web Client Controller
(function() {
    'use strict';

    // State
    let ws = null;
    let targetHost = '';
    let targetPort = 5859;
    let currentPassword = '';
    let isConnected = false;
    let controlEnabled = true;
    let frameCount = 0;
    let lastFpsTime = Date.now();
    let currentFps = 60;
    let currentRtt = 1;
    let pingInterval = null;
    let fpsInterval = null;
    let lastTouchTime = 0;

    // DOM Elements
    const el = {
        remoteCodeInput: document.getElementById('remoteCodeInput'),
        remotePasswordInput: document.getElementById('remotePasswordInput'),
        btnConnectRemote: document.getElementById('btnConnectRemote'),
        
        // Viewer
        dashboardView: document.getElementById('dashboardView'),
        screenViewer: document.getElementById('screenViewer'),
        remotePeerTitle: document.getElementById('remotePeerTitle'),
        statLatencyVal: document.getElementById('statLatencyVal'),
        statFpsVal: document.getElementById('statFpsVal'),
        viewerScreenSelect: document.getElementById('viewerScreenSelect'),
        remoteFrame: document.getElementById('remoteFrame'),
        videoWrapper: document.getElementById('videoWrapper'),
        
        // Actions
        btnToggleControl: document.getElementById('btnToggleControl'),
        controlText: document.getElementById('controlText'),
        btnMobileKeyboard: document.getElementById('btnMobileKeyboard'),
        mobileKeyInput: document.getElementById('mobileKeyInput'),
        btnToggleFullscreen: document.getElementById('btnToggleFullscreen'),
        btnDisconnectViewer: document.getElementById('btnDisconnectViewer'),
        
        // Password Modal
        passwordModal: document.getElementById('passwordModal'),
        pwdModalTitle: document.getElementById('pwdModalTitle'),
        pwdModalMsg: document.getElementById('pwdModalMsg'),
        pwdModalInput: document.getElementById('pwdModalInput'),
        btnTogglePwdModalMask: document.getElementById('btnTogglePwdModalMask'),
        btnCancelPwdModal: document.getElementById('btnCancelPwdModal'),
        btnSubmitPwdModal: document.getElementById('btnSubmitPwdModal'),

        toastContainer: document.getElementById('toastContainer')
    };

    function showToast(message, type = 'info') {
        if (!el.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = "background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(139, 92, 246, 0.4); border-radius: 8px; color: #fff; padding: 10px 16px; margin-top: 8px; font-size: 13px; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.5);";
        toast.textContent = message;
        el.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    // --- Connection Handling ---
    function connectToHost(host, port, password) {
        targetHost = host.trim();
        targetPort = port || 5859;
        currentPassword = (password || '').trim();

        if (!targetHost) {
            showToast('Please enter target IP or address', 'error');
            return;
        }

        if (ws) {
            try { ws.close(); } catch(e) {}
            ws = null;
        }

        showToast(`Connecting to ${targetHost}:${targetPort}...`, 'info');

        const wsUrl = `ws://${targetHost}:${targetPort}`;
        try {
            ws = new WebSocket(wsUrl);
        } catch (e) {
            showToast(`Connection failed: ${e.message}`, 'error');
            return;
        }

        ws.binaryType = 'blob';

        ws.onopen = () => {
            // Send connect request with 6-digit password
            ws.send(JSON.stringify({
                type: 'connect',
                name: 'Mobile Client',
                password: currentPassword,
                req_control: controlEnabled
            }));
        };

        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
                // High-performance binary JPEG frame
                frameCount++;
                const url = URL.createObjectURL(event.data);
                el.remoteFrame.onload = () => URL.revokeObjectURL(url);
                el.remoteFrame.src = url;
            } else if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    handleJsonMessage(msg);
                } catch(e) {}
            }
        };

        ws.onerror = (e) => {
            showToast('Connection error occurred', 'error');
        };

        ws.onclose = () => {
            if (isConnected) {
                showToast('Session disconnected from host', 'info');
            }
            cleanupSession();
        };
    }

    function handleJsonMessage(msg) {
        if (msg.type === 'connect_res') {
            if (!msg.accepted) {
                const reason = msg.reason || '';
                const isIncorrect = reason.includes('INCORRECT');
                openPasswordModal(isIncorrect);
                return;
            }

            // Connection Approved!
            isConnected = true;
            el.dashboardView.style.display = 'none';
            el.screenViewer.style.display = 'flex';
            el.remotePeerTitle.textContent = `${targetHost}:${targetPort}`;

            // Populate multi-screen switcher
            populateScreenSwitcher(msg.screens || [], msg.active_screen || 0);

            // Start Ping-Pong latency loop (500ms)
            startMetrics();
            showToast('Connected! Streaming live display.', 'success');
        } else if (msg.type === 'pong') {
            if (msg.ts) {
                currentRtt = Math.max(1, Date.now() - msg.ts);
                el.statLatencyVal.textContent = `${currentRtt} ms`;
            }
        } else if (msg.type === 'screen_changed') {
            if (el.viewerScreenSelect) {
                const idx = msg.screen_index;
                el.viewerScreenSelect.value = (idx === -1) ? 'all' : String(idx);
            }
        }
    }

    function populateScreenSwitcher(screens, activeScreen) {
        if (!el.viewerScreenSelect) return;
        el.viewerScreenSelect.innerHTML = '';

        if (screens && screens.length > 1) {
            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = 'All Connected Displays (Canvas)';
            el.viewerScreenSelect.appendChild(optAll);
        }

        if (screens && screens.length > 0) {
            screens.forEach((s, i) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = `Display ${i + 1} (${s.width}x${s.height})`;
                el.viewerScreenSelect.appendChild(opt);
            });
        } else {
            const opt1 = document.createElement('option');
            opt1.value = '0';
            opt1.textContent = 'Display 1';
            el.viewerScreenSelect.appendChild(opt1);
        }

        el.viewerScreenSelect.value = (activeScreen === -1) ? 'all' : String(activeScreen);
    }

    function startMetrics() {
        clearInterval(pingInterval);
        clearInterval(fpsInterval);

        frameCount = 0;
        lastFpsTime = Date.now();

        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
            }
        }, 500);

        fpsInterval = setInterval(() => {
            const now = Date.now();
            const dt = (now - lastFpsTime) / 1000;
            if (dt > 0.4) {
                currentFps = Math.max(1, Math.round(frameCount / dt));
                frameCount = 0;
                lastFpsTime = now;
                el.statFpsVal.textContent = `${currentFps} FPS`;
            }
        }, 500);
    }

    function cleanupSession() {
        isConnected = false;
        clearInterval(pingInterval);
        clearInterval(fpsInterval);
        el.screenViewer.style.display = 'none';
        el.dashboardView.style.display = 'grid';
        if (ws) {
            try { ws.close(); } catch(e) {}
            ws = null;
        }
    }

    // --- Password Modal (6-Digit) ---
    function openPasswordModal(isIncorrect) {
        el.pwdModalTitle.textContent = isIncorrect ? 'Incorrect Password!' : 'Authentication Required';
        el.pwdModalTitle.style.color = isIncorrect ? '#ef4444' : '#fff';
        el.pwdModalMsg.textContent = isIncorrect
            ? `The 6-digit password for ${targetHost} was incorrect. Please try again:`
            : `The host at ${targetHost} requires a 6-digit security password:`;
        el.pwdModalInput.value = '';
        el.passwordModal.style.display = 'flex';
        el.pwdModalInput.focus();
    }

    function closePasswordModal() {
        el.passwordModal.style.display = 'none';
    }

    // --- Input Forwarding ---
    function sendNormalizedMouse(x, y) {
        if (!ws || ws.readyState !== WebSocket.OPEN || !controlEnabled) return;
        ws.send(JSON.stringify({ type: 'mouse_move', x: x, y: y }));
    }

    function sendMouseClick(btn, action, x, y) {
        if (!ws || ws.readyState !== WebSocket.OPEN || !controlEnabled) return;
        ws.send(JSON.stringify({ type: 'mouse_click', button: btn, action: action, x: x, y: y }));
    }

    function sendKey(keyName, action = 'key') {
        if (!ws || ws.readyState !== WebSocket.OPEN || !controlEnabled) return;
        ws.send(JSON.stringify({ type: 'key', key: keyName, action: action }));
    }

    function getNormalizedCoords(evt) {
        const rect = el.remoteFrame.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const clientX = evt.clientX || (evt.touches && evt.touches[0] ? evt.touches[0].clientX : 0);
        const clientY = evt.clientY || (evt.touches && evt.touches[0] ? evt.touches[0].clientY : 0);
        const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        return { x: nx, y: ny };
    }

    // --- Event Listeners ---
    document.addEventListener('DOMContentLoaded', () => {
        // Auto-fill target IP if opened directly in browser from host
        if (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            if (el.remoteCodeInput) el.remoteCodeInput.value = location.hostname;
        }

        // Connect Button
        if (el.btnConnectRemote) {
            el.btnConnectRemote.addEventListener('click', () => {
                const hostVal = (el.remoteCodeInput.value || '').trim();
                const pwdVal = (el.remotePasswordInput ? el.remotePasswordInput.value : '').trim();
                connectToHost(hostVal, 5859, pwdVal);
            });
        }

        if (el.remoteCodeInput) {
            el.remoteCodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.btnConnectRemote.click();
            });
        }

        // Multi-Screen Switcher
        if (el.viewerScreenSelect) {
            el.viewerScreenSelect.addEventListener('change', () => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                const val = el.viewerScreenSelect.value;
                const s_idx = (val === 'all') ? -1 : parseInt(val);
                ws.send(JSON.stringify({ type: 'set_screen', screen_index: s_idx }));
            });
        }

        // Control Toggle
        if (el.btnToggleControl) {
            el.btnToggleControl.addEventListener('click', () => {
                controlEnabled = !controlEnabled;
                el.controlText.textContent = controlEnabled ? 'Control: ON' : 'Control: OFF';
                el.btnToggleControl.style.borderColor = controlEnabled ? 'rgba(139, 92, 246, 0.4)' : 'rgba(239, 68, 68, 0.4)';
            });
        }

        // Disconnect
        if (el.btnDisconnectViewer) {
            el.btnDisconnectViewer.addEventListener('click', cleanupSession);
        }

        // Fullscreen
        if (el.btnToggleFullscreen) {
            el.btnToggleFullscreen.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    el.screenViewer.requestFullscreen().catch(() => {});
                } else {
                    document.exitFullscreen().catch(() => {});
                }
            });
        }

        // Mobile Keyboard
        if (el.btnMobileKeyboard && el.mobileKeyInput) {
            el.btnMobileKeyboard.addEventListener('click', () => {
                el.mobileKeyInput.focus();
            });
        }

        if (el.mobileKeyInput) {
            el.mobileKeyInput.addEventListener('input', (e) => {
                const val = el.mobileKeyInput.value;
                if (val) {
                    sendKey(val, 'type');
                    el.mobileKeyInput.value = '';
                }
            });
            el.mobileKeyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    sendKey('BackSpace', 'key');
                } else if (e.key === 'Enter') {
                    sendKey('Return', 'key');
                }
            });
        }

        // Modifier Toolbar Keys
        document.querySelectorAll('.mod-key').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                if (key) sendKey(key, 'key');
            });
        });

        // Touch Interaction on Screen
        if (el.remoteFrame) {
            el.remoteFrame.addEventListener('touchstart', (e) => {
                const pos = getNormalizedCoords(e);
                if (pos) {
                    sendNormalizedMouse(pos.x, pos.y);
                    lastTouchTime = Date.now();
                }
            }, { passive: true });

            el.remoteFrame.addEventListener('touchmove', (e) => {
                const pos = getNormalizedCoords(e);
                if (pos) sendNormalizedMouse(pos.x, pos.y);
            }, { passive: true });

            el.remoteFrame.addEventListener('touchend', (e) => {
                const dt = Date.now() - lastTouchTime;
                if (dt < 250) {
                    // Tap = Left Click
                    sendMouseClick('left', 'click');
                }
            }, { passive: true });

            // Desktop Mouse Interaction
            el.remoteFrame.addEventListener('mousemove', (e) => {
                const pos = getNormalizedCoords(e);
                if (pos) sendNormalizedMouse(pos.x, pos.y);
            });

            el.remoteFrame.addEventListener('mousedown', (e) => {
                const pos = getNormalizedCoords(e);
                const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
                if (pos) sendMouseClick(btn, 'down', pos.x, pos.y);
            });

            el.remoteFrame.addEventListener('mouseup', (e) => {
                const pos = getNormalizedCoords(e);
                const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
                if (pos) sendMouseClick(btn, 'up', pos.x, pos.y);
            });

            el.remoteFrame.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        // Password Modal Events
        if (el.btnSubmitPwdModal) {
            el.btnSubmitPwdModal.addEventListener('click', () => {
                const enteredPwd = (el.pwdModalInput.value || '').trim();
                closePasswordModal();
                connectToHost(targetHost, targetPort, enteredPwd);
            });
        }

        if (el.pwdModalInput) {
            el.pwdModalInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') el.btnSubmitPwdModal.click();
            });
        }

        if (el.btnCancelPwdModal) {
            el.btnCancelPwdModal.addEventListener('click', closePasswordModal);
        }

        if (el.btnTogglePwdModalMask) {
            el.btnTogglePwdModalMask.addEventListener('click', () => {
                const isPwd = el.pwdModalInput.type === 'password';
                el.pwdModalInput.type = isPwd ? 'text' : 'password';
                el.btnTogglePwdModalMask.textContent = isPwd ? 'Hide' : 'Show';
            });
        }
    });
})();
