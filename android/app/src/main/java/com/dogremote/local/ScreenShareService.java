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
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.DisplayMetrics;
import android.util.Log;
import androidx.core.app.NotificationCompat;

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

    public static ScreenShareService getInstance() {
        return instance;
    }

    public static void addStreamingClient(Socket socket) {
        if (instance != null) {
            try {
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(0);
            } catch (Exception ignored) {}
            instance.clientSockets.add(socket);
            Log.d(TAG, "Added streaming client: " + socket.getRemoteSocketAddress() + " (total: " + instance.clientSockets.size() + ")");

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
                        }
                    }
                } catch (Exception ignored) {}
                finally {
                    if (instance != null) {
                        instance.clientSockets.remove(socket);
                    }
                    try { socket.close(); } catch (Exception ignored) {}
                    Log.d(TAG, "Streaming client disconnected: " + socket.getRemoteSocketAddress());
                }
            }).start();
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
            int screenWidth = dm.widthPixels;
            int screenHeight = dm.heightPixels;

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
