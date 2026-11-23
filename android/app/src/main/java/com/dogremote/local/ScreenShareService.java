package com.dogremote.local;

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
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
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
    private volatile boolean isCapturing = false;
    private long lastFrameTime = 0;

    public static ScreenShareService getInstance() {
        return instance;
    }

    public static void addStreamingClient(Socket socket) {
        if (instance != null) {
            instance.clientSockets.add(socket);
            Log.d(TAG, "Added streaming client: " + socket.getRemoteSocketAddress() + " (total: " + instance.clientSockets.size() + ")");
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

            int resultCode = intent.getIntExtra("resultCode", -1);
            Intent data = intent.getParcelableExtra("data");
            if (resultCode != -1 && data != null) {
                startScreenCapture(resultCode, data);
            }
        }
        return START_NOT_STICKY;
    }

    private void startScreenCapture(int resultCode, Intent data) {
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mpm == null) return;
            mediaProjection = mpm.getMediaProjection(resultCode, data);
            if (mediaProjection == null) return;

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

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "DogRemoteDisplay",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, captureHandler
            );

            isCapturing = true;

            imageReader.setOnImageAvailableListener(reader -> {
                if (!isCapturing || clientSockets.isEmpty()) {
                    Image img = reader.acquireLatestImage();
                    if (img != null) img.close();
                    return;
                }

                long now = System.currentTimeMillis();
                // Throttle to max 45-60 FPS (min 16ms between frames)
                if (now - lastFrameTime < 16) {
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
                    cleanBitmap.compress(Bitmap.CompressFormat.JPEG, 68, baos);
                    cleanBitmap.recycle();
                    byte[] jpegBytes = baos.toByteArray();

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
                OutputStream os = s.getOutputStream();
                os.write(packet);
                os.flush();
            } catch (Exception e) {
                try { s.close(); } catch (Exception ignored) {}
                clientSockets.remove(s);
            }
        }
    }

    private void stopScreenCapture() {
        isCapturing = false;
        clientSockets.clear();

        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
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
