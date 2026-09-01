# PlayThruu Admin — Android shell

A ~12 KB Android app whose entire job is to open
`https://app.playthruu.com/admin/` in a WebView with the right settings.

It deliberately does **not** bundle a copy of the site. The admin panel
ships as part of the normal PlayThruu deploy, so fixes go live with a
`git push` and this APK never needs rebuilding or reinstalling.

## Installing

The built APK is committed at `admin/playthruu-admin.apk`, which means
the easiest install is straight from the phone:

1. Open **https://app.playthruu.com/admin/playthruu-admin.apk** in
   Chrome on the phone.
2. Chrome will warn about installing a file from outside the Play Store
   — that's expected for any self-signed app. Allow it, and allow
   "install unknown apps" for Chrome if asked.
3. Open **PlayThruu Admin** (amber icon) and sign in.

Or over USB with debugging on:

```
adb install -r admin/playthruu-admin.apk
```

## Rebuilding

Nothing is on `PATH` on this machine, so point the build at the JDK that
ships inside Android Studio and the Gradle already in the wrapper cache:

```bash
cd android-admin
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" assembleRelease --no-daemon
```

Output lands at `app/build/outputs/apk/release/app-release.apk`. Copy it
over `admin/playthruu-admin.apk` to update the download link.

Bump `versionCode`/`versionName` in `app/build.gradle` when you rebuild,
or Android may refuse to install over the existing copy.

## Signing

`playthruu-admin.jks` and `keystore.properties` are gitignored, since a
keystore is a credential. There's no Play Store listing to keep signing
continuity for, so if they ever go missing just regenerate and reinstall:

```bash
"/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" -genkeypair -v \
  -keystore playthruu-admin.jks -alias playthruu-admin \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass playthruu-admin -keypass playthruu-admin \
  -dname "CN=PlayThruu Admin, O=PlayThruu, L=Delhi, C=IN"
```

Then recreate `keystore.properties` beside it:

```
storeFile=playthruu-admin.jks
storePassword=playthruu-admin
keyAlias=playthruu-admin
keyPassword=playthruu-admin
```

Reinstalling after regenerating the key needs the old copy uninstalled
first — Android refuses to replace an app with one signed by a different
key.

## Why these settings

| Setting | Reason |
| --- | --- |
| `domStorageEnabled` | Supabase keeps the auth session in `localStorage`. Off, the app signs you out on every launch. |
| Window-inset padding | `targetSdk 36` is edge-to-edge whether or not you ask, so without it the header sits under the status bar. |
| Host check in `shouldOverrideUrlLoading` | Keeps `app.playthruu.com` in the app, hands the Supabase dashboard link to a real browser. |
| No dependencies (not even AndroidX) | One Activity, one WebView. Nothing else to keep current. |
| `minSdk 26` | Lets the launcher icon be adaptive-only, no legacy PNG densities. Covers Android 8 (2017) onward. |
