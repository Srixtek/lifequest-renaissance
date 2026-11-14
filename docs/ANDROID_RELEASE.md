# Build Android release

`applicationId` : `lifequest.renaissance`
`versionName` : 0.1.0 · `versionCode` : 1

Keystore **hors dépôt** : `~/lifequest-keystore/lifequest-release.keystore`
Credentials Gradle : `~/.gradle/gradle.properties` (chmod 600) — ne jamais committer ni coller les mots de passe.

```bash
export ANDROID_HOME=$HOME/Android/Sdk
bash scripts/build-release-apk.sh
```

APK : `android/app/build/outputs/apk/release/app-release.apk`
Vérifier : `apksigner verify --print-certs …`
