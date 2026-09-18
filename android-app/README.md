# Playthruu — Android app

A ~400 KB Android app that runs `https://app.playthruu.com/` as a
**Trusted Web Activity**: full-screen, no browser chrome, its own icon in
the launcher, and — the reason it exists — real notifications in the
notification shade.

## Why a TWA and not a WebView

It started as a WebView shell with a JS bridge (`PlaythruuNative.notify`)
so the page could ask the native side to post a notification. That worked
while the app was open or backgrounded, and **only** then: a WebView has
no Push API, so once the app was swiped out of recents there was nothing
left to tell it anything. The realtime subscription is a WebSocket inside
the page, and a killed process has no WebSocket.

A TWA runs the site in Chrome, which means the site's own Web Push
subscription works exactly as it does in the browser. A push subscription
belongs to the browser's push service, not to the page, so it outlives
the app being closed entirely — Chrome wakes the service worker, the
service worker posts the notification, and the `DelegationService`
declared in the manifest is what makes it appear as **Playthruu** rather
than as Chrome.

The WebView version is still in git history (`f5b5b8e`) if it is ever
wanted back; `app.js` also still checks for the bridge, so it would work
again with no changes on the web side.

## What has to be true for it to work

| Piece | Where | Note |
| --- | --- | --- |
| `assetlinks.json` | `/.well-known/assetlinks.json` in the site root | Carries this APK's signing fingerprint. Chrome fetches it to verify the app owns the domain. **Without it the app still runs but shows a URL bar.** |
| `.nojekyll` | site root | GitHub Pages runs Jekyll by default, which skips dot-directories — so `.well-known/` would 404 and verification would silently fail. |
| `asset_statements` | `res/values/strings.xml` | The APK's half of the same pair. |
| `VAPID_PUBLIC_KEY` | `js/config.js` | Must match the `VAPID_PRIVATE_KEY` Supabase secret. |
| `send-push` function + trigger | `supabase/functions/send-push`, `migrations/2026-09-18_web_push.sql` | What actually sends a push when a notification row is written. |
| `POST_NOTIFICATIONS` | manifest | Android 13+ refuses to post anything without it; Chrome asks for it on the app's behalf. |

The signing key and `assetlinks.json` are a matched pair. Regenerating
the keystore means regenerating that file with the new fingerprint, or
verification breaks and the URL bar comes back.

## Installing

```
adb install -r ../playthruu.apk
```

Or from the phone: open **https://app.playthruu.com/playthruu.apk** in
Chrome, allow the "install unknown apps" prompt, open **Playthruu**, sign
in, and say yes when it asks about notifications — on Android 13+ that
prompt is the whole ballgame.

Then turn **Push notifications** on in Settings → Notifications. That is
what creates the subscription; nothing arrives until it exists.

Upgrading over the old WebView build works because the signing key is the
same and `versionCode` moved to 2.

## Rebuilding

Nothing is on `PATH` on this machine, so point the build at the JDK
inside Android Studio and the Gradle in the wrapper cache:

```bash
cd android-app
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" assembleRelease --no-daemon
cp app/build/outputs/apk/release/app-release.apk ../playthruu.apk
```

Bump `versionCode`/`versionName` in `app/build.gradle` first, or Android
refuses to install over the existing copy.

Note that ordinary app changes need **no** rebuild: the APK holds no copy
of the site, so a `git push` is the whole deploy. Only changes to the
manifest, resources or the TWA config need a new APK.

## Signing

`playthruu-app.jks` and `keystore.properties` are gitignored, since a
keystore is a credential — both are recorded in
`Downloads/Questlog_Keys_Current.txt` alongside the fingerprint.

```bash
"/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" -genkeypair -v \
  -keystore playthruu-app.jks -alias playthruu-app \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass playthruu-app -keypass playthruu-app \
  -dname "CN=Playthruu, O=Playthruu, L=Delhi, C=IN"
```

Reinstalling after regenerating the key needs the old copy uninstalled
first — Android refuses to replace an app with one signed by a different
key — **and** `.well-known/assetlinks.json` updated to the new
fingerprint.
