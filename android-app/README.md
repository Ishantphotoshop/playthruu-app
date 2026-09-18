# Playthruu — Android shell

A ~16 KB Android app whose entire job is to open
`https://app.playthruu.com/` in a WebView and give the page one thing it
cannot have on its own: **the notification shade**.

A website can badge itself and it can make a sound while you are looking
at it, but nothing it does reaches the status bar. That is why
notifications never showed up on the phone. This shell exposes
`window.PlaythruuNative.notify(...)`, and the web app calls it instead of
`new Notification(...)` whenever it is running inside the APK — so a
follow, like, comment or message lands in the shade as a real Android
notification, on a real channel, with the phone's own tone.

Like the admin shell beside it, it deliberately does **not** bundle a
copy of the site. Ordinary fixes still go live with a `git push` and this
APK never needs rebuilding or reinstalling for them. It only needs a
rebuild when something in `MainActivity.java` changes.

## Installing

The built APK is committed at the site root as `playthruu.apk`, so the
easiest install is straight from the phone:

1. Open **https://app.playthruu.com/playthruu.apk** in Chrome on the
   phone.
2. Chrome warns about installing a file from outside the Play Store —
   expected for any self-signed app. Allow it, and allow "install unknown
   apps" for Chrome if asked.
3. Open **Playthruu** and sign in.
4. Say yes when it asks to send notifications. On Android 13+ that prompt
   is the whole ballgame: decline it and the shade stays empty no matter
   what the app does.

Or over USB with debugging on:

```
adb install -r playthruu.apk
```

## What it adds over the PWA

| Setting | Reason |
| --- | --- |
| `PlaythruuNative.notify()` | The point of the whole shell — real notifications in the status bar. |
| `POST_NOTIFICATIONS` | Android 13+ refuses to post anything without it. |
| Two notification channels | From Android O the channel owns the tone, and a notification can't talk it out of one — so silence needs its own `IMPORTANCE_LOW` channel rather than a flag. The Sound switch in Settings picks between them. |
| `onShowFileChooser` | Without it `<input type="file">` does nothing at all, silently — that's the avatar picker in Settings. |
| `onPermissionRequest` | A WebView refuses `getUserMedia` even when Android has already granted the app the microphone. Needed for voice notes. |
| No `webView.onPause()` | Pausing a WebView stops its JS timers, which would kill the Supabase realtime subscription the moment the app was backgrounded — i.e. exactly when a notification matters. |
| `domStorageEnabled` | Supabase keeps the auth session in `localStorage`. Off, the app signs you out on every launch. |
| Window-inset padding | `targetSdk 36` is edge-to-edge whether or not you ask, so without it the header sits under the status bar. |
| `minSdk 26` | Lets the launcher icon be adaptive-only, no legacy PNG densities. Covers Android 8 (2017) onward. |

### What it still does not do

A notification only fires while the app is running — in the foreground or
backgrounded. Once it is swiped out of recents, nothing arrives, because
there is no push service involved: the realtime subscription is a
WebSocket inside the WebView, and a killed process has no WebSocket.

Reaching a fully closed phone needs a push service (Web Push via VAPID,
or FCM) plus something server-side to send. `VAPID_PUBLIC_KEY` in
`js/config.js` is the hook for the first of those and is still empty; see
the note there.

## Rebuilding

Nothing is on `PATH` on this machine, so point the build at the JDK
inside Android Studio and the Gradle already in the wrapper cache:

```bash
cd android-app
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" assembleRelease --no-daemon
```

Output lands at `app/build/outputs/apk/release/app-release.apk`. Copy it
over `../playthruu.apk` to update the download link.

Bump `versionCode`/`versionName` in `app/build.gradle` when you rebuild,
or Android may refuse to install over the existing copy.

## Signing

`playthruu-app.jks` and `keystore.properties` are gitignored, since a
keystore is a credential. There is no Play Store listing to keep signing
continuity for, so if they ever go missing just regenerate and reinstall:

```bash
"/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" -genkeypair -v \
  -keystore playthruu-app.jks -alias playthruu-app \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass playthruu-app -keypass playthruu-app \
  -dname "CN=Playthruu, O=Playthruu, L=Delhi, C=IN"
```

Then recreate `keystore.properties` beside it:

```
storeFile=playthruu-app.jks
storePassword=playthruu-app
keyAlias=playthruu-app
keyPassword=playthruu-app
```

Reinstalling after regenerating the key needs the old copy uninstalled
first — Android refuses to replace an app with one signed by a different
key.
