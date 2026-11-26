package com.dogremote.local;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Path;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * DogAccessibilityService
 * Provides system-level input injection (touch gestures, swipes, scrolls, and keyboard typing)
 * for DogRemote screen sharing without requiring root.
 */
public class DogAccessibilityService extends AccessibilityService {
    private static final String TAG = "DogRemoteA11y";
    private static volatile DogAccessibilityService instance = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Live continuous touch state (API 26+)
    private GestureDescription.StrokeDescription activeStroke = null;
    private float activeX = 0f;
    private float activeY = 0f;
    private boolean isGestureInFlight = false;
    private boolean pendingEnd = false;
    private float pendingX = -1f;
    private float pendingY = -1f;

    public static DogAccessibilityService getInstance() {
        return instance;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.i(TAG, "DogAccessibilityService successfully connected and active");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Passive listener; events are dispatched proactively from ScreenShareService
    }

    @Override
    public void onInterrupt() {
        Log.w(TAG, "DogAccessibilityService interrupted");
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
        Log.i(TAG, "DogAccessibilityService destroyed");
    }

    private final GestureResultCallback liveCallback = new GestureResultCallback() {
        @Override
        public void onCompleted(GestureDescription gestureDescription) {
            isGestureInFlight = false;
            if (activeStroke == null) return;
            if (pendingEnd) {
                float ex = pendingX >= 0 ? pendingX : activeX;
                float ey = pendingY >= 0 ? pendingY : activeY;
                finishStrokeOnMain(ex, ey);
            } else if (pendingX >= 0 && pendingY >= 0) {
                float mx = pendingX;
                float my = pendingY;
                pendingX = -1f;
                pendingY = -1f;
                if (Math.hypot(mx - activeX, my - activeY) >= 2f) {
                    continueMoveStrokeOnMain(mx, my);
                }
            }
        }

        @Override
        public void onCancelled(GestureDescription gestureDescription) {
            isGestureInFlight = false;
            activeStroke = null;
            pendingEnd = false;
            pendingX = -1f;
            pendingY = -1f;
            Log.w(TAG, "Live touch gesture CANCELLED");
        }
    };

