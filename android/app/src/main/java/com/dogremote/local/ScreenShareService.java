package com.dogremote.local;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.wifi.WifiManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.view.WindowManager;
import android.util.DisplayMetrics;
import android.util.Log;
import android.widget.Toast;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class ScreenShareService extends Service {
    private static final String TAG = "DogRemoteScreenShare";
    private static final String CHANNEL_ID = "dogremote_share_channel";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.dogremote.local.START_SHARE";
    public static final String ACTION_STOP = "com.dogremote.local.STOP_SHARE";

    private static volatile ScreenShareService instance = null;
    private final List<Socket> clientSockets = new CopyOnWriteArrayList<>();

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private Thread heartbeatThread = null;
    private PowerManager.WakeLock wakeLock = null;
    private WifiManager.WifiLock wifiLock = null;
    private volatile boolean isCapturing = false;
    private volatile byte[] lastFrameBytes = null;
    private long lastFrameTime = 0;
    private float lastNormX = 0.5f;
    private float lastNormY = 0.5f;
    private float mouseDownNormX = -1f;
    private float mouseDownNormY = -1f;
    private long mouseDownTime = 0;
    private volatile boolean isLeftMouseDown = false;

    public static ScreenShareService getInstance() {
        return instance;
    }

    public interface ClientListener {
        void onClientCountChanged(int count, String clientName, String clientIp, boolean joined);
    }

    private static volatile ClientListener clientListener = null;

    public static void setClientListener(ClientListener listener) {
        clientListener = listener;
    }

    public static int getClientCount() {
        return instance != null ? instance.clientSockets.size() : 0;
    }

    public static String getSocketIp(Socket socket) {
        try {
            if (socket != null && socket.getInetAddress() != null) {
                String ip = socket.getInetAddress().getHostAddress();
                if (ip != null && ip.startsWith("::ffff:")) {
                    return ip.substring(7);
                }
                return ip != null ? ip : "Remote Device";
            }
        } catch (Exception ignored) {}
        return "Remote Device";
    }

    public static void addStreamingClient(Socket socket) {
        addStreamingClient(socket, "Remote Device", getSocketIp(socket));
    }

    public static void addStreamingClient(Socket socket, String clientName, String clientIp) {
        if (instance != null) {
            try {
                MainActivity.bindSocketToPhysicalWifi(socket);
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(0);
            } catch (Exception ignored) {}
            instance.clientSockets.add(socket);
            Log.d(TAG, "Added streaming client: " + clientName + " (" + clientIp + ") (total: " + instance.clientSockets.size() + ")");

            if (clientListener != null) {
                try {
                    clientListener.onClientCountChanged(instance.clientSockets.size(), clientName, clientIp, true);
                } catch (Exception ignored) {}
            }

            // Send initial frame immediately if already captured so viewer never starts with black screen
            byte[] initialFrame = instance.lastFrameBytes;
            if (initialFrame != null) {
                try {
                    ByteBuffer bb = ByteBuffer.allocate(1 + 4 + 8 + initialFrame.length);
                    bb.order(ByteOrder.BIG_ENDIAN);
                    bb.put((byte) 1); // TYPE_FRAME
                    bb.putInt(8 + initialFrame.length);
                    bb.putDouble((double) System.currentTimeMillis() / 1000.0);
                    bb.put(initialFrame);
                    byte[] packet = bb.array();
                    synchronized (socket) {
                        OutputStream os = socket.getOutputStream();
                        os.write(packet);
                        os.flush();
                    }
                } catch (Exception ignored) {}
            }

            // Start client listener thread to handle pings and monitor connection lifecycle
            new Thread(() -> {
                try {
                    InputStream in = socket.getInputStream();
                    OutputStream out = socket.getOutputStream();
                    byte[] hdr = new byte[5];
                    while (instance != null && !socket.isClosed()) {
                        int r = in.read(hdr);
                        if (r <= 0) break;
                        while (r < 5) {
                            int more = in.read(hdr, r, 5 - r);
                            if (more <= 0) break;
                            r += more;
                        }
                        if (r < 5) break;

                        int type = hdr[0] & 0xFF;
                        int len = ((hdr[1] & 0xFF) << 24) | ((hdr[2] & 0xFF) << 16) | ((hdr[3] & 0xFF) << 8) | (hdr[4] & 0xFF);
                        byte[] body = new byte[len];
                        int total = 0;
                        while (total < len) {
                            int n = in.read(body, total, len - total);
                            if (n <= 0) break;
                            total += n;
                        }
                        if (total < len) break;

                        // Respond to PING (type 7) with PONG (type 8)
                        if (type == 7) {
                            ByteBuffer pong = ByteBuffer.allocate(1 + 4 + len);
                            pong.put((byte) 8); // TYPE_PONG
                            pong.putInt(len);
                            pong.put(body);
                            synchronized (socket) {
                                out.write(pong.array());
                                out.flush();
                            }
                        } else if (type == 9) { // TYPE_DISCONNECT
                            break;
                        } else if (type == 4) { // TYPE_INPUT_MOUSE_MOVE
                            if (len >= 8 && instance != null) {
                                ByteBuffer bb = ByteBuffer.wrap(body);
                                bb.order(ByteOrder.BIG_ENDIAN);
                                float nx = bb.getFloat();
                                float ny = bb.getFloat();
                                instance.handleMouseMove(nx, ny);
                            }
                        } else if (type == 5) { // TYPE_INPUT_MOUSE_CLICK
                            if (instance != null) {
                                String jsonStr = new String(body, "UTF-8");
                                instance.handleMouseClick(jsonStr);
                            }
                        } else if (type == 6) { // TYPE_INPUT_KEY
                            if (instance != null) {
                                String jsonStr = new String(body, "UTF-8");
                                instance.handleKeyInput(jsonStr);
                            }
                        } else if (type == 10) { // TYPE_INPUT_SCROLL
                            if (len >= 4 && instance != null) {
                                ByteBuffer bb = ByteBuffer.wrap(body);
                                bb.order(ByteOrder.BIG_ENDIAN);
                                int steps = bb.getInt();
                                instance.handleScroll(steps);
                            }
                        } else if (type == 11) { // TYPE_CLIPBOARD
                            if (instance != null) {
                                String clipText = new String(body, "UTF-8");
                                instance.handleClipboard(clipText);
                            }
                        }
                    }
                } catch (Exception ignored) {}
                finally {
                    if (instance != null) {
                        instance.clientSockets.remove(socket);
                        if (clientListener != null) {
                            try {
                                clientListener.onClientCountChanged(instance.clientSockets.size(), clientName, clientIp, false);
                            } catch (Exception ignored) {}
                        }
                    }
                    try { socket.close(); } catch (Exception ignored) {}
                    Log.d(TAG, "Streaming client disconnected: " + clientName + " (" + clientIp + ")");
                }
            }).start();
        }
    }

    public void handleMouseMove(float nx, float ny) {
        lastNormX = nx;
        lastNormY = ny;
        if (isLeftMouseDown && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            DogAccessibilityService a11y = DogAccessibilityService.getInstance();
            if (a11y != null) {
                int[] realSize = getRealScreenSize();
                float px = Math.max(1f, Math.min(realSize[0] - 2f, nx * realSize[0]));
                float py = Math.max(1f, Math.min(realSize[1] - 2f, ny * realSize[1]));
                a11y.touchMove(px, py);
            }
        }
    }

    private int[] getRealScreenSize() {
        try {
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Rect bounds = wm.getMaximumWindowMetrics().getBounds();
                    return new int[]{bounds.width(), bounds.height()};
                } else {
                    DisplayMetrics dm = new DisplayMetrics();
                    wm.getDefaultDisplay().getRealMetrics(dm);
                    return new int[]{dm.widthPixels, dm.heightPixels};
                }
            }
        } catch (Exception ignored) {}
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return new int[]{dm.widthPixels, dm.heightPixels};
    }

    public void handleMouseClick(String jsonStr) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String button = obj.optString("button", "left");
            String action = obj.optString("action", "click");
            float nx = (float) obj.optDouble("x", lastNormX);
            float ny = (float) obj.optDouble("y", lastNormY);
            lastNormX = nx;
            lastNormY = ny;

            int[] realSize = getRealScreenSize();
            float px = Math.max(1f, Math.min(realSize[0] - 2f, nx * realSize[0]));
            float py = Math.max(1f, Math.min(realSize[1] - 2f, ny * realSize[1]));

            DogAccessibilityService a11y = DogAccessibilityService.getInstance();
            if (a11y == null) {
                Log.w(TAG, "Touch/Click ignored: DogAccessibilityService is not enabled!");
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        Toast.makeText(getApplicationContext(), "Turn ON DogRemote in Accessibility Settings to enable remote control", Toast.LENGTH_SHORT).show();
                    } catch (Exception ignored) {}
                });
                return;
            }

            if ("right".equals(button)) {
                // Right click on PC acts as Android Back button
                if ("down".equals(action) || "click".equals(action)) {
                    a11y.pressBack();
                }
            } else if ("middle".equals(button)) {
                // Middle click on PC acts as Android Home button
                if ("down".equals(action) || "click".equals(action)) {
                    a11y.pressHome();
                }
            } else {
                // Left click / Touch
                if ("down".equals(action)) {
                    isLeftMouseDown = true;
                    mouseDownNormX = nx;
                    mouseDownNormY = ny;
                    mouseDownTime = System.currentTimeMillis();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        a11y.touchDown(px, py);
                    }
                } else if ("up".equals(action)) {
                    isLeftMouseDown = false;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        a11y.touchUp(px, py);
                    } else {
                        float startX = (mouseDownNormX >= 0) ? Math.max(1f, Math.min(realSize[0] - 2f, mouseDownNormX * realSize[0])) : px;
                        float startY = (mouseDownNormY >= 0) ? Math.max(1f, Math.min(realSize[1] - 2f, mouseDownNormY * realSize[1])) : py;
                        long dur = (mouseDownTime > 0) ? (System.currentTimeMillis() - mouseDownTime) : 50;
                        float dist = (float) Math.hypot(px - startX, py - startY);

                        if (dist > 25) {
                            a11y.drag(startX, startY, px, py, Math.min(Math.max(dur, 120), 800));
                        } else {
                            a11y.tap(startX, startY);
                        }
                    }
                    mouseDownNormX = -1f;
                    mouseDownNormY = -1f;
                    mouseDownTime = 0;
                } else if ("click".equals(action)) {
                    a11y.tap(px, py);
                    mouseDownNormX = -1f;
                    mouseDownNormY = -1f;
                    mouseDownTime = 0;
                } else if ("dblclick".equals(action)) {
                    a11y.tap(px, py);
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (DogAccessibilityService.getInstance() != null) {
                            DogAccessibilityService.getInstance().tap(px, py);
                        }
                    }, 120);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling mouse click: " + e.getMessage());
        }
    }

    public void handleScroll(int steps) {
        DogAccessibilityService a11y = DogAccessibilityService.getInstance();
        if (a11y != null) {
            a11y.scroll(steps);
        }
    }

    public void handleKeyInput(String jsonStr) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String key = obj.optString("key", "");
            String action = obj.optString("action", "down");

            DogAccessibilityService a11y = DogAccessibilityService.getInstance();
            if (a11y == null) return;

            boolean isTrigger = "down".equals(action) || "key".equals(action) || "type".equals(action);
            if (!isTrigger) return;

            if ("Escape".equals(key) || "Back".equals(key)) {
                a11y.pressBack();
            } else if ("Super_L".equals(key) || "Home".equals(key)) {
                a11y.pressHome();
            } else if ("BackSpace".equals(key) || "Delete".equals(key)) {
                a11y.backspace();
            } else if ("Return".equals(key) || "Enter".equals(key)) {
                a11y.pressEnter();
            } else if ("space".equals(key)) {
                a11y.typeText(" ");
            } else if ("Tab".equals(key)) {
                a11y.typeText("\t");
            } else if ("Control_L".equals(key) || "Alt_L".equals(key) || "Shift_L".equals(key)) {
                // Modifier keys by themselves ignored
            } else if (key.length() > 0) {
                a11y.typeText(key);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling key input: " + e.getMessage());
        }
    }

    public void handleClipboard(String clipText) {
        try {
            new Handler(Looper.getMainLooper()).post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    ClipData clip = ClipData.newPlainText("DogRemote", clipText);
                    cm.setPrimaryClip(clip);
                    Log.d(TAG, "Synced clipboard from PC: " + (clipText.length() > 20 ? clipText.substring(0, 20) + "..." : clipText));
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error handling clipboard: " + e.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "DogRemote Screen Sharing",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("DogRemote Local Screen Share Active");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopScreenCapture();
            stopSelf();
            return START_NOT_STICKY;
        } else if (ACTION_START.equals(action)) {
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("DogRemote Screen Sharing")
                .setContentText("Sharing phone screen over local Wi-Fi")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            int resultCode = intent.getIntExtra("resultCode", Activity.RESULT_CANCELED);
            Intent data;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                data = intent.getParcelableExtra("data", Intent.class);
            } else {
                data = intent.getParcelableExtra("data");
            }

            if (resultCode == Activity.RESULT_OK && data != null) {
                startScreenCapture(resultCode, data);
            } else {
                Log.e(TAG, "Cannot start capture: resultCode=" + resultCode + " (RESULT_OK=" + Activity.RESULT_OK + "), data=" + data);
            }
        }
        return START_NOT_STICKY;
    }

    private void startScreenCapture(int resultCode, Intent data) {
        stopScreenCapture();
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mpm == null) {
                Log.e(TAG, "MediaProjectionManager is null");
                return;
            }
            mediaProjection = mpm.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                Log.e(TAG, "getMediaProjection returned null");
                return;
            }

            DisplayMetrics dm = getResources().getDisplayMetrics();
            int[] realSize = getRealScreenSize();
            int screenWidth = realSize[0];
            int screenHeight = realSize[1];

            // Target max 720 width for ultra low-latency capture and high FPS
            int targetWidth = Math.min(720, screenWidth);
            int targetHeight = (int) ((float) screenHeight * targetWidth / screenWidth);
            targetWidth = (targetWidth / 2) * 2;
            targetHeight = (targetHeight / 2) * 2;
            final int width = targetWidth;
            final int height = targetHeight;
            int density = dm.densityDpi;

            captureThread = new HandlerThread("ScreenCaptureThread");
            captureThread.start();
            captureHandler = new Handler(captureThread.getLooper());

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    super.onStop();
                    Log.d(TAG, "MediaProjection stopped by system");
                    stopScreenCapture();
                }
            }, captureHandler);

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "DogRemoteDisplay",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, captureHandler
            );

            isCapturing = true;

            // Acquire WakeLock and WifiLock to prevent Wi-Fi power-save dropping incoming streaming connections
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DogRemote::ScreenShareWakeLock");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire(60 * 60 * 1000L); // Max 1 hour safety timeout
                }
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "DogRemote::ScreenShareWifiLock");
                    } else {
                        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "DogRemote::ScreenShareWifiLock");
                    }
                    wifiLock.setReferenceCounted(false);
                    wifiLock.acquire();
                }
                Log.d(TAG, "WakeLock and WifiLock acquired for low-latency Wi-Fi streaming");
            } catch (Exception e) {
                Log.w(TAG, "Could not acquire WakeLock/WifiLock", e);
            }

            // Heartbeat thread keeps viewer updated even on static screens (2-3 FPS keepalive)
            heartbeatThread = new Thread(() -> {
                while (isCapturing) {
                    try {
                        Thread.sleep(300);
                        if (!clientSockets.isEmpty() && lastFrameBytes != null) {
                            long now = System.currentTimeMillis();
                            if (now - lastFrameTime >= 350) {
                                broadcastFrame(lastFrameBytes);
                            }
                        }
                    } catch (InterruptedException ignored) {
                        break;
                    } catch (Exception ignored) {}
                }
            }, "DogRemote-Heartbeat");
            heartbeatThread.start();

            imageReader.setOnImageAvailableListener(reader -> {
                if (!isCapturing) {
                    Image img = reader.acquireLatestImage();
                    if (img != null) img.close();
                    return;
                }

                // If no clients are connected and we already have a cached frame, skip to save CPU
                if (clientSockets.isEmpty() && lastFrameBytes != null) {
                    Image img = reader.acquireLatestImage();
                    if (img != null) img.close();
                    return;
                }

                long now = System.currentTimeMillis();
                // Throttle to max 45-60 FPS (min 16ms between frames)
                if (clientSockets.size() > 0 && now - lastFrameTime < 16) {
                    Image img = reader.acquireLatestImage();
                    if (img != null) img.close();
                    return;
                }
                lastFrameTime = now;

                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image == null) return;

                    Image.Plane[] planes = image.getPlanes();
                    ByteBuffer buffer = planes[0].getBuffer();
                    int pixelStride = planes[0].getPixelStride();
                    int rowStride = planes[0].getRowStride();
                    int rowPadding = rowStride - pixelStride * width;

                    Bitmap bitmap = Bitmap.createBitmap(
                        width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888
                    );
                    bitmap.copyPixelsFromBuffer(buffer);

                    Bitmap cleanBitmap;
                    if (rowPadding != 0) {
                        cleanBitmap = Bitmap.createBitmap(bitmap, 0, 0, width, height);
                        bitmap.recycle();
                    } else {
                        cleanBitmap = bitmap;
                    }

                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    cleanBitmap.compress(Bitmap.CompressFormat.JPEG, 70, baos);
                    cleanBitmap.recycle();
                    byte[] jpegBytes = baos.toByteArray();

                    lastFrameBytes = jpegBytes;
                    broadcastFrame(jpegBytes);
                } catch (Exception e) {
                    Log.v(TAG, "Capture frame error: " + e.getMessage());
                } finally {
                    if (image != null) image.close();
                }
            }, captureHandler);

            Log.d(TAG, "Screen Capture started successfully (" + width + "x" + height + ")");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start screen capture", e);
        }
    }

    private void broadcastFrame(byte[] jpegBytes) {
        if (clientSockets.isEmpty()) return;

        // Pack frame according to LanCast Protocol:
        // Header: 1 byte TYPE_FRAME (1), 4 bytes length (8 + jpeg.length)
        // Payload: 8 bytes timestamp (double), jpeg bytes
        ByteBuffer bb = ByteBuffer.allocate(1 + 4 + 8 + jpegBytes.length);
        bb.order(ByteOrder.BIG_ENDIAN);
        bb.put((byte) 1); // TYPE_FRAME
        bb.putInt(8 + jpegBytes.length);
        bb.putDouble((double) System.currentTimeMillis() / 1000.0);
        bb.put(jpegBytes);
        byte[] packet = bb.array();

        for (Socket s : clientSockets) {
            try {
                if (s.isClosed()) {
                    clientSockets.remove(s);
                    continue;
                }
                synchronized (s) {
                    OutputStream os = s.getOutputStream();
                    os.write(packet);
                    os.flush();
                }
            } catch (Exception e) {
                try { s.close(); } catch (Exception ignored) {}
                clientSockets.remove(s);
            }
        }
    }

    private void stopScreenCapture() {
        isCapturing = false;
        clientSockets.clear();
        if (clientListener != null) {
            try {
                clientListener.onClientCountChanged(0, "", "", false);
            } catch (Exception ignored) {}
        }
        if (heartbeatThread != null) {
            heartbeatThread.interrupt();
            heartbeatThread = null;
        }
        lastFrameBytes = null;

        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        if (captureThread != null) {
            try { captureThread.quitSafely(); } catch (Exception ignored) {}
            captureThread = null;
            captureHandler = null;
        }

        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
        wakeLock = null;

        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {}
        wifiLock = null;

        Log.d(TAG, "Screen Capture stopped");
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopScreenCapture();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopScreenCapture();
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
