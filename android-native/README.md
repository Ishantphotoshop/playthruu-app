# Playthruu — native build

A 5 MB self-contained Android app. The whole of Playthruu is inside the
APK: every page, stylesheet, script, icon and login backdrop. It launches
with no network at all, there is no white flash while a page downloads,
and nothing about it depends on Chrome being installed.

This is the sibling of `android-app/`, which is a Trusted Web Activity —
same package name, same signing key, so either installs straight over the
other. The difference is the trade below.

## Which build to use

| | `android-native/` (this one) | `android-app/` (TWA) |
| --- | --- | --- |
| Size | 5 MB | 400 KB |
| App code | bundled in the APK | loaded from app.playthruu.com |
| Works with no network | yes, fully | only what the service worker cached |
| Needs Chrome installed | no | yes |
| Notifications while open or backgrounded | yes | yes |
| **Notifications with the app fully closed** | **no** | **yes** |
| Shipping an app change | rebuild + reinstall | `git push`, nothing else |

That bold row is the whole decision. A WebView has no Push API, so a
bundled app can never be woken by a push; the TWA runs the site in
Chrome, which can. Having both at once would mean adding Firebase Cloud
Messaging to this build, which needs a Firebase project.

## Why WebViewAssetLoader and not file://

Loading the bundle the obvious way — `file:///android_asset/index.html` —
puts the app on a `file://` origin. There, `localStorage` is unreliable,
every `fetch` is cross-origin against everything, and Supabase's session
handling simply does not work: the app would sign you out on every launch
and never explain why.

`WebViewAssetLoader` serves the same files over
`https://appassets.androidplatform.net`, which the WebView treats as an
ordinary secure origin. `localStorage` persists, the Supabase session
survives a restart, and CORS behaves the way it does in a browser. That
host is reserved by androidx for exactly this and resolves to nothing on
the real internet.

The asset handler maps the origin root onto `assets/www/`, so the bundled
files stay byte-identical to the deployed site — no path rewriting and
nothing to keep in sync by hand.

The service worker is deliberately not registered on that host (see the
check in `index.html`): the files are already local, so a cache in front
of them adds nothing and a fetch handler in front of the asset loader is
just one more thing that can go wrong.

## Rebuilding after an app change

`assets/www/` is build output, not source — it is gitignored, and
`scripts/bundle-native.py` regenerates it. Committing it instead would
put a second copy of every file in the repo, free to drift from the real
one, with nothing to notice until the app behaved differently from the
site.

```bash
cd /c/Users/ishan/Downloads/playthruu-app-deploy
python3 scripts/bundle-native.py

cd android-native
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" assembleRelease --no-daemon
cp app/build/outputs/apk/release/app-release.apk ../playthruu.apk
```

Bump `versionCode` in `app/build.gradle` first, or Android refuses to
install over the existing copy.

### The backdrops are downsampled on purpose

`images/backdrops/` is 62 MB of full-resolution JPEGs in the repo —
right for the web, where a phone downloads exactly the one it is shown,
and wrong for an APK, where all 31 ship whether or not anyone sees them.
The old Capacitor build bundled them untouched, which is the entire
reason that APK was 67 MB and roughly 99% wallpaper.

`scripts/bundle-native.py` resamples them to 1280px wide at quality 72
on the way in: 3.6 MB for the set, and indistinguishable sitting behind
a login form.

## Signing

The same keystore as `android-app/` — `playthruu-app.jks`, gitignored,
recorded in `Downloads/Questlog_Keys_Current.txt`. Sharing the key is
what lets the two builds replace each other; a different key would make
Android refuse the install, which is exactly what the old 67 MB Capacitor
build runs into (different key, same package name — it has to be
uninstalled first).