    private void continueMoveStrokeOnMain(float x, float y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activeStroke == null) return;
        Path path = new Path();
        path.moveTo(activeX, activeY);
        path.lineTo(x, y);
        activeStroke = activeStroke.continueStroke(path, 0, 20, true);
        activeX = x;
        activeY = y;
        isGestureInFlight = true;
        try {
            boolean queued = dispatchGesture(new GestureDescription.Builder().addStroke(activeStroke).build(), liveCallback, mainHandler);
            if (!queued) {
                isGestureInFlight = false;
                activeStroke = null;
            }
        } catch (Exception e) {
            isGestureInFlight = false;
            activeStroke = null;
            Log.e(TAG, "Error in live touchMove: " + e.getMessage());
        }
    }

    private void finishStrokeOnMain(float x, float y) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activeStroke == null) return;
        Path path = new Path();
        path.moveTo(activeX, activeY);
        path.lineTo(x, y);
        GestureDescription.StrokeDescription endStroke = activeStroke.continueStroke(path, 0, 1, false);
        activeStroke = null;
        pendingEnd = false;
        pendingX = -1f;
        pendingY = -1f;
        isGestureInFlight = false;
        try {
            dispatchGesture(new GestureDescription.Builder().addStroke(endStroke).build(), null, mainHandler);
            Log.i(TAG, "Live touchUp SUCCESS at (" + x + ", " + y + ")");
        } catch (Exception e) {
            Log.e(TAG, "Error in live touchUp: " + e.getMessage());
        }
    }

    /**
     * Live touch down (immediately presses on screen without waiting for release).
     */
    public void touchDown(float x, float y) {
        mainHandler.post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (activeStroke != null) {
                    finishStrokeOnMain(activeX, activeY);
                }
                pendingEnd = false;
                pendingX = -1f;
                pendingY = -1f;
                Path path = new Path();
                path.moveTo(x, y);
                path.lineTo(x, y);
                activeStroke = new GestureDescription.StrokeDescription(path, 0, 1, true);
                activeX = x;
                activeY = y;
                isGestureInFlight = true;
                try {
                    boolean queued = dispatchGesture(new GestureDescription.Builder().addStroke(activeStroke).build(), liveCallback, mainHandler);
                    Log.i(TAG, "Live touchDown queued: " + queued + " at (" + x + ", " + y + ")");
                    if (!queued) {
                        isGestureInFlight = false;
                        activeStroke = null;
                    }
                } catch (Exception e) {
                    isGestureInFlight = false;
                    activeStroke = null;
                    Log.e(TAG, "Error in live touchDown: " + e.getMessage());
                }
            }
        });
    }

    /**
     * Live touch move while finger/mouse is held down.
     */
    public void touchMove(float x, float y) {
        mainHandler.post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activeStroke != null) {
                if (isGestureInFlight) {
                    pendingX = x;
                    pendingY = y;
                } else if (Math.hypot(x - activeX, y - activeY) >= 2f) {
                    continueMoveStrokeOnMain(x, y);
                }
            }
        });
    }

    /**
     * Live touch up (releases the active touch at the final coordinates).
     */
    public void touchUp(float x, float y) {
        mainHandler.post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activeStroke != null) {
                if (isGestureInFlight) {
                    pendingEnd = true;
                    pendingX = x;
                    pendingY = y;
                } else {
                    finishStrokeOnMain(x, y);
                }
            } else {
                tap(x, y);
            }
        });
    }

    /**
     * Injects a single tap at the given screen coordinates.
     */
    public void tap(float x, float y) {
        mainHandler.post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Path path = new Path();
                path.moveTo(x, y);
                path.lineTo(x, y);
                GestureDescription.Builder builder = new GestureDescription.Builder();
                builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 60));
                try {
                    boolean queued = dispatchGesture(builder.build(), new GestureResultCallback() {
                        @Override
                        public void onCompleted(GestureDescription gestureDescription) {
                            Log.i(TAG, "Touch tap SUCCESS at (" + x + ", " + y + ")");
                        }
                        @Override
                        public void onCancelled(GestureDescription gestureDescription) {
                            Log.w(TAG, "Touch tap CANCELLED at (" + x + ", " + y + ")");
                        }
                    }, mainHandler);
                    Log.i(TAG, "dispatchGesture tap queued: " + queued);
                } catch (Exception e) {
                    Log.e(TAG, "Error dispatching tap gesture: " + e.getMessage());
                }
            }
        });
    }

    /**
     * Injects a swipe/drag gesture between two screen coordinates.
     */
    public void drag(float startX, float startY, float endX, float endY, long durationMs) {
        mainHandler.post(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Path path = new Path();
                path.moveTo(startX, startY);
                path.lineTo(endX, endY);
                GestureDescription.Builder builder = new GestureDescription.Builder();
                long dur = Math.max(100, Math.min(durationMs, 800));
                builder.addStroke(new GestureDescription.StrokeDescription(path, 0, dur));
                try {
                    boolean queued = dispatchGesture(builder.build(), new GestureResultCallback() {
                        @Override
                        public void onCompleted(GestureDescription gestureDescription) {
                            Log.i(TAG, "Drag gesture SUCCESS from (" + startX + ", " + startY + ") to (" + endX + ", " + endY + ")");
                        }
                        @Override
                        public void onCancelled(GestureDescription gestureDescription) {
                            Log.w(TAG, "Drag gesture CANCELLED");
                        }
                    }, mainHandler);
                    Log.i(TAG, "dispatchGesture drag queued: " + queued);
                } catch (Exception e) {
                    Log.e(TAG, "Error dispatching drag gesture: " + e.getMessage());
                }
            }
        });
    }

    /**
     * Performs a vertical scroll using swipe gestures.
     * steps > 0: Scroll Up (content moves downwards)
     * steps < 0: Scroll Down (content moves upwards)
     */
    public void scroll(int steps) {
        mainHandler.post(() -> {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            float cx = dm.widthPixels / 2f;
            float cy = dm.heightPixels / 2f;
            float delta = Math.min(dm.heightPixels * 0.25f, 400f);

            if (steps > 0) {
                drag(cx, cy - delta, cx, cy + delta, 120);
            } else {
                drag(cx, cy + delta, cx, cy - delta, 120);
            }
        });
    }

    /**
     * Injects Android Global Back action.
     */
    public void pressBack() {
        performGlobalAction(GLOBAL_ACTION_BACK);
    }

    /**
     * Injects Android Global Home action.
     */
    public void pressHome() {
        performGlobalAction(GLOBAL_ACTION_HOME);
    }

    /**
     * Injects Android Global Recents / App Switcher action.
     */
    public void pressRecents() {
        performGlobalAction(GLOBAL_ACTION_RECENTS);
    }

    /**
     * Injects Android Global Notifications panel toggle.
     */
    public void pressNotifications() {
        performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
    }

    private AccessibilityNodeInfo findEditableNode(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable() && (node.isFocused() || node.isSelected())) {
            return node;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo match = findEditableNode(child);
                if (match != null) return match;
            }
        }
        if (node.isEditable()) return node;
        return null;
    }

    /**
     * Types text directly into the actively focused input field.
     */
    public void typeText(String text) {
        mainHandler.post(() -> {
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                AccessibilityNodeInfo focused = null;
                if (root != null) {
                    focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                    if (focused == null) {
                        focused = root.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
                    }
                    if (focused == null) {
                        focused = findEditableNode(root);
                    }
                    if (focused != null) {
                        CharSequence current = focused.getText();
                        String currentStr = current != null ? current.toString() : "";
                        Bundle args = new Bundle();
                        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, currentStr + text);
                        boolean success = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                        if (success) return;
                    }
                }

                // Fallback: Clipboard paste
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    ClipData clip = ClipData.newPlainText("DogRemote", text);
                    cm.setPrimaryClip(clip);
                    if (focused != null) {
                        focused.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                    } else if (root != null) {
                        AccessibilityNodeInfo target = findEditableNode(root);
                        if (target != null) {
                            target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "typeText failed: " + e.getMessage());
            }
        });
    }

    /**
     * Deletes one character from the active focused input field (Backspace).
     */
    public void backspace() {
        mainHandler.post(() -> {
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                    if (focused == null) {
                        focused = findEditableNode(root);
                    }
                    if (focused != null) {
                        CharSequence current = focused.getText();
                        if (current != null && current.length() > 0) {
                            Bundle args = new Bundle();
                            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, current.subSequence(0, current.length() - 1));
                            focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "backspace failed: " + e.getMessage());
            }
        });
    }

    /**
     * Triggers IME Action (Enter / Search / Done) on the active focused input field.
     */
    public void pressEnter() {
        mainHandler.post(() -> {
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null) {
                    AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                    if (focused == null) {
                        focused = findEditableNode(root);
                    }
                    if (focused != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
                        } else {
                            focused.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "pressEnter failed: " + e.getMessage());
            }
        });
    }
}
