# Playthruu — native Android app

A real native app: Kotlin and Jetpack Compose, no WebView anywhere in
it. The UI is Android views composed by Compose, the data layer talks
straight to Supabase over PostgREST with the official Kotlin SDK, and
there is not a single line of HTML in the APK.

This is the third Android build in the repo, and the only one that is
not the website in a frame:

| | `android-kotlin/` (this one) | `android-native/` | `android-app/` |
| --- | --- | --- | --- |
| What it is | Kotlin + Compose, native UI | the site bundled in a WebView | the site in Chrome (TWA) |
| Size | 14.5 MB | 5 MB | 400 KB |
| HTML inside | none | all of it | none (loads it) |
| Feature coverage | the core (below) | everything the web app has | everything the web app has |
| Shipping a change | rebuild + reinstall | rebuild + reinstall | `git push` |

## What it does

- **Sign in / create an account** (email + password)
- **Home feed** — recent logs from the people you follow, falling back
  to the whole app when you follow nobody yet
- **Activity** — the four-source merged stream, with the same
  Friends / You / Incoming tabs and the same filter on Friends as the
  web app, plus the unread count on the tab bar
- **Search** — games and players
- **Game page** — art, the ratings histogram in the proportions the web
  app settled on, everyone's reviews, and the log sheet
- **Log a game** — half-star rating, status, review; edits your existing
  log if there is one
- **Profile** — your own or anyone's, with diary / playing / backlog and
  a follow button
- **Settings** — profile fields, the six notification switches folded
  behind their heading, log out

## What it does not do yet

Being exact about this, because the screens simply are not there:

- **Messaging** — the whole messenger, including typing indicators, read
  receipts, chat search, group admin and voice notes
- **Stories**
- **Discover** — the browse/filter screen, and IGDB search. This build
  searches the local catalogue only, so a game nobody here has logged
  will not be found; on the web a miss falls through to IGDB via an edge
  function and adds it
- **Push notifications** — the plumbing exists server-side, but this app
  has no FCM registration, so nothing arrives while it is closed
- **Lists**, comments on reviews, the news tab, PSN import

The web app and the two wrapper builds have all of it. This one has the
spine.

## Design

The palette and the type are lifted out of `css/styles.css` value for
value rather than approximated — same `#0b0b0b` ground, same `#ff7a29`
accent, Manrope for text and Unbounded for the wordmark and the
segmented tabs. Keeping them identical matters more than it sounds: the
same person uses both, and a slightly different orange reads as a
different, worse app rather than as the same one built twice.

Both faces are published by Google as variable fonts only, so each
weight is the same file asked for a different point on its weight axis —
which is also why the two together cost 0.43 MB instead of the several
megabytes a dozen static cuts would.

Deliberately one fixed dark palette: no light theme and no Material You
dynamic colour, because letting Android repaint this in the phone's
wallpaper colours would throw away the identity the app is built on.

## Tests

`app/src/test/` runs the repository against the **real** project with
the anon key. That is the point: the compiler checks the Kotlin, but
nothing except the actual database can check the hand-written PostgREST
column lists and foreign-key constraint names — and a wrong one of those
fails at runtime, on a screen, as an empty list with no error.

```bash
cd android-kotlin
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" :app:testReleaseUnitTest --no-daemon
```

The tests build their own Postgrest-only client, because Auth's default
session manager is backed by SharedPreferences and there is no such
thing in a JVM test. `Repository` takes its client as a parameter so
that substitution needs no production code.

### Not verified on a device

There is no emulator on this machine: `x86_64` images need hardware
acceleration, and the Android Emulator hypervisor driver is not
installed — that is an admin-level install plus a reboot. So the data
layer is verified against the live database and the whole app compiles
and packages, but no screen has been seen rendering. To close that gap:

```bash
# admin shell, then reboot
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" "extras;google;Android_Emulator_Hypervisor_Driver"
# then
"$ANDROID_HOME/emulator/emulator.exe" -avd playthruu_test
```

The AVD (`playthruu_test`, Android 35, 1080x2400) is already created.

## Building

```bash
cd android-kotlin
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/ishan/AppData/Local/Android/Sdk"
GRADLE="$USERPROFILE/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj/gradle-8.14.3/bin/gradle"
"$GRADLE" assembleRelease --no-daemon
```

Output at `app/build/outputs/apk/release/app-release.apk`.

The APK is deliberately **not** committed and not served from the site —
it is handed over on the desktop instead.

## Installing

Its package is `com.playthruu.android`, which is different from the
wrapper builds' `com.playthruu.app` on purpose: this one installs
alongside them rather than replacing them, so the complete-but-wrapped
app is still there while this one is missing screens. Uninstall whichever
you stop wanting.

```bash
adb install -r ~/Desktop/Playthruu-native.apk
```

Signed with the same `playthruu-app.jks` as the other two — recorded,
with its fingerprint, in `Downloads/Questlog_Keys_Current.txt`.
