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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

/**
 * Playthruu — the self-contained native build.
 *
 * Unlike the Trusted Web Activity next door, this one ships the whole
 * app inside the APK: every page, stylesheet, script and image is in
 * assets/www and is served locally. It launches with no network at all,
 * there is no white flash while a page downloads, and nothing about it
 * depends on Chrome being present.
 *
 * The one thing that makes this workable is WebViewAssetLoader. Loading
 * bundled files the obvious way — file:///android_asset/index.html —
 * puts the app on a file:// origin, where localStorage is unreliable,
 * fetch is treated as cross-origin against everything, and Supabase's
 * session handling simply does not work. The asset loader instead serves
 * the same files over https://appassets.androidplatform.net, which the
 * WebView treats as a normal secure origin: localStorage persists, the
 * Supabase client keeps you signed in between launches, and CORS behaves
 * the way it does in a browser.
 *
 * What this build gives up, and it is worth being clear about: a WebView
 * has no Push API, so notifications only arrive while the app is running
 * or backgrounded, through the bridge below. Reaching a fully closed app
 * needs either the TWA build (Chrome's push) or Firebase.
 */
public class MainActivity extends android.app.Activity {

    /** Reserved by androidx for exactly this purpose; it resolves to nothing on the real internet. */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";

    private static final String CHANNEL_ID = "playthruu-activity";
    private static final String CHANNEL_ID_SILENT = "playthruu-activity-silent";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> pendingFileCallback;

    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannels();
        requestNotificationPermission();

        // Everything under assets/www is served from the root of the
        // asset host, so the app's own relative paths (css/styles.css,
        // js/app.js) resolve exactly as they do on the web — no rewriting
        // of the bundled files, which is what keeps this build and the
        // deployed site byte-identical.
        WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/", path -> assets.handle("www/" + path))
                .build();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0b0b"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0b0b"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);
        setContentView(root);

        // targetSdk 36 is edge-to-edge whether or not we ask, so without
        // this the app's header would sit under the status bar and its
        // nav bar under the gesture pill.
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
        // Supabase keeps the auth session in localStorage. Off, the app
        // signs you out on every launch and never says why.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // The bundled files are local; these only ever applied to
        // file:// loads, which the asset loader exists to avoid.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "PlaythruuNative");

        webView.setWebViewClient(new WebViewClient() {
            // Anything on the asset host comes out of the APK; everything
            // else (Supabase, IGDB's image CDN, GIPHY) goes to the
            // network untouched, because the loader returns null for it.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && host.equalsIgnoreCase(ASSET_HOST)) return false;
                // A real outbound link — the site's IGDB credit, say —
                // belongs in a real browser, not inside the app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    return false;
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // Without this an <input type="file"> does nothing at all, and
            // silently — that is the avatar picker in Settings.
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

            // Voice notes record through getUserMedia, which a WebView
            // refuses by default even once Android has granted the app
            // the microphone.
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] wanted = request.getResources();
                    boolean audioOnly = true;
                    for (String r : wanted) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audioOnly = false;
                    }
                    if (audioOnly && hasPermission(android.Manifest.permission.RECORD_AUDIO)) {
                        request.grant(wanted);
                    } else if (audioOnly) {
                        requestPermissions(new String[] { android.Manifest.permission.RECORD_AUDIO }, 1003);
                        request.deny();
                    } else {
                        request.deny();
                    }
                });
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(routeFor(getIntent()));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.loadUrl(routeFor(intent));
    }

    /** Tapping a notification should land on what it was about. */
    private String routeFor(Intent intent) {
        if (intent != null && intent.getBooleanExtra("openNotifications", false)) {
            return START_URL + "#/notifications";
        }
        return START_URL;
    }

    // ---- notifications ---------------------------------------------------

    /**
     * Two channels. The app ships no tone of its own: a notification
     * sound is a choice people have already made on their phone, often
     * carefully, and overriding it is not this app's call — so the loud
     * channel takes IMPORTANCE_DEFAULT, which is Android's way of saying
     * "whatever this user's default is".
     *
     * Silence needs its own channel rather than a flag, because from
     * Android O the channel owns the tone and a notification cannot talk
     * it out of one. IMPORTANCE_LOW still shows in the shade and the
     * status bar; it just makes no sound.
     */
    private void createNotificationChannels() {
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

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (hasPermission(android.Manifest.permission.POST_NOTIFICATIONS)) return;
        requestPermissions(
                new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST);
    }

    private void postNotification(String title, String body, String tag, boolean withSound) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && !hasPermission(android.Manifest.permission.POST_NOTIFICATIONS)) {
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
            builder.setDefaults(withSound
                    ? Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE
                    : 0);
        }
        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title == null ? "Playthruu" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new Notification.BigTextStyle().bigText(body == null ? "" : body))
                .setAutoCancel(true)
                .setContentIntent(pending);

        // One notification per kind rather than a stack of five identical
        // ones — a second "liked your review" replaces the first.
        manager.notify(tag == null ? "playthruu" : tag, 1, builder.build());
    }

    /** The whole native surface the page can reach. */
    private class NativeBridge {
        @JavascriptInterface
        public void notify(String title, String body, String tag, boolean withSound) {
            runOnUiThread(() -> postNotification(title, body, tag, withSound));
        }

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

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Back walks the app's own history before it closes the app.
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
     * Deliberately NOT calling webView.onPause(). Pausing a WebView stops
     * its JavaScript timers, which would kill the Supabase realtime
     * subscription the moment the app went to the background — and a
     * notification that only arrives while you are already looking at the
     * app is no notification at all.
     */
    @Override
    protected void onPause() {
        super.onPause();
    }
}
