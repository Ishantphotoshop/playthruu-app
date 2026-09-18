"""Assemble the native APK's bundled copy of the app.

android-native/ ships the whole site inside the APK, which means there
has to be a copy of it at android-native/app/src/main/assets/www/. That
copy is BUILD OUTPUT, not source: it is gitignored, and this script is
what regenerates it. Committing it instead would put a second copy of
every file in the repo, free to drift from the real one, and nothing
would notice until the app started behaving differently from the site.

Run from the repo root before building the native APK:

    python3 scripts/bundle-native.py

The login backdrops are resampled on the way in. images/backdrops/ is
62 MB of full-resolution JPEGs — right for the web, where a phone
downloads exactly the one it is shown, and wrong for an APK, where all
31 ship whether or not anyone sees them. The old Capacitor build bundled
them untouched, which is the entire reason that APK was 67 MB and
roughly 99% wallpaper. 1280px at quality 72 comes to 3.6 MB for the set
and is indistinguishable behind a login form.
"""

import os
import shutil
import sys

DST = os.path.join("android-native", "app", "src", "main", "assets", "www")

# Everything the page actually loads. Deliberately a list rather than
# "copy the repo and exclude things": a new top-level directory should
# have to be added here on purpose, not silently inflate the APK.
FILES = ["index.html", "manifest.json"]
DIRS = ["css", "js", "icons"]

BACKDROP_SRC = os.path.join("images", "backdrops")
BACKDROP_DST = os.path.join(DST, "images", "backdrops")
MAX_WIDTH = 1280
QUALITY = 72


def copy_app():
    for name in FILES:
        if not os.path.exists(name):
            sys.exit(f"{name} not found — run this from the repo root")
        shutil.copy2(name, os.path.join(DST, name))
    for name in DIRS:
        out = os.path.join(DST, name)
        if os.path.isdir(out):
            shutil.rmtree(out)
        shutil.copytree(name, out)
    # Deliberately NOT copied: service-worker.js. The bundled files are
    # already local, so a cache in front of them adds nothing, and
    # index.html skips registering it on the asset host anyway.


def copy_backdrops():
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow is needed for the backdrops: python3 -m pip install Pillow")

    os.makedirs(BACKDROP_DST, exist_ok=True)
    before = after = count = 0
    for name in sorted(os.listdir(BACKDROP_SRC)):
        src_path = os.path.join(BACKDROP_SRC, name)
        if not os.path.isfile(src_path):
            continue
        before += os.path.getsize(src_path)

        image = Image.open(src_path).convert("RGB")
        if image.width > MAX_WIDTH:
            height = round(image.height * MAX_WIDTH / image.width)
            image = image.resize((MAX_WIDTH, height), Image.LANCZOS)

        out_path = os.path.join(BACKDROP_DST, name)
        # progressive so a slow first paint fills in rather than wiping
        # down the screen; optimize for the few percent it costs nothing.
        image.save(out_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        after += os.path.getsize(out_path)
        count += 1
    return count, before, after


def main():
    if not os.path.isdir("android-native"):
        sys.exit("android-native/ not found — run this from the repo root")
    os.makedirs(DST, exist_ok=True)

    copy_app()
    count, before, after = copy_backdrops()

    total = sum(
        os.path.getsize(os.path.join(root, f))
        for root, _, files in os.walk(DST)
        for f in files
    )
    print(f"app copied into {DST}")
    print(f"{count} backdrops: {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
    print(f"bundle total: {total / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
