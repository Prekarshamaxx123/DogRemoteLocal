// OmniDesk LAN - Core WebRTC & Client Controller
(function() {
    'use strict';

    // State
    const state = {
        myId: null,
        myCode: null,
        myName: 'Device',
        myIp: null,
        activeRole: 'idle', // 'idle' | 'host' | 'viewer'
        localStream: null,
        peerConnection: null,
        dataChannel: null,
        currentPeerId: null,
        currentPeerName: 'Remote Device',
        permissions: {
            screen: true,
            control: true,
            audio: true
        },
        statsInterval: null,
        lastPingTime: 0,
        latency: 0,
        discoveredPeers: new Map()
    };

    // DOM Elements
    const el = {
        hostIpBadge: document.getElementById('hostIpBadge'),
        headerIpText: document.getElementById('headerIpText'),
        networkStatusText: document.getElementById('networkStatusText'),
        deviceHostName: document.getElementById('deviceHostName'),
        myDeviceCode: document.getElementById('myDeviceCode'),
        btnCopyCode: document.getElementById('btnCopyCode'),
        btnShowQr: document.getElementById('btnShowQr'),
        btnQuickQr: document.getElementById('btnQuickQr'),
        qrModal: document.getElementById('qrModal'),
        btnCloseQr: document.getElementById('btnCloseQr'),
        qrImage: document.getElementById('qrImage'),
        qrUrlText: document.getElementById('qrUrlText'),
        btnCopyUrl: document.getElementById('btnCopyUrl'),
        
        btnToggleShare: document.getElementById('btnToggleShare'),
        btnShareText: document.getElementById('btnShareText'),
        qualitySelect: document.getElementById('qualitySelect'),
        chkAudioShare: document.getElementById('chkAudioShare'),
        chkRemoteControlDefault: document.getElementById('chkRemoteControlDefault'),
        viewersSection: document.getElementById('viewersSection'),
        viewersCount: document.getElementById('viewersCount'),
        viewersList: document.getElementById('viewersList'),
        
        remoteCodeInput: document.getElementById('remoteCodeInput'),
        btnConnectRemote: document.getElementById('btnConnectRemote'),
        discoveredDevicesList: document.getElementById('discoveredDevicesList'),
        
        // Viewer Interface
        screenViewer: document.getElementById('screenViewer'),
        viewerTopbar: document.getElementById('viewerTopbar'),
        remotePeerTitle: document.getElementById('remotePeerTitle'),
        statLatencyVal: document.getElementById('statLatencyVal'),
        statFpsVal: document.getElementById('statFpsVal'),
        btnToggleControl: document.getElementById('btnToggleControl'),
        controlText: document.getElementById('controlText'),
        btnMobileKeyboard: document.getElementById('btnMobileKeyboard'),
        btnToggleAudio: document.getElementById('btnToggleAudio'),
        btnToggleFullscreen: document.getElementById('btnToggleFullscreen'),
        btnDisconnectViewer: document.getElementById('btnDisconnectViewer'),
        videoWrapper: document.getElementById('videoWrapper'),
        remoteVideo: document.getElementById('remoteVideo'),
        mobileKeyInput: document.getElementById('mobileKeyInput'),
        
        // Incoming Request Modal
        incomingModal: document.getElementById('incomingModal'),
        incomingDeviceName: document.getElementById('incomingDeviceName'),
        incomingDeviceIp: document.getElementById('incomingDeviceIp'),
        permScreen: document.getElementById('permScreen'),
        permControl: document.getElementById('permControl'),
        permAudio: document.getElementById('permAudio'),
        btnAcceptIncoming: document.getElementById('btnAcceptIncoming'),
        btnRejectIncoming: document.getElementById('btnRejectIncoming'),
        
        toastContainer: document.getElementById('toastContainer')
    };

    // WebSocket connection
    let ws = null;
    let pendingIncomingRequest = null;

    // WebRTC Configuration optimized for direct LAN P2P
    const rtcConfig = {
        iceServers: [
            // Standard STUN servers (will fallback if available, but direct host candidates are used for LAN)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 4
    };

    // --- Init ---
    async function init() {
        setupEventListeners();
        await loadHostInfo();
        connectWebSocket();
        startDiscoveryPolling();
    }

    // Fetch local device info and QR code
    async function loadHostInfo() {
        try {
            const res = await fetch('/api/info');
            const data = await res.json();
            state.myIp = data.ip;
            state.myCode = data.deviceCode;
            state.myName = data.hostname;

            el.headerIpText.textContent = `${data.ip}:${data.port}`;
            el.deviceHostName.textContent = data.hostname;
            el.myDeviceCode.textContent = data.deviceCode;
            el.qrImage.src = data.qrCode;
            el.qrUrlText.textContent = data.url;
        } catch (e) {
            console.error('Failed to load host info', e);
            showToast('Failed to load LAN info: ' + e.message, 'error');
        }
    }

    // Connect WebSocket
    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}`);

        ws.onopen = () => {
            el.networkStatusText.textContent = 'LAN Online';
            showToast('Connected to LAN Signaling Service', 'success');
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleSignalingMessage(msg);
            } catch (err) {
                console.error('Error parsing WS message:', err);
            }
        };

        ws.onclose = () => {
            el.networkStatusText.textContent = 'LAN Offline';
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    // Handle incoming signaling messages
    async function handleSignalingMessage(msg) {
        switch (msg.type) {
            case 'registered': {
                state.myId = msg.clientId;
                if (!state.myCode) state.myCode = msg.hostCode;
                // Identify with custom name based on user agent
                const userDeviceName = detectDeviceName();
                wsSend({
                    type: 'set-identity',
                    name: userDeviceName,
                    deviceCode: state.myCode
                });
                break;
            }

            // Incoming connection request to Host
            case 'incoming-request': {
                promptIncomingConnection(msg);
                break;
            }

            // Client received response to connection request
            case 'connect-accepted': {
                showToast(`Connection accepted by ${msg.hostName || 'Host'}! Connecting P2P stream...`, 'success');
                state.currentPeerId = msg.hostId;
                state.currentPeerName = msg.hostName || 'Host';
                state.permissions = msg.permissions || { screen: true, control: true, audio: true };
                setupViewerPeerConnection();
                break;
            }

            case 'connect-rejected': {
                showToast(`Connection rejected: ${msg.reason || 'Host declined'}`, 'error');
                break;
            }

            // WebRTC Offer
            case 'signal-offer': {
                await handleWebRtcOffer(msg.fromId, msg.payload);
                break;
            }

            // WebRTC Answer
            case 'signal-answer': {
                await handleWebRtcAnswer(msg.payload);
                break;
            }

            // ICE Candidate
            case 'signal-candidate': {
                await handleWebRtcCandidate(msg.payload);
                break;
            }

            case 'peer-disconnected': {
                if (msg.clientId === state.currentPeerId) {
                    showToast('Remote peer disconnected.', 'info');
                    disconnectSession();
                }
                break;
            }
        }
    }

    function wsSend(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    // --- Device Discovery Polling ---
    function startDiscoveryPolling() {
        setInterval(async () => {
            try {
                const res = await fetch('/api/discovered');
                const list = await res.json();
                renderDiscoveredDevices(list);
            } catch (e) {
                // ignore
            }
        }, 3000);
    }

    function renderDiscoveredDevices(devices) {
        const container = el.discoveredDevicesList;
        // Filter out self
        const others = devices.filter(d => d.deviceCode !== state.myCode);

        if (others.length === 0) {
            container.innerHTML = `
                <div class="empty-devices">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                    <p>Scanning same network for other OmniDesk devices...</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        others.forEach(dev => {
            const item = document.createElement('div');
            item.className = 'device-item';
            item.innerHTML = `
                <div class="device-item-info">
                    <span class="device-icon">💻</span>
                    <div>
                        <div class="device-item-name">${escapeHtml(dev.name)}</div>
                        <div class="device-item-ip">${dev.ip} &bull; ${dev.deviceCode}</div>
                    </div>
                </div>
                <button class="btn-item-connect" data-code="${dev.deviceCode}">Connect</button>
            `;
            item.querySelector('.btn-item-connect').addEventListener('click', () => {
                requestConnectTo(dev.deviceCode);
            });
            container.appendChild(item);
        });
    }

    // --- Host Screen Sharing ---
    async function toggleScreenShare() {
        if (state.localStream) {
            stopScreenShare();
        } else {
            await startScreenShare();
        }
    }

    async function startScreenShare() {
        try {
            const quality = el.qualitySelect.value;
            let videoConstraints = {
                frameRate: { ideal: 60, max: 60 }
            };

            if (quality === '1080p60') {
                videoConstraints.width = { ideal: 1920 };
                videoConstraints.height = { ideal: 1080 };
            } else if (quality === '720p30') {
                videoConstraints.width = { ideal: 1280 };
                videoConstraints.height = { ideal: 720 };
                videoConstraints.frameRate = { ideal: 30, max: 30 };
            } else if (quality === '480p60') {
                videoConstraints.width = { ideal: 854 };
                videoConstraints.height = { ideal: 480 };
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: videoConstraints,
                audio: el.chkAudioShare.checked
            });

            state.localStream = stream;
            state.activeRole = 'host';

            // Register as host
            wsSend({ type: 'register-role', role: 'host' });

            // Stream stopped by browser UI button
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            el.btnToggleShare.classList.add('btn-danger-gradient');
            el.btnShareText.textContent = 'Stop Sharing Screen';
            el.viewersSection.style.display = 'block';

            showToast('Screen sharing started! Waiting for LAN viewers.', 'success');
        } catch (err) {
            console.error('Error starting screen share:', err);
            showToast('Could not start screen capture: ' + err.message, 'error');
        }
    }

    function stopScreenShare() {
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
        }

        if (state.peerConnection) {
            state.peerConnection.close();
            state.peerConnection = null;
        }

        state.activeRole = 'idle';
        el.btnToggleShare.classList.remove('btn-danger-gradient');
        el.btnShareText.textContent = 'Start Sharing Screen';
        el.viewersSection.style.display = 'none';
        el.viewersList.innerHTML = '';
        el.viewersCount.textContent = '0';
        showToast('Screen sharing stopped.', 'info');
    }

    // --- lancast Incoming Request Modal ---
    function promptIncomingConnection(msg) {
        pendingIncomingRequest = msg;
        el.incomingDeviceName.textContent = msg.fromName || 'Remote Device';
        el.incomingDeviceIp.textContent = `${msg.fromIp} (ID: ${msg.fromId})`;
        el.permControl.checked = el.chkRemoteControlDefault.checked;
        el.permAudio.checked = el.chkAudioShare.checked;
        el.incomingModal.style.display = 'flex';
    }

    el.btnAcceptIncoming.addEventListener('click', async () => {
        if (!pendingIncomingRequest) return;
        el.incomingModal.style.display = 'none';

        const perms = {
            screen: true,
            control: el.permControl.checked,
            audio: el.permAudio.checked
        };

        // Notify client acceptance
        wsSend({
            type: 'connection-response',
            toId: pendingIncomingRequest.fromId,
            accepted: true,
            permissions: perms
        });

        // Add to active viewers list in UI
        addViewerToUi(pendingIncomingRequest.fromId, pendingIncomingRequest.fromName, pendingIncomingRequest.fromIp);

        // If host screen isn't already started, start it automatically!
        if (!state.localStream) {
            await startScreenShare();
        }

        // Setup host peer connection for this viewer
        setupHostPeerConnection(pendingIncomingRequest.fromId);
        pendingIncomingRequest = null;
    });

    el.btnRejectIncoming.addEventListener('click', () => {
        if (!pendingIncomingRequest) return;
        el.incomingModal.style.display = 'none';
        wsSend({
            type: 'connection-response',
            toId: pendingIncomingRequest.fromId,
            accepted: false
        });
        pendingIncomingRequest = null;
    });

    function addViewerToUi(id, name, ip) {
        const item = document.createElement('div');
        item.className = 'device-item';
        item.id = `viewer-${id}`;
        item.innerHTML = `
            <div class="device-item-info">
                <span>🟢</span>
                <div>
                    <div class="device-item-name">${escapeHtml(name)}</div>
                    <div class="device-item-ip">${ip}</div>
                </div>
            </div>
            <button class="btn-secondary btn-sm" onclick="disconnectViewer('${id}')">Kick</button>
        `;
        el.viewersList.appendChild(item);
        el.viewersCount.textContent = el.viewersList.children.length;
    }

    // --- WebRTC P2P Connection Setup (Host Side) ---
    async function setupHostPeerConnection(viewerId) {
        const pc = new RTCPeerConnection(rtcConfig);
        state.peerConnection = pc;

        // Add local screen tracks
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => {
                pc.addTrack(track, state.localStream);
            });
        }

        // Host creates data channel for control & latency ping
        const dc = pc.createDataChannel('omnidesk-control', { ordered: true });
        state.dataChannel = dc;
        setupDataChannel(dc, true);

        // ICE candidate handler
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                wsSend({
                    type: 'signal-candidate',
                    targetId: viewerId,
                    payload: event.candidate
                });
            }
        };

        // Create and send offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsSend({
                type: 'signal-offer',
                targetId: viewerId,
                payload: offer
            });
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    }

    // --- WebRTC P2P Connection Setup (Viewer Side) ---
    function setupViewerPeerConnection() {
        const pc = new RTCPeerConnection(rtcConfig);
        state.peerConnection = pc;

        // When remote track arrives, attach to video player
        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                el.remoteVideo.srcObject = event.streams[0];
                el.remoteVideo.play().catch(e => console.log('Autoplay handled:', e));
                el.screenViewer.style.display = 'flex';
                el.remotePeerTitle.textContent = state.currentPeerName;
                startStatsMonitoring();
            }
        };

        // Handle incoming data channel from host
        pc.ondatachannel = (event) => {
            state.dataChannel = event.channel;
            setupDataChannel(event.channel, false);
        };

        // ICE candidate handler
        pc.onicecandidate = (event) => {
            if (event.candidate && state.currentPeerId) {
                wsSend({
                    type: 'signal-candidate',
                    targetId: state.currentPeerId,
                    payload: event.candidate
                });
            }
        };
    }

    // Handle incoming WebRTC Offer (Viewer receives offer from Host)
    async function handleWebRtcOffer(fromId, offer) {
        if (!state.peerConnection) {
            setupViewerPeerConnection();
        }
        const pc = state.peerConnection;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        wsSend({
            type: 'signal-answer',
            targetId: fromId,
            payload: answer
        });
    }

    // Handle incoming WebRTC Answer (Host receives answer from Viewer)
    async function handleWebRtcAnswer(answer) {
        if (state.peerConnection) {
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    // Handle incoming ICE Candidate
    async function handleWebRtcCandidate(candidate) {
        if (state.peerConnection && candidate) {
            try {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn('Error adding ICE candidate:', e);
            }
        }
    }

    // --- DataChannel & Ping / Control ---
    function setupDataChannel(dc, isHost) {
        dc.onopen = () => {
            console.log('[OmniDesk] DataChannel opened (isHost=' + isHost + ')');
            if (!isHost) {
                // Viewer sends periodic ping to calculate latency
                setInterval(sendPing, 1000);
            }
        };

        dc.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ping') {
                    // Host immediately pong back
                    dc.send(JSON.stringify({ type: 'pong', time: data.time }));
                } else if (data.type === 'pong') {
                    // Viewer calculates round trip time
                    const rtt = Math.round(performance.now() - data.time);
                    state.latency = rtt;
                    el.statLatencyVal.textContent = `${rtt} ms`;
                }
            } catch (e) {
                // ignore
            }
        };
    }

    function sendPing() {
        if (state.dataChannel && state.dataChannel.readyState === 'open') {
            state.dataChannel.send(JSON.stringify({
                type: 'ping',
                time: performance.now()
            }));
        }
    }

    function startStatsMonitoring() {
        if (state.statsInterval) clearInterval(state.statsInterval);
        state.statsInterval = setInterval(async () => {
            if (!state.peerConnection) return;
            const stats = await state.peerConnection.getStats();
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    if (report.framesPerSecond) {
                        el.statFpsVal.textContent = `${Math.round(report.framesPerSecond)} FPS`;
                    }
                }
            });
        }, 1500);
    }

    // --- Connect Request from Client to Remote Code ---
    function requestConnectTo(targetCode) {
        if (!targetCode) {
            showToast('Please enter a target address or IP.', 'error');
            return;
        }

        const password = document.getElementById('remotePasswordInput')?.value?.trim() || '';

        showToast(`Requesting connection to ${targetCode}...`, 'info');
        wsSend({
            type: 'connect-request',
            targetCode: targetCode,
            password: password,
            permissions: {
                screen: true,
                control: true,
                audio: true
            }
        });
    }

    // --- Remote Input Handling (Viewer -> Host) ---
    let isControlEnabled = true;

    function setupRemoteInputHandlers() {
        const video = el.remoteVideo;

        // Throttled mouse move
        let lastMove = 0;
        video.addEventListener('mousemove', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            const now = Date.now();
            if (now - lastMove < 25) return; // ~40 updates/sec
            lastMove = now;

            const coords = getVideoCoordinates(e, video);
            if (coords) {
                sendInputEvent({
                    event: 'mousemove',
                    x: coords.x,
                    y: coords.y
                });
            }
        });

        // Mouse down
        video.addEventListener('mousedown', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            const coords = getVideoCoordinates(e, video);
            const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
            sendInputEvent({
                event: 'mousedown',
                button: btn,
                x: coords ? coords.x : 0,
                y: coords ? coords.y : 0
            });
        });

        // Mouse up
        video.addEventListener('mouseup', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            const btn = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
            sendInputEvent({
                event: 'mouseup',
                button: btn
            });
        });

        // Context menu (right click) prevent default
        video.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Touch support for Android / Tablets
        let touchStartPos = null;
        video.addEventListener('touchstart', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            if (e.touches.length === 1) {
                const t = e.touches[0];
                const coords = getVideoCoordinates(t, video);
                touchStartPos = coords;
                if (coords) {
                    sendInputEvent({ event: 'mousemove', x: coords.x, y: coords.y });
                    sendInputEvent({ event: 'mousedown', button: 'left' });
                }
            } else if (e.touches.length === 2) {
                // Two finger tap = right click
                sendInputEvent({ event: 'click', button: 'right' });
            }
        }, { passive: false });

        video.addEventListener('touchmove', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            if (e.touches.length === 1) {
                const t = e.touches[0];
                const coords = getVideoCoordinates(t, video);
                if (coords) {
                    sendInputEvent({ event: 'mousemove', x: coords.x, y: coords.y });
                }
            }
        }, { passive: true });

        video.addEventListener('touchend', (e) => {
            if (!isControlEnabled || !state.permissions.control) return;
            sendInputEvent({ event: 'mouseup', button: 'left' });
        });

        // Keyboard inputs
        window.addEventListener('keydown', (e) => {
            if (el.screenViewer.style.display !== 'flex') return;
            if (!isControlEnabled || !state.permissions.control) return;
            // Prevent browser shortcuts like Tab, F5, etc.
            if (e.key === 'Tab' || e.key === 'Alt') e.preventDefault();

            sendInputEvent({
                event: 'keydown',
                key: e.key
            });
        });

        window.addEventListener('keyup', (e) => {
            if (el.screenViewer.style.display !== 'flex') return;
            if (!isControlEnabled || !state.permissions.control) return;

            sendInputEvent({
                event: 'keyup',
                key: e.key
            });
        });

        // Mobile virtual keyboard input
        el.mobileKeyInput.addEventListener('input', (e) => {
            if (e.data) {
                sendInputEvent({
                    event: 'type',
                    text: e.data
                });
            }
            el.mobileKeyInput.value = '';
        });

        // Setup Mobile Modifier Keys (Ctrl, Alt, Shift, Esc, Tab, Win, Arrows)
        setupMobileModifierKeys();
    }

    function setupMobileModifierKeys() {
        const modBtns = document.querySelectorAll('.mod-key');
        modBtns.forEach(btn => {
            const key = btn.getAttribute('data-key');
            if (['Control_L', 'Alt_L', 'Shift_L'].includes(key)) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isActive = btn.classList.toggle('active');
                    sendInputEvent({
                        event: isActive ? 'keydown' : 'keyup',
                        key: key
                    });
                });
            } else {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    sendInputEvent({ event: 'keydown', key: key });
                    setTimeout(() => {
                        sendInputEvent({ event: 'keyup', key: key });
                    }, 50);
                });
            }
        });
    }

    function sendInputEvent(payload) {
        wsSend({
            type: 'remote-input',
            ...payload
        });
    }

    // Calculate accurate native pixel coordinates inside video
    function getVideoCoordinates(e, video) {
        const rect = video.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);

        if (!clientX || !clientY) return null;

        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;

        // Video container aspect ratio scaling
        const scaleX = videoWidth / rect.width;
        const scaleY = videoHeight / rect.height;

        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return {
            x: Math.max(0, Math.min(videoWidth, x)),
            y: Math.max(0, Math.min(videoHeight, y))
        };
    }

    // --- Disconnect Session ---
    function disconnectSession() {
        if (state.peerConnection) {
            state.peerConnection.close();
            state.peerConnection = null;
        }
        if (state.statsInterval) {
            clearInterval(state.statsInterval);
            state.statsInterval = null;
        }

        el.remoteVideo.srcObject = null;
        el.screenViewer.style.display = 'none';
        state.currentPeerId = null;
        showToast('Session ended.', 'info');
    }

    // --- UI Event Listeners ---
    function setupEventListeners() {
        // Copy Code
        el.btnCopyCode.addEventListener('click', () => {
            copyToClipboard(state.myCode);
            showToast('Device address copied to clipboard!', 'success');
        });

        // QR Code Modals
        el.btnShowQr.addEventListener('click', () => el.qrModal.style.display = 'flex');
        el.btnQuickQr.addEventListener('click', () => el.qrModal.style.display = 'flex');
        el.btnCloseQr.addEventListener('click', () => el.qrModal.style.display = 'none');
        el.qrModal.addEventListener('click', (e) => {
            if (e.target === el.qrModal) el.qrModal.style.display = 'none';
        });

        // Copy QR URL
        el.btnCopyUrl.addEventListener('click', () => {
            copyToClipboard(el.qrUrlText.textContent);
            showToast('LAN URL copied to clipboard!', 'success');
        });

        // Toggle Sharing
        el.btnToggleShare.addEventListener('click', toggleScreenShare);

        // Connect button
        el.btnConnectRemote.addEventListener('click', () => {
            const code = el.remoteCodeInput.value.trim();
            requestConnectTo(code);
        });

        el.remoteCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                requestConnectTo(el.remoteCodeInput.value.trim());
            }
        });

        // Viewer Toolbar Buttons
        el.btnDisconnectViewer.addEventListener('click', disconnectSession);

        el.btnToggleControl.addEventListener('click', () => {
            isControlEnabled = !isControlEnabled;
            el.controlText.textContent = `Control: ${isControlEnabled ? 'ON' : 'OFF'}`;
            el.btnToggleControl.style.borderColor = isControlEnabled ? 'var(--primary)' : 'var(--border-color)';
            showToast(`Remote control ${isControlEnabled ? 'enabled' : 'disabled'}.`, 'info');
        });

        el.btnMobileKeyboard.addEventListener('click', () => {
            el.mobileKeyInput.focus();
            showToast('Tap on phone to type', 'info');
        });

        el.btnToggleFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                el.screenViewer.requestFullscreen().catch(err => console.log(err));
            } else {
                document.exitFullscreen().catch(err => console.log(err));
            }
        });

        // Remote input handlers
        setupRemoteInputHandlers();
    }

    // --- Helper Utilities ---
    function copyToClipboard(text) {
        if (!text) return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            const input = document.createElement('textarea');
            input.value = text;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
        }
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        el.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    function detectDeviceName() {
        const ua = navigator.userAgent;
        if (/Android/i.test(ua)) return 'Android Device';
        if (/iPhone|iPad/i.test(ua)) return 'Apple Mobile';
        if (/Macintosh/i.test(ua)) return 'Mac OS';
        if (/Windows/i.test(ua)) return 'Windows PC';
        if (/Linux/i.test(ua)) return 'Linux Device';
        return 'Web Client';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Expose kick viewer function globally
    window.disconnectViewer = function(id) {
        const item = document.getElementById(`viewer-${id}`);
        if (item) item.remove();
        el.viewersCount.textContent = el.viewersList.children.length;
        wsSend({ type: 'kick-viewer', targetId: id });
    };

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
