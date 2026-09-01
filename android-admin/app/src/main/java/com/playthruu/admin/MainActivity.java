package com.playthruu.admin;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * PlayThruu Admin — a thin shell around the admin web app.
 *
 * Deliberately a WebView pointing at the live URL rather than a bundled
 * copy of the site: the admin panel is a page on the same deploy as the
 * app itself, so shipping it this way means fixes go out with a push and
 * never need a new APK on the phone.
 *
 * The one genuinely load-bearing setting here is DOM storage. Supabase
 * keeps its auth session in localStorage, so with it off the app would
 * sign you out on every single launch and never explain why.
 */
public class MainActivity extends android.app.Activity {

    private static final String START_URL = "https://app.playthruu.com/admin/";
    private static final String HOST = "app.playthruu.com";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0a0b0f"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0a0b0f"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);
        setContentView(root);

        // targetSdk 36 means the window is edge-to-edge whether or not we
        // ask for it, so the page would otherwise start underneath the
        // status bar and the back button would sit in the clock. Padding
        // the container by the system-bar insets keeps the web content in
        // the visible area without the page needing to know anything
        // about Android.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
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
        // Supabase's session lives in localStorage — see the class note.
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

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                // Anything on our own host stays in the app. Everything
                // else — notably the "Open editor" link out to the
                // Supabase dashboard — hands off to a real browser, which
                // is where a logged-in Supabase session already lives.
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
                // screen over — a single failed image shouldn't blank the
                // whole app.
                if (request == null || !request.isForMainFrame()) return;
                view.loadDataWithBaseURL(null, offlineHtml(), "text/html", "utf-8", null);
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /**
     * The retry control is a plain link back to the start URL rather than
     * a JavaScript bridge — a normal navigation does the same job with no
     * @JavascriptInterface surface to maintain or lock down.
     */
    private String offlineHtml() {
        return "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>"
                + "body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;"
                + "justify-content:center;gap:14px;background:#0a0b0f;color:#f2f3f5;"
                + "font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px}"
                + "h1{font-size:19px;margin:0}p{margin:0;color:#9aa0ad;font-size:14.5px;line-height:1.5}"
                + "a{margin-top:8px;background:#ffb020;color:#12130f;text-decoration:none;font-weight:700;"
                + "padding:12px 22px;border-radius:10px;font-size:14px}"
                + "</style></head><body>"
                + "<h1>No connection</h1>"
                + "<p>The admin panel needs to reach app.playthruu.com.</p>"
                + "<a href='" + START_URL + "'>Try again</a>"
                + "</body></html>";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Back walks the web app's own history (a section, then Home)
        // before it ever closes the app.
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
}
