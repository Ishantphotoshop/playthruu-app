package com.playthruu.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * PlayThruu — a thin native shell around the web app.
 *
 * It exists for one reason: a website cannot put anything in Android's
 * notification shade. The PWA could badge itself and it could ring while
 * you were looking at it, but nothing it did ever reached the status bar,
 * which is the only place a notification is actually useful. This shell
 * gives the page a way to ask the system to post a real notification, on
 * a real channel, with the phone's own notification tone.
 *
 * Everything else is deliberately as thin as the admin shell next to it:
 * one Activity, one WebView, pointed at the live site. No copy of the
 * site is bundled, so every ordinary fix still ships with a git push and
 * this APK does not need rebuilding or reinstalling for it.
 */
public class MainActivity extends android.app.Activity {

    private static final String START_URL = "https://app.playthruu.com/";
    private static final String HOST = "app.playthruu.com";

    private static final String CHANNEL_ID = "playthruu-activity";
    private static final String CHANNEL_ID_SILENT = "playthruu-activity-silent";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;

    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel();
        requestNotificationPermission();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0b0b"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0b0b"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);
        setContentView(root);

        // targetSdk 36 is edge-to-edge whether or not we ask, so without
        // this the app's own header would sit underneath the status bar
        // and the nav bar under the gesture pill. Padding the container
        // by the system-bar insets keeps the web content in the visible
        // area without the page needing to know it is inside an APK.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars =
                        insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // Supabase keeps the auth session in localStorage. With this off
        // the app signs you out on every launch and never says why.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // The bridge is reachable from any page this WebView loads, which
        // is why shouldOverrideUrlLoading below hands every other host to
        // a real browser instead — nothing but app.playthruu.com is ever
        // loaded here, so nothing else can reach it.
        webView.addJavascriptInterface(new NativeBridge(), "PlaythruuNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(HOST)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    return false;
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only the main document failing is worth replacing the
                // screen over — one failed image should not blank the app.
                if (request == null || !request.isForMainFrame()) return;
                view.loadDataWithBaseURL(null, offlineHtml(), "text/html", "utf-8", null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // Without this an <input type="file"> does nothing at all in a
            // WebView — silently. Settings has an avatar picker, so this
            // is the difference between that button working and not.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    pendingFileCallback = null;
                    return false;
                }
                return true;
            }

            // Voice notes record through getUserMedia, which the WebView
            // refuses by default even when Android has already granted the
            // app the microphone. Granting here passes the app-level
            // permission through to the page.
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] wanted = request.getResources();
                    boolean audioOnly = true;
                    for (String r : wanted) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audioOnly = false;
                    }
                    if (audioOnly
                            && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(wanted);
                    } else {
                        request.deny();
                    }
                });
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(startUrlFor(getIntent()));
        }
    }

    /**
     * Tapping a notification should land on what it was about, not just
     * open the app wherever it was left. singleTask means the running
     * instance gets this through onNewIntent rather than a fresh onCreate.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.loadUrl(startUrlFor(intent));
    }

    private String startUrlFor(Intent intent) {
        if (intent != null && intent.getBooleanExtra("openNotifications", false)) {
            return START_URL + "#/notifications";
        }
        return START_URL;
    }

    // ---- notifications ---------------------------------------------------

    /**
     * Two channels, created once. The app deliberately ships no tone of
     * its own: a notification sound is a choice people have already made
     * on their phone, often carefully, and overriding it is not this
     * app's call — so the loud channel simply takes IMPORTANCE_DEFAULT,
     * which is Android's way of saying "whatever this user's default is".
     *
     * Silence needs its own channel rather than a flag, because from
     * Android O onward the channel owns the tone and a notification
     * cannot talk it out of one. IMPORTANCE_LOW is the silent tier: it
     * still appears in the shade and the status bar, it just does not
     * make a sound or push a heads-up banner.
     *
     * Everything about either channel after creation — tone, vibration,
     * importance — then belongs to the user in Android's own settings,
     * which is exactly where those controls should live.
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Activity", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Follows, likes, comments and messages");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(CHANNEL_ID_SILENT) == null) {
            NotificationChannel silent = new NotificationChannel(
                    CHANNEL_ID_SILENT, "Activity (silent)", NotificationManager.IMPORTANCE_LOW);
            silent.setDescription("The same notifications, with no sound");
            silent.setSound(null, null);
            silent.enableVibration(false);
            manager.createNotificationChannel(silent);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(
                new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST);
    }

    private void postNotification(String title, String body, String tag, boolean withSound) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("openNotifications", true);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, withSound ? CHANNEL_ID : CHANNEL_ID_SILENT);
        } else {
            builder = new Notification.Builder(this);
        }
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title == null ? "Playthruu" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new Notification.BigTextStyle().bigText(body == null ? "" : body))
                .setAutoCancel(true)
                .setContentIntent(pending);

        // Pre-O has no channels at all, so there the tone is set on the
        // notification itself. From O onward the channel chosen above is
        // what decides, and setDefaults would be ignored anyway.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setDefaults(withSound
                    ? Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE
                    : 0);
        }

        // One notification per kind rather than a stack of five identical
        // ones — the tag is the kind, so a second "liked your review"
        // replaces the first instead of piling up.
        manager.notify(tag == null ? "playthruu" : tag, 1, builder.build());
    }

    /** The whole native surface the web app can reach. */
    private class NativeBridge {
        @JavascriptInterface
        public void notify(String title, String body, String tag, boolean withSound) {
            runOnUiThread(() -> postNotification(title, body, tag, withSound));
        }

        /**
         * Lets the page tell whether it is running inside the shell
         * without having to feature-detect `notify` itself.
         */
        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }

    // ---- plumbing --------------------------------------------------------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String offlineHtml() {
        return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>"
                + "body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;"
                + "justify-content:center;gap:14px;background:#0b0b0b;color:#f2f5fa;"
                + "font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px}"
                + "h1{font-size:19px;margin:0}p{margin:0;color:#9aa0ad;font-size:14.5px;line-height:1.5}"
                + "a{margin-top:8px;background:#ff7a29;color:#12130f;text-decoration:none;font-weight:700;"
                + "padding:12px 22px;border-radius:10px;font-size:14px}"
                + "</style></head><body>"
                + "<h1>No connection</h1>"
                + "<p>Playthruu needs to reach app.playthruu.com.</p>"
                + "<a href='" + START_URL + "'>Try again</a>"
                + "</body></html>";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Back walks the web app's own history before it closes the app.
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    /**
     * Deliberately NOT calling webView.onPause() here. Pausing the WebView
     * stops its JavaScript timers, which would kill the Supabase realtime
     * subscription the moment the app went to the background — and a
     * notification that only arrives while you are already looking at the
     * app is the problem this shell exists to solve.
     */
    @Override
    protected void onPause() {
        super.onPause();
    }
}
