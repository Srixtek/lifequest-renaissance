#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

if [ ! -f "$HOME/.gradle/gradle.properties" ]; then
  echo "Missing ~/.gradle/gradle.properties with LIFEQUEST_UPLOAD_* keys" >&2
  exit 1
fi

npx expo prebuild --platform android --non-interactive

# Inject signing into android/app/build.gradle if missing
APP_GRADLE="$ROOT/android/app/build.gradle"
if ! grep -q 'LIFEQUEST_UPLOAD_STORE_FILE' "$APP_GRADLE"; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/home/ubuntu/lifequest/android/app/build.gradle")
text = p.read_text()
signing = '''
    signingConfigs {
        release {
            storeFile file(LIFEQUEST_UPLOAD_STORE_FILE)
            storePassword LIFEQUEST_UPLOAD_STORE_PASSWORD
            keyAlias LIFEQUEST_UPLOAD_KEY_ALIAS
            keyPassword LIFEQUEST_UPLOAD_KEY_PASSWORD
        }
    }
'''
# Prefer groovy properties from gradle.properties (project-level)
if 'signingConfigs' not in text:
    text = text.replace('buildTypes {', signing + '\n    buildTypes {')
text = text.replace(
    'signingConfig signingConfigs.debug',
    'signingConfig signingConfigs.release',
)
# Ensure release uses release signing
import re
text = re.sub(
    r'(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.\w+',
    r'\1signingConfig signingConfigs.release',
    text,
    flags=re.S,
)
p.write_text(text)
print('Patched signingConfigs in app/build.gradle')
PY
fi

# Ensure package name
cd "$ROOT/android"
./gradlew assembleRelease --no-daemon
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
echo "APK_BUILT=$APK"
ls -la "$APK"
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs "$APK" | head -20
