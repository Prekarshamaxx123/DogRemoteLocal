package com.dogremote.local;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
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

    private WifiManager.MulticastLock multicastLock;
    private ConnectivityManager connectivityManager;
    private volatile Network wifiNetwork = null;
    private volatile boolean isRunning = true;
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

        // Start Background UDP and TCP Discovery
        startDiscoveryWorker();
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
                }

                @Override
                public void onLost(Network network) {
                    if (network.equals(wifiNetwork)) {
                        wifiNetwork = null;
                        Log.d(TAG, "Physical Wi-Fi network lost");
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

        // 1. UDP Broadcast Beacon loop (Announce phone presence every 2.5 seconds to all devices on LAN)
        new Thread(() -> {
            while (isRunning) {
                try {
                    String localIp = getLocalIpAddress();
                    if (localIp != null && !localIp.isEmpty()) {
                        JSONObject json = new JSONObject();
                        json.put("service", "lancast");
                        json.put("name", deviceName);
                        json.put("ip", localIp);
                        json.put("port", TCP_PORT);
                        byte[] data = json.toString().getBytes("UTF-8");

                        DatagramSocket socket = new DatagramSocket();
                        socket.setBroadcast(true);

                        // Limited broadcast
                        try {
                            DatagramPacket packet = new DatagramPacket(
                                data, data.length, InetAddress.getByName("255.255.255.255"), UDP_PORT
                            );
                            socket.send(packet);
                        } catch (Exception ignored) {}

                        // Directed subnet broadcast (e.g. 192.168.8.255)
                        try {
                            int lastDot = localIp.lastIndexOf('.');
                            if (lastDot > 0) {
                                String bcast = localIp.substring(0, lastDot) + ".255";
                                DatagramPacket packet = new DatagramPacket(
                                    data, data.length, InetAddress.getByName(bcast), UDP_PORT
                                );
                                socket.send(packet);
                            }
                        } catch (Exception ignored) {}

                        // Direct unicast to Linux PC host
                        try {
                            DatagramPacket packet = new DatagramPacket(
                                data, data.length, InetAddress.getByName("192.168.8.185"), UDP_PORT
                            );
                            socket.send(packet);
                        } catch (Exception ignored) {}

                        socket.close();
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
                            if (name.toLowerCase().contains("mobile") || name.toLowerCase().contains("phone") || name.toLowerCase().contains("samsung")) {
                                continue;
                            }
                            Log.d(TAG, "Discovered Host via UDP: " + hostIp + " (" + name + ")");
                            discoveredPeers.put(hostIp, name);
                            notifyWebviewDeviceDiscovered(hostIp, name);
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.d(TAG, "UDP listener exited: " + e.getMessage());
            }
        }, "DogRemote-UdpListener").start();

        // 3. TCP Discovery Server loop (Port 5859 responder for PC subnet scans)
        new Thread(() -> {
            try {
                tcpDiscoveryServer = new ServerSocket();
                tcpDiscoveryServer.setReuseAddress(true);
                tcpDiscoveryServer.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), TCP_PORT));
                Log.d(TAG, "TCP Discovery Server listening on 0.0.0.0:" + TCP_PORT);
                while (isRunning) {
                    try {
                        Socket client = tcpDiscoveryServer.accept();
                        client.setSoTimeout(1500);
                        String localIp = getLocalIpAddress();
                        JSONObject json = new JSONObject();
                        json.put("service", "lancast");
                        json.put("name", deviceName);
                        json.put("ip", localIp != null ? localIp : "");
                        json.put("port", TCP_PORT);
                        byte[] data = (json.toString() + "\n").getBytes("UTF-8");
                        OutputStream os = client.getOutputStream();
                        os.write(data);
                        os.flush();

                        // Bilateral discovery: notify WebView about the host that probed us
                        String peerIp = client.getInetAddress().getHostAddress();
                        if (peerIp != null && peerIp.startsWith("::ffff:")) {
                            peerIp = peerIp.substring(7);
                        }
                        if (peerIp != null && !isLocalIpAddress(peerIp)) {
                            Log.d(TAG, "Discovered Host via TCP Probe: " + peerIp);
                            String hostName = "DogRemote Host (" + peerIp + ")";
                            discoveredPeers.put(peerIp, hostName);
                            notifyWebviewDeviceDiscovered(peerIp, hostName);
                        }
                        client.close();
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.d(TAG, "TCP Discovery Server stopped: " + e.getMessage());
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
                            notifyWebviewDeviceDiscovered(entry.getKey(), entry.getValue());
                        }
                    }
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "DogRemote-UiSync").start();
    }

    private void probeTarget(String ip, int port) {
        try {
            Socket s;
            if (wifiNetwork != null) {
                try {
                    s = wifiNetwork.getSocketFactory().createSocket();
                } catch (Exception se) {
                    s = new Socket();
                }
            } else {
                s = new Socket();
            }
            s.setTcpNoDelay(true);
            s.setReuseAddress(true);
            s.connect(new InetSocketAddress(ip, port), 1200);
            s.setSoTimeout(1500);

            // Send HTTP GET /info for instant host identity discovery
            String req = "GET /info HTTP/1.1\r\nHost: " + ip + ":" + port + "\r\nConnection: close\r\n\r\n";
            s.getOutputStream().write(req.getBytes("UTF-8"));
            s.getOutputStream().flush();

            byte[] buf = new byte[1024];
            int n = s.getInputStream().read(buf);
            s.close();

            if (n > 0) {
                String resp = new String(buf, 0, n, "UTF-8");
                String hostName = "DogRemote Host";
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
                        }
                    } catch (Exception ignored) {}
                }
                Log.d(TAG, "VERIFIED DogRemote Host: " + ip + " (" + hostName + ")");
                discoveredPeers.put(ip, hostName);
                notifyWebviewDeviceDiscovered(ip, hostName);
            }
        } catch (Exception e) {
            if ("192.168.8.185".equals(ip)) {
                Log.w(TAG, "Probe to 192.168.8.185:" + port + " failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
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

    private void notifyWebviewDeviceDiscovered(final String ip, final String name) {
        runOnUiThread(() -> {
            try {
                if (bridge != null && bridge.getWebView() != null) {
                    String safeName = name.replace("'", "\\'");
                    String myName = getDeviceName().replace("'", "\\'");
                    String js = "window.myDeviceName = '" + myName + "'; " +
                                "if (window.onPeerDiscovered) { window.onPeerDiscovered('" + ip + "', '" + safeName + "'); }";
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error evaluating JS", e);
            }
        });
    }

    private String getLocalIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            // Prioritize Wi-Fi interface (wlan, eth)
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                String ifName = intf.getName().toLowerCase();
                if (ifName.contains("wlan") || ifName.contains("eth")) {
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
            // Fallback: any standard private LAN IP (192.168.x.x, 10.x.x.x, 172.x.x.x)
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                String ifName = intf.getName().toLowerCase();
                if (ifName.contains("tun") || ifName.contains("dummy") || ifName.contains("p2p")) continue;
                for (InetAddress addr : Collections.list(intf.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                        String ip = addr.getHostAddress();
                        if (ip != null && (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."))) {
                            return ip;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return "192.168.8.169";
    }

    @Override
    public void onDestroy() {
        isRunning = false;
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
        super.onDestroy();
    }
}
