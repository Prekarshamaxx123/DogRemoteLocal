package com.dogremote.local;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.FileDescriptor;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketImpl;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends BridgeActivity {
    static {
        System.setProperty("java.net.preferIPv4Stack", "true");
        System.setProperty("java.net.preferIPv6Addresses", "false");
    }

    private static final String TAG = "DogRemoteNative";
    private static final int UDP_PORT = 5857;
    private static final int TCP_PORT = 5859;
    private static final int REQUEST_MEDIA_PROJECTION = 2026;

    private static volatile MainActivity instance = null;

    public static MainActivity getInstance() {
        return instance;
    }

    public static void bindSocketToPhysicalWifi(Object socketOrFd) {
        MainActivity act = instance;
        if (act != null) {
            act.bindSocketToWifi(socketOrFd);
        }
    }

    public void bindSocketToWifi(Object socketOrFd) {
        final Network net = wifiNetwork;
        if (net == null || socketOrFd == null) return;
        try {
            if (socketOrFd instanceof Socket) {
                net.bindSocket((Socket) socketOrFd);
            } else if (socketOrFd instanceof DatagramSocket) {
                net.bindSocket((DatagramSocket) socketOrFd);
            } else if (socketOrFd instanceof FileDescriptor) {
                net.bindSocket((FileDescriptor) socketOrFd);
            } else if (socketOrFd instanceof ServerSocket) {
                ServerSocket ss = (ServerSocket) socketOrFd;
                try {
                    Method m = ServerSocket.class.getDeclaredMethod("getFileDescriptor$");
                    m.setAccessible(true);
                    FileDescriptor fd = (FileDescriptor) m.invoke(ss);
                    if (fd != null && fd.valid()) {
                        net.bindSocket(fd);
                        Log.d(TAG, "Successfully bound ServerSocket fd to physical Wi-Fi!");
                    }
                } catch (Exception e1) {
                    try {
                        Field f = ServerSocket.class.getDeclaredField("impl");
                        f.setAccessible(true);
                        Object impl = f.get(ss);
                        Field fFd = SocketImpl.class.getDeclaredField("fd");
                        fFd.setAccessible(true);
                        FileDescriptor fd = (FileDescriptor) fFd.get(impl);
                        if (fd != null && fd.valid()) {
                            net.bindSocket(fd);
                            Log.d(TAG, "Successfully bound ServerSocket impl.fd to physical Wi-Fi!");
                        }
                    } catch (Exception e2) {
                        Log.w(TAG, "Could not bind ServerSocket to wifi: " + e2.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "bindSocketToWifi error: " + e.getMessage());
        }
    }

    private WifiManager.MulticastLock multicastLock;
    private ConnectivityManager connectivityManager;
    private volatile Network wifiNetwork = null;
    private volatile boolean isRunning = true;
    private volatile boolean isSharingScreen = false;
    private volatile String hostPassword = "";
    private volatile boolean isPasswordRequired = true;
    private volatile boolean isControlAllowed = true;
    private DatagramSocket udpSocket;
    private ServerSocket tcpDiscoveryServer;
    private final Map<String, String> discoveredPeers = new ConcurrentHashMap<>();

    public String getDeviceName() {
        try {
            String manufacturer = Build.MANUFACTURER;
            String model = Build.MODEL;
            if (manufacturer == null) manufacturer = "Android";
            if (model == null) model = "Device";
            if (model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
                return capitalize(model);
            } else {
                return capitalize(manufacturer) + " " + model;
            }
        } catch (Exception e) {
            return "Android Phone";
        }
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return "";
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        android.webkit.WebView.setWebContentsDebuggingEnabled(true);

        // Bind process explicitly to Wi-Fi to bypass any active VPN (NetMod, etc.)
        setupWifiBinding();

        // Acquire Multicast Lock to receive and send UDP broadcasts on Wi-Fi
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("dogremote_mcast");
                multicastLock.setReferenceCounted(true);
                multicastLock.acquire();
                Log.d(TAG, "MulticastLock acquired");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not acquire MulticastLock", e);
        }

        // Load or initialize host security PIN & settings
        SharedPreferences prefs = getSharedPreferences("DogRemotePrefs", Context.MODE_PRIVATE);
        hostPassword = prefs.getString("host_password", "");
        isPasswordRequired = prefs.getBoolean("require_password", true);
        isControlAllowed = prefs.getBoolean("allow_control", true);
        if (hostPassword.isEmpty()) {
            hostPassword = String.valueOf((int) (100000 + Math.random() * 900000));
            prefs.edit().putString("host_password", hostPassword)
                    .putBoolean("require_password", isPasswordRequired)
                    .putBoolean("allow_control", isControlAllowed)
                    .apply();
        }

        // Expose Native JavaScript Bridge for Phone Screen Sharing
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void startSharing() {
                    runOnUiThread(() -> requestScreenCapture());
                }

                @android.webkit.JavascriptInterface
                public void stopSharing() {
                    runOnUiThread(() -> stopScreenCapture());
                }

                @android.webkit.JavascriptInterface
                public void openAccessibilitySettings() {
                    runOnUiThread(() -> {
                        try {
                            Intent intent = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        } catch (Exception e) {
                            Log.e(TAG, "Cannot open accessibility settings", e);
                        }
                    });
                }

                @android.webkit.JavascriptInterface
                public boolean isAccessibilityEnabled() {
                    return DogAccessibilityService.getInstance() != null;
                }

                @android.webkit.JavascriptInterface
                public String getConnectedClientsInfo() {
                    JSONObject res = new JSONObject();
                    try {
                        res.put("count", ScreenShareService.getClientCount());
                        res.put("sharing", isSharingScreen);
                    } catch (Exception ignored) {}
                    return res.toString();
                }

                @android.webkit.JavascriptInterface
                public void setHostSecurity(String password, boolean requirePassword, boolean allowControl) {
                    hostPassword = (password != null) ? password.trim() : "";
                    isPasswordRequired = requirePassword;
                    isControlAllowed = allowControl;
                    SharedPreferences p = getSharedPreferences("DogRemotePrefs", Context.MODE_PRIVATE);
                    p.edit().putString("host_password", hostPassword)
                            .putBoolean("require_password", isPasswordRequired)
                            .putBoolean("allow_control", isControlAllowed)
                            .apply();
                    Log.d(TAG, "Host security updated: PIN=" + (isPasswordRequired ? hostPassword : "DISABLED") + ", allowControl=" + isControlAllowed);
                }

                @android.webkit.JavascriptInterface
                public void setHostPassword(String password, boolean requirePassword) {
                    setHostSecurity(password, requirePassword, isControlAllowed);
                }

                @android.webkit.JavascriptInterface
                public String getHostPassword() {
                    return hostPassword != null ? hostPassword : "";
                }

                @android.webkit.JavascriptInterface
                public boolean isPasswordRequired() {
                    return isPasswordRequired;
                }

                @android.webkit.JavascriptInterface
                public boolean isControlAllowed() {
                    return isControlAllowed;
                }
            }, "DogRemoteNativeBridge");
        }

        // Listen to ScreenShareService client status updates
        ScreenShareService.setClientListener((count, clientName, clientIp, joined) -> {
            notifyWebviewClientsChanged(count, clientName, clientIp, joined);
        });

        // Start Background UDP and TCP Discovery
        startDiscoveryWorker();
    }

    public void requestScreenCapture() {
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm != null) {
            startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION);
        }
    }

    public void stopScreenCapture() {
        isSharingScreen = false;
        Intent serviceIntent = new Intent(this, ScreenShareService.class);
        serviceIntent.setAction(ScreenShareService.ACTION_STOP);
        startService(serviceIntent);
        notifyWebviewPhoneSharingChanged(false);

        // Broadcast offline UDP beacon so PCs remove the phone immediately
        new Thread(() -> {
            try {
                String localIp = getLocalIpAddress();
                if (localIp != null) {
                    JSONObject json = new JSONObject();
                    json.put("service", "lancast");
                    json.put("name", getDeviceName());
                    json.put("ip", localIp);
                    json.put("port", TCP_PORT);
                    json.put("sharing", false);
                    byte[] data = json.toString().getBytes("UTF-8");
                    DatagramSocket s = new DatagramSocket();
                    s.setBroadcast(true);
                    bindSocketToWifi(s);
                    s.send(new DatagramPacket(data, data.length, InetAddress.getByName("255.255.255.255"), UDP_PORT));
                    s.send(new DatagramPacket(data, data.length, InetAddress.getByName("192.168.8.185"), UDP_PORT));
                    s.close();
                }
            } catch (Exception ignored) {}
        }).start();
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_MEDIA_PROJECTION) {
            if (resultCode == RESULT_OK && data != null) {
                isSharingScreen = true;
                Intent serviceIntent = new Intent(this, ScreenShareService.class);
                serviceIntent.setAction(ScreenShareService.ACTION_START);
                serviceIntent.putExtra("resultCode", resultCode);
                serviceIntent.putExtra("data", data);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
                notifyWebviewPhoneSharingChanged(true);
            } else {
                isSharingScreen = false;
                notifyWebviewPhoneSharingChanged(false);
            }
        }
    }

    private void setupWifiBinding() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager == null) return;

            // Immediately check active networks and bind process to physical Wi-Fi (excluding VPN)
            for (Network net : connectivityManager.getAllNetworks()) {
                NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(net);
                if (caps != null 
                        && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) 
                        && !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) {
                    wifiNetwork = net;
                    boolean bound = connectivityManager.bindProcessToNetwork(net);
                    Log.d(TAG, "Initial bindProcessToNetwork to physical Wi-Fi: " + bound + " (net=" + net + ")");
                    bindSocketToWifi(tcpDiscoveryServer);
                    bindSocketToWifi(udpSocket);
                    break;
                }
            }

            // Register callback to track physical Wi-Fi network state
            NetworkRequest req = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                    .build();
            connectivityManager.registerNetworkCallback(req, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    wifiNetwork = network;
                    try {
                        boolean bound = connectivityManager.bindProcessToNetwork(network);
                        Log.d(TAG, "NetworkCallback onAvailable: bindProcessToNetwork to physical Wi-Fi: " + bound + " (net=" + network + ")");
                    } catch (Exception e) {
                        Log.w(TAG, "Error binding process to physical Wi-Fi network", e);
                    }
                    bindSocketToWifi(tcpDiscoveryServer);
                    bindSocketToWifi(udpSocket);
                    if (!isRunning) {
                        startDiscoveryWorker();
                    }
                }

                @Override
                public void onLinkPropertiesChanged(Network network, LinkProperties linkProperties) {
                    wifiNetwork = network;
                    try {
                        connectivityManager.bindProcessToNetwork(network);
                    } catch (Exception ignored) {}
                    bindSocketToWifi(tcpDiscoveryServer);
                    bindSocketToWifi(udpSocket);
                    String ip = getLocalIpAddress();
                    Log.d(TAG, "NetworkCallback onLinkPropertiesChanged: ip=" + ip);
                    if (ip != null && bridge != null && bridge.getWebView() != null) {
                        runOnUiThread(() -> {
                            try {
                                bridge.getWebView().evaluateJavascript(
                                    "if(typeof discoverLocalDevices === 'function') discoverLocalDevices();",
                                    null
                                );
                            } catch (Exception ignored) {}
                        });
                    }
                }

                @Override
                public void onLost(Network network) {
                    if (network.equals(wifiNetwork)) {
                        wifiNetwork = null;
                        try {
                            connectivityManager.bindProcessToNetwork(null);
                        } catch (Exception ignored) {}
                        Log.d(TAG, "Physical Wi-Fi network lost - clearing discovered peers");
                        discoveredPeers.clear();
                        notifyWebviewDisconnected();
                    }
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "setupWifiBinding error", e);
        }
    }

    private void startDiscoveryWorker() {
        isRunning = true;
        final String deviceName = getDeviceName();

        // 1. UDP Broadcast Beacon loop (Broadcast presence ONLY when actively sharing phone screen)
        new Thread(() -> {
            while (isRunning) {
                try {
                    String localIp = getLocalIpAddress();
                    if (localIp != null && isSharingScreen && ScreenShareService.getClientCount() == 0) {
                        JSONObject json = new JSONObject();
                        json.put("service", "lancast");
                        json.put("name", deviceName);
                        json.put("ip", localIp);
                        json.put("port", TCP_PORT);
                        json.put("sharing", true);
                        byte[] data = json.toString().getBytes("UTF-8");

                        DatagramSocket socket = new DatagramSocket();
                        socket.setBroadcast(true);
                        bindSocketToWifi(socket);

                        // Limited broadcast
                        try {
                            socket.send(new DatagramPacket(data, data.length, InetAddress.getByName("255.255.255.255"), UDP_PORT));
                        } catch (Exception ignored) {}

                        // Directed subnet broadcast
                        try {
                            int lastDot = localIp.lastIndexOf('.');
                            if (lastDot > 0) {
                                String bcast = localIp.substring(0, lastDot) + ".255";
                                socket.send(new DatagramPacket(data, data.length, InetAddress.getByName(bcast), UDP_PORT));
                            }
                        } catch (Exception ignored) {}

                        // Direct unicast to Linux PC host
                        try {
                            socket.send(new DatagramPacket(data, data.length, InetAddress.getByName("192.168.8.185"), UDP_PORT));
                        } catch (Exception ignored) {}

                        socket.close();
                    } else if (localIp == null) {
                        if (!discoveredPeers.isEmpty()) {
                            discoveredPeers.clear();
                            notifyWebviewDisconnected();
                        }
                    }
                } catch (Exception e) {
                    Log.v(TAG, "Beacon send error: " + e.getMessage());
                }

                try {
                    Thread.sleep(2500);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "DogRemote-Beacon").start();

        // 2. UDP Listener loop (Listen for PC host beacons on port 5857)
        new Thread(() -> {
            try {
                udpSocket = new DatagramSocket(null);
                udpSocket.setReuseAddress(true);
                udpSocket.setBroadcast(true);
                bindSocketToWifi(udpSocket);
                udpSocket.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), UDP_PORT));
                Log.d(TAG, "UDP listener bound to 0.0.0.0:" + UDP_PORT);

                byte[] buf = new byte[2048];

                while (isRunning) {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    udpSocket.receive(packet);

                    String hostIp = packet.getAddress().getHostAddress();
                    if (hostIp != null && hostIp.startsWith("::ffff:")) {
                        hostIp = hostIp.substring(7);
                    }
                    if (isLocalIpAddress(hostIp)) {
                        continue;
                    }

                    String raw = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                    try {
                        JSONObject obj = new JSONObject(raw);
                        String service = obj.optString("service", "");
                        if ("lancast".equalsIgnoreCase(service)) {
                            String name = obj.optString("name", "DogRemote Host");
                            boolean peerSharing = obj.optBoolean("sharing", false);
                            if (name.toLowerCase().contains("mobile") || name.toLowerCase().contains("phone") || name.toLowerCase().contains("samsung")) {
                                continue;
                            }
                            if (peerSharing) {
                                discoveredPeers.put(hostIp, name);
                                notifyWebviewDeviceDiscovered(hostIp, name, true);
                            } else {
                                discoveredPeers.remove(hostIp);
                                notifyWebviewDeviceLost(hostIp);
                            }
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.d(TAG, "UDP listener exited: " + e.getMessage());
            }
        }, "DogRemote-UdpListener").start();

        // 3. TCP Server loop (Responds to HTTP GET /info probes, and serves stream when sharing)
        new Thread(() -> {
            try {
                tcpDiscoveryServer = new ServerSocket();
                tcpDiscoveryServer.setReuseAddress(true);
                bindSocketToWifi(tcpDiscoveryServer);
                tcpDiscoveryServer.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), TCP_PORT));
                bindSocketToWifi(tcpDiscoveryServer);
                Log.d(TAG, "TCP Server listening on 0.0.0.0:" + TCP_PORT);
                while (isRunning) {
                    try {
                        Socket client = tcpDiscoveryServer.accept();
                        bindSocketToWifi(client);
                        new Thread(() -> handleIncomingTcpClient(client, deviceName), "DogRemote-ClientHandler").start();
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.d(TAG, "TCP Server stopped: " + e.getMessage());
            }
        }, "DogRemote-TcpResponder").start();

        // 4. Native Proactive TCP Subnet Scanner (Direct standard raw Java sockets)
        new Thread(() -> {
            try {
                Thread.sleep(800);
            } catch (InterruptedException ignored) {}

            Log.d(TAG, "Native scanner thread started!");
            while (isRunning) {
                try {
                    // Pause background scanner during active screen sharing to client to keep Wi-Fi free
                    if (isSharingScreen || ScreenShareService.getClientCount() > 0) {
                        try {
                            Thread.sleep(4000);
                        } catch (InterruptedException e) {
                            break;
                        }
                        continue;
                    }

                    String myIp = getLocalIpAddress();
                    if (myIp != null && myIp.contains(".")) {
                        String prefix = myIp.substring(0, myIp.lastIndexOf('.'));

                        // Priority 1: Common host IPs
                        String[] priority = {"192.168.8.185", "192.168.8.194"};
                        for (String target : priority) {
                            if (!target.equals(myIp)) probeTarget(target, TCP_PORT);
                        }

                        // Priority 2: Nearby IP offsets
                        for (int i = 180; i <= 200; i++) {
                            String target = prefix + "." + i;
                            if (!target.equals(myIp)) probeTarget(target, TCP_PORT);
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Native scanner error", e);
                }

                try {
                    Thread.sleep(8000);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "DogRemote-NativeScanner").start();

        // 5. Periodic Webview Discovery Sync (keeps UI updated for any discovered peers)
        new Thread(() -> {
            while (isRunning) {
                try {
                    Thread.sleep(2000);
                    if (!discoveredPeers.isEmpty()) {
                        for (Map.Entry<String, String> entry : discoveredPeers.entrySet()) {
                            notifyWebviewDeviceDiscovered(entry.getKey(), entry.getValue(), true);
                        }
                    }
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "DogRemote-UiSync").start();
    }

    private void handleIncomingTcpClient(Socket client, String deviceName) {
        try {
            client.setSoTimeout(5000);
            client.setTcpNoDelay(true);
            InputStream is = client.getInputStream();
            byte[] head = new byte[5];
            int r = 0;
            while (r < 5) {
                int m = is.read(head, r, 5 - r);
                if (m <= 0) break;
                r += m;
            }

            if (r > 0) {
                // Check if HTTP GET probe (e.g. "GET /info")
                if (head[0] == 'G' && head[1] == 'E' && head[2] == 'T') {
                    String localIp = getLocalIpAddress();
                    String body = "{\"service\":\"lancast\",\"name\":\"" + deviceName + "\",\"ip\":\"" + (localIp != null ? localIp : "") + "\",\"port\":5859,\"sharing\":" + isSharingScreen + "}";
                    String resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " + body.length() + "\r\nConnection: close\r\n\r\n" + body;
                    client.getOutputStream().write(resp.getBytes("UTF-8"));
                    client.getOutputStream().flush();
                    client.close();
                } else if (head[0] == 2) { // TYPE_CONNECT_REQ
                    String peerName = "Remote PC";
                    String providedPassword = "";
                    boolean reqControl = true;
                    int reqLen = ((head[1] & 0xFF) << 24) | ((head[2] & 0xFF) << 16) | ((head[3] & 0xFF) << 8) | (head[4] & 0xFF);
                    if (reqLen > 0 && reqLen < 65536) {
                        byte[] reqPayload = new byte[reqLen];
                        int readTotal = 0;
                        while (readTotal < reqLen) {
                            int count = is.read(reqPayload, readTotal, reqLen - readTotal);
                            if (count < 0) break;
                            readTotal += count;
                        }
                        try {
                            JSONObject reqObj = new JSONObject(new String(reqPayload, "UTF-8"));
                            peerName = reqObj.optString("name", "Remote PC");
                            providedPassword = reqObj.optString("password", "").trim();
                            reqControl = reqObj.optBoolean("req_control", true);
                        } catch (Exception ignored) {}
                    }

                    // Security check: Verify host security password
                    if (isPasswordRequired && hostPassword != null && !hostPassword.isEmpty()) {
                        if (providedPassword.isEmpty()) {
                            Log.w(TAG, "Rejecting connection from " + peerName + ": PASSWORD_REQUIRED");
                            JSONObject resJson = new JSONObject();
                            resJson.put("accepted", false);
                            resJson.put("reason", "PASSWORD_REQUIRED");
                            byte[] payload = resJson.toString().getBytes("UTF-8");
                            ByteBuffer bb = ByteBuffer.allocate(1 + 4 + payload.length);
                            bb.put((byte) 3); // TYPE_CONNECT_RES
                            bb.putInt(payload.length);
                            bb.put(payload);
                            client.getOutputStream().write(bb.array());
                            client.getOutputStream().flush();
                            client.close();
                            return;
                        } else if (!providedPassword.equals(hostPassword)) {
                            Log.w(TAG, "Rejecting connection from " + peerName + ": PASSWORD_INCORRECT");
                            JSONObject resJson = new JSONObject();
                            resJson.put("accepted", false);
                            resJson.put("reason", "PASSWORD_INCORRECT");
                            byte[] payload = resJson.toString().getBytes("UTF-8");
                            ByteBuffer bb = ByteBuffer.allocate(1 + 4 + payload.length);
                            bb.put((byte) 3); // TYPE_CONNECT_RES
                            bb.putInt(payload.length);
                            bb.put(payload);
                            client.getOutputStream().write(bb.array());
                            client.getOutputStream().flush();
                            client.close();
                            return;
                        }
                    }

                    if (!isSharingScreen) {
                        // Remote PC wants to view phone screen! Prompt user on phone screen immediately.
                        Log.d(TAG, "Incoming screen view request from PC! Prompting user to allow screen capture...");
                        runOnUiThread(() -> {
                            try {
                                Intent bringToFront = new Intent(MainActivity.this, MainActivity.class);
                                bringToFront.setFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                startActivity(bringToFront);
                            } catch (Exception ignored) {}
                            requestScreenCapture();
                        });

                        // Wait up to 15 seconds for user to confirm the permission dialog on phone
                        long startWait = System.currentTimeMillis();
                        while ((!isSharingScreen || ScreenShareService.getInstance() == null) && (System.currentTimeMillis() - startWait < 15000) && isRunning && !client.isClosed()) {
                            try {
                                Thread.sleep(200);
                            } catch (InterruptedException e) {
                                break;
                            }
                        }
                    }

                    if (isSharingScreen && ScreenShareService.getInstance() != null) {
                        // Accept connection and start streaming phone frames to PC
                        JSONObject resJson = new JSONObject();
                        resJson.put("accepted", true);
                        JSONObject perms = new JSONObject();
                        perms.put("screen", true);
                        perms.put("control", reqControl && isControlAllowed);
                        perms.put("audio", false);
                        resJson.put("permissions", perms);
                        byte[] payload = resJson.toString().getBytes("UTF-8");

                        ByteBuffer bb = ByteBuffer.allocate(1 + 4 + payload.length);
                        bb.put((byte) 3); // TYPE_CONNECT_RES
                        bb.putInt(payload.length);
                        bb.put(payload);
                        client.getOutputStream().write(bb.array());
                        client.getOutputStream().flush();

                        String clientIp = "";
                        if (client.getInetAddress() != null) {
                            clientIp = client.getInetAddress().getHostAddress();
                            if (clientIp != null && clientIp.startsWith("::ffff:")) {
                                clientIp = clientIp.substring(7);
                            }
                        }
                        if (clientIp == null || clientIp.isEmpty()) {
                            clientIp = "PC Client";
                        }

                        // Add to streaming clients and do NOT close client socket!
                        ScreenShareService.addStreamingClient(client, peerName, clientIp);
                        return;
                    } else {
                        // Rejected or user did not start screen sharing
                        JSONObject resJson = new JSONObject();
                        resJson.put("accepted", false);
                        resJson.put("reason", "Phone screen sharing was not started. Please tap Start on the phone dialog.");
                        byte[] payload = resJson.toString().getBytes("UTF-8");
                        ByteBuffer bb = ByteBuffer.allocate(1 + 4 + payload.length);
                        bb.put((byte) 3); // TYPE_CONNECT_RES
                        bb.putInt(payload.length);
                        bb.put(payload);
                        client.getOutputStream().write(bb.array());
                        client.getOutputStream().flush();
                        client.close();
                    }
                } else {
                    client.close();
                }
            } else {
                client.close();
            }
        } catch (Exception e) {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    private void probeTarget(String ip, int port) {
        try {
            Socket s = new Socket();
            s.setTcpNoDelay(true);
            s.setReuseAddress(true);
            bindSocketToWifi(s);
            s.connect(new InetSocketAddress(ip, port), 1200);
            s.setSoTimeout(1500);

            // Send HTTP GET /info for instant host identity and sharing status
            String req = "GET /info HTTP/1.1\r\nHost: " + ip + ":" + port + "\r\nConnection: close\r\n\r\n";
            s.getOutputStream().write(req.getBytes("UTF-8"));
            s.getOutputStream().flush();

            byte[] buf = new byte[1024];
            int n = s.getInputStream().read(buf);
            s.close();

            if (n > 0) {
                String resp = new String(buf, 0, n, "UTF-8");
                String hostName = "DogRemote Host";
                boolean isSharing = false;
                if (resp.contains("{")) {
                    try {
                        int start = resp.indexOf('{');
                        int end = resp.lastIndexOf('}');
                        if (start >= 0 && end > start) {
                            JSONObject obj = new JSONObject(resp.substring(start, end + 1));
                            String parsedName = obj.optString("name", obj.optString("host", ""));
                            if (!parsedName.isEmpty()) {
                                hostName = parsedName;
                            }
                            isSharing = obj.optBoolean("sharing", false);
                        }
                    } catch (Exception ignored) {}
                }
                if (isSharing) {
                    Log.d(TAG, "VERIFIED DogRemote Host (Sharing Screen): " + ip + " (" + hostName + ")");
                    discoveredPeers.put(ip, hostName);
                    notifyWebviewDeviceDiscovered(ip, hostName, true);
                } else {
                    discoveredPeers.remove(ip);
                    notifyWebviewDeviceLost(ip);
                }
            }
        } catch (Exception e) {
            if ("192.168.8.185".equals(ip)) {
                Log.v(TAG, "Probe to 192.168.8.185:" + port + " failed: " + e.getMessage());
            }
        }
    }

    private boolean isLocalIpAddress(String ip) {
        if (ip == null || ip.isEmpty() || ip.startsWith("127.") || ip.startsWith("26.") || ip.equals("localhost")) {
            return true;
        }
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                    if (ip.equals(addr.getHostAddress())) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private void notifyWebviewDeviceDiscovered(final String ip, final String name, final boolean sharing) {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String safeName = name.replace("'", "\\'");
                    String myName = getDeviceName().replace("'", "\\'");
                    String js = "window.myDeviceName = '" + myName + "'; " +
                                "window.startPhoneScreenShare = function() { if (window.DogRemoteNativeBridge) window.DogRemoteNativeBridge.startSharing(); }; " +
                                "window.stopPhoneScreenShare = function() { if (window.DogRemoteNativeBridge) window.DogRemoteNativeBridge.stopSharing(); }; " +
                                "if (window.onPeerDiscovered) { window.onPeerDiscovered('" + ip + "', '" + safeName + "', " + sharing + "); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    private void notifyWebviewDeviceLost(final String ip) {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String js = "if (window.onPeerLost) { window.onPeerLost('" + ip + "'); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    private void notifyWebviewDisconnected() {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String js = "if (window.clearDiscoveredDevices) { window.clearDiscoveredDevices('Wi-Fi Disconnected'); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    private void notifyWebviewPhoneSharingChanged(final boolean active) {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String js = "if (window.setPhoneSharingState) { window.setPhoneSharingState(" + active + "); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    public void notifyWebviewClientsChanged(final int count, final String clientName, final String clientIp, final boolean joined) {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String cleanName = clientName != null ? clientName.replace("'", "\\'") : "Remote Device";
                    String cleanIp = clientIp != null ? clientIp.replace("'", "\\'") : "";
                    String js = "if (window.onHostClientsChanged) { window.onHostClientsChanged(" 
                            + count + ", '" + cleanName + "', '" + cleanIp + "', " + joined + "); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        ScreenShareService.setClientListener((count, clientName, clientIp, joined) -> {
            notifyWebviewClientsChanged(count, clientName, clientIp, joined);
        });
        int currentCount = ScreenShareService.getClientCount();
        notifyWebviewClientsChanged(currentCount, "Remote Device", "", false);
        notifyWebviewPhoneSharingChanged(isSharingScreen);
    }

    private String getLocalIpAddress() {
        try {
            if (connectivityManager != null && wifiNetwork != null) {
                LinkProperties lp = connectivityManager.getLinkProperties(wifiNetwork);
                if (lp != null) {
                    for (LinkAddress la : lp.getLinkAddresses()) {
                        InetAddress addr = la.getAddress();
                        if (addr != null && !addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                            String ip = addr.getHostAddress();
                            if (ip != null && !ip.startsWith("26.") && !ip.startsWith("127.")) {
                                return ip;
                            }
                        }
                    }
                }
            }
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                String ifName = intf.getName().toLowerCase();
                if (ifName.contains("wlan") || ifName.contains("eth") || ifName.contains("swlan") || ifName.contains("ap")) {
                    for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                        if (!addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                            String ip = addr.getHostAddress();
                            if (ip != null && !ip.startsWith("26.") && !ip.startsWith("127.")) {
                                return ip;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (isSharingScreen) {
            stopScreenCapture();
        }
        try {
            stopService(new Intent(this, ScreenShareService.class));
        } catch (Exception ignored) {}
        if (udpSocket != null && !udpSocket.isClosed()) {
            udpSocket.close();
        }
        if (tcpDiscoveryServer != null && !tcpDiscoveryServer.isClosed()) {
            try {
                tcpDiscoveryServer.close();
            } catch (Exception ignored) {}
        }
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
        instance = null;
        super.onDestroy();
    }
}
