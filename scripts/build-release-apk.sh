#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

detect_android_home() {
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return
  fi
  echo "ANDROID_HOME not found. Install Android SDK or set ANDROID_HOME." >&2
  exit 1
}

detect_apksigner() {
  local sdk="$1"
  local candidate
  for candidate in "$sdk"/build-tools/*/apksigner; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo "apksigner not found under $sdk/build-tools" >&2
  exit 1
}

export ANDROID_HOME="$(detect_android_home)"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
export CI=1

GRADLE_PROPS="$HOME/.gradle/gradle.properties"
if [[ ! -f "$GRADLE_PROPS" ]]; then
  echo "Missing $GRADLE_PROPS with LIFEQUEST_UPLOAD_* keys" >&2
  exit 1
fi

npx expo prebuild --platform android

APP_GRADLE="$ROOT/android/app/build.gradle"
python3 - "$APP_GRADLE" <<'PY'
import re
import sys
from pathlib import Path

p = Path(sys.argv[1])
text = p.read_text()

release_block = """
        release {
            if (project.hasProperty('LIFEQUEST_UPLOAD_STORE_FILE')) {
                storeFile file(LIFEQUEST_UPLOAD_STORE_FILE)
                storePassword LIFEQUEST_UPLOAD_STORE_PASSWORD
                keyAlias LIFEQUEST_UPLOAD_KEY_ALIAS
                keyPassword LIFEQUEST_UPLOAD_KEY_PASSWORD
            }
        }"""

if "signingConfigs.release" not in text and "signingConfigs {" in text:
    text = re.sub(
        r"(signingConfigs\s*\{)\s*",
        r"\1" + release_block + "\n",
        text,
        count=1,
    )

# Debug must stay on debug keystore; release on upload keystore when configured.
text = re.sub(
    r"(buildTypes\s*\{\s*debug\s*\{[^}]*?)signingConfig\s+signingConfigs\.\w+",
    r"\1signingConfig signingConfigs.debug",
    text,
    flags=re.S,
)
if "project.hasProperty('LIFEQUEST_UPLOAD_STORE_FILE')" in text or "LIFEQUEST_UPLOAD_STORE_FILE" in text:
    text = re.sub(
        r"(buildTypes\s*\{[^}]*release\s*\{[^}]*?)signingConfig\s+signingConfigs\.\w+",
        r"\1signingConfig signingConfigs.release",
        text,
        count=1,
        flags=re.S,
    )

if "signingConfigs.release" in text and "LIFEQUEST_UPLOAD_STORE_FILE" not in text and "project.hasProperty('LIFEQUEST_UPLOAD_STORE_FILE')" not in text:
    raise SystemExit("Release signing referenced but LIFEQUEST_UPLOAD_* properties missing")

p.write_text(text)
PY

cd "$ROOT/android"
./gradlew assembleRelease --no-daemon

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  echo "Release APK missing: $APK" >&2
  exit 1
fi

APKSIGNER="$(detect_apksigner "$ANDROID_HOME")"
if ! "$APKSIGNER" verify --min-sdk-version 24 "$APK" >/dev/null; then
  echo "apksigner verify failed — refusing to ship unsigned APK" >&2
  exit 1
fi

echo "APK_BUILT=$APK"
ls -la "$APK"
"$APKSIGNER" verify --print-certs "$APK" | grep -E 'Signer #|SHA-256 digest' | head -6