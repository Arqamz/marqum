# Marqūm for Android

A Capacitor 8 shell around `apps/web` plus one Kotlin plugin, `MarqumNative`. The plugin provides the statement inbox,
the share target, bank-notification capture and app info. Its JS contract is
[`apps/web/src/native/marqum-native.ts`](../web/src/native/marqum-native.ts).

- Package `app.marqum`, label "Marqūm", minSdk 26, target/compile SDK 36.
- Sideloaded only (never Play), so it uses `MANAGE_EXTERNAL_STORAGE` to read NayaPay's `Android/media` folder.

## Layout

```
apps/android/
  capacitor.config.ts      appId, webDir (../web/dist), SystemBars (edge-to-edge, CSS safe-area insets)
  version.properties       default versionName / versionCode (CI overrides from the tag)
  scripts/gradle.sh        runs ./gradlew with JAVA_HOME / ANDROID_HOME defaults and the local keystore env
  android/                 the Gradle project (Capacitor generated, then customised)
    app/src/main/java/app/marqum/
      MainActivity.kt              registers the plugin
      MarqumNativePlugin.kt        the JS-facing plugin
      StatementInbox.kt            scans the NayaPay folder and Download/ for statement files
      ShareInbox.kt                SEND / SEND_MULTIPLE / VIEW → in-memory queue (.pdf/.csv only)
      BankNotificationListener.kt  NotificationListenerService (com.nayapay.app, com.sadapay.app only)
      NotificationLog.kt           last 200 captures, JSON file in app-private storage
      IngestUploader.kt            WorkManager upload to /api/ingest/notification (network constraint, backoff)
      IngestConfig.kt              apiBase + bearer token (token AES-GCM-encrypted with an Android Keystore key)
```

## Prerequisites

- JDK 21. On macOS: `brew install openjdk@21`.
- An Android SDK with `platforms;android-36` and `build-tools;36.0.0`. `ANDROID_HOME` defaults to `~/Library/Android/sdk`.
- `pnpm install` at the repo root.

`scripts/gradle.sh` uses the Homebrew JDK and the default SDK path when `JAVA_HOME` or `ANDROID_HOME` is unset.

## Build

```sh
pnpm --filter @marqum/web build        # produces apps/web/dist
cd apps/android
pnpm sync                               # cap sync android: copies dist + plugin config into the Gradle project
pnpm build:debug                        # android/app/build/outputs/apk/debug/app-debug.apk
pnpm build:release                      # android/app/build/outputs/apk/release/app-release.apk (signed)
pnpm lint:android                       # Android lint (fails on errors)
pnpm install:phone                      # adb install -r the release APK
```

`cap sync` regenerates `android/capacitor.settings.gradle` and `android/app/capacitor.build.gradle`. They point at
pnpm's real `node_modules/.pnpm/...` paths, which Capacitor resolves itself, so no extra pnpm settings are needed.

## Versioning

`version.properties` holds the default (`0.1.0` / `1`). Gradle properties override it:

```sh
sh scripts/gradle.sh assembleRelease -PversionName=0.2.0 -PversionCode=7
```

CI sets `versionName` from the tag (`v0.2.0` → `0.2.0`) and `versionCode` from `github.run_number`. Run numbers only
grow, so Android always accepts the update.

## Signing

The release build takes its keystore from, in order:

1. environment variables `MARQUM_KEYSTORE_PATH`, `MARQUM_KEYSTORE_PASSWORD`, `MARQUM_KEY_ALIAS`, `MARQUM_KEY_PASSWORD`;
2. `scripts/gradle.sh` loads them from `~/.marqum/keystore.env` (or `$MARQUM_KEYSTORE_ENV`) if they are unset;
3. otherwise `android/keystore.properties` (gitignored), with keys `storeFile`, `storePassword`, `keyAlias` and `keyPassword`.

Without a keystore the release APK is built unsigned, and Gradle prints a warning.

The release keystore lives outside the repo, in `~/.marqum/release.jks` (alias `marqum`, PKCS12). Its passwords are in
`~/.marqum/keystore.env` (mode 600). **Back both up somewhere safe.** If the key is lost, installed copies can't be
updated: you'd have to uninstall, which wipes local data, and install again.

### GitHub secrets for the release workflow

```sh
base64 -i ~/.marqum/release.jks | gh secret set MARQUM_KEYSTORE_BASE64
. ~/.marqum/keystore.env
printf %s "$MARQUM_KEYSTORE_PASSWORD" | gh secret set MARQUM_KEYSTORE_PASSWORD
printf %s "$MARQUM_KEY_ALIAS"         | gh secret set MARQUM_KEY_ALIAS
printf %s "$MARQUM_KEY_PASSWORD"      | gh secret set MARQUM_KEY_PASSWORD
# optional: licensed fonts (the files themselves, no top-level folder)
tar -czf - -C apps/web/src/fonts/licensed . | base64 | gh secret set MARQUM_FONTS_TGZ_BASE64
```

## Releasing

Push a tag: `git tag v0.2.0 && git push origin v0.2.0`. The
[`release-android`](../../.github/workflows/release-android.yml) workflow then:

1. builds the web app with `VITE_API_BASE=https://marqum.arqam-mzia.workers.dev`;
2. runs `cap sync` and `assembleRelease`;
3. checks the signature with `apksigner`;
4. publishes `marqum-<version>.apk` as a GitHub Release.

Tags with a suffix, such as `v0.2.0-rc.1`, are published as pre-releases.

## Installing on the phone

Use **Obtainium** for automatic updates:

1. Install Obtainium (from F-Droid or its GitHub releases).
2. **Add app**, then paste `https://github.com/Arqamz/marqum` as the source URL and add it.
3. Obtainium installs the latest release APK. After that it checks for new `v*` releases and offers updates.

You can also install by hand: `adb install -r marqum-<version>.apk`, or open the APK from the phone's Download folder.

### First-run permissions

The app asks for each of these from its setup screens:

- **All files access** opens the system screen for Marqūm. It lets the app read
  `Android/media/com.nayapay.app/NayaPay/Other/` and `Download/`.
- **Notification access** opens Settings › Notification access › Marqūm.
  - If the switch is greyed out ("Restricted setting"), open App info › ⋮ › **Allow restricted settings**, then try again.
  - Android adds this restriction to some sideloaded apps.
- **Notifications** (Android 13+) is a runtime prompt for the month-end reminders.
- **Fingerprint** is used through the biometric plugin when needed.

## What the native side does

- **Statement inbox.**
  - `scanStatements({ since })` lists `m-MM-YYYY.pdf|csv` and `sadapay_account_statement_*.pdf` files that are newer
    than `since`.
  - It looks in the NayaPay folder and `Download/`.
  - `readFile({ path })` returns base64. It only reads files under shared storage, up to 25 MB.
- **Share target.**
  - PDF and CSV files shared or opened into Marqūm are copied into memory.
  - `getPendingShares()` returns them and clears the queue. This includes the share that launched the app.
  - Files shared while the app is running come through the `shareReceived` event, if the UI listens for it.
  - Otherwise they are queued.
  - Files that are not `.pdf` or `.csv` are dropped. The `*/*` share filter would otherwise let anything in.
- **Notification capture.**
  - The service captures notifications from `com.nayapay.app` and `com.sadapay.app` only, and skips group summaries.
  - It keeps the title and the big text (or the text if there is no big text).
  - `posted_at` is Asia/Karachi local time (`YYYY-MM-DDTHH:mm`).
  - `id` is `sha256(package|postTime|title|text)`. The same notification re-posted with the same content is ignored.
- **Upload.**
  - Each capture is appended to the local log, and the `notificationCaptured` event fires if the WebView is alive.
  - A unique WorkManager job then POSTs `{id, package, title, text, posted_at}` to `${apiBase}/api/ingest/notification`
    with `Authorization: Bearer <token>`. It retries with exponential backoff and waits for a network connection.
  - 2xx or 409 counts as sent. 401/403 pause uploads until `configureIngest` is called again.
  - Other 4xx responses mark the entry as rejected, so it isn't retried forever.
- **Privacy.**
  - Notification contents are never written to logcat.
  - The app opts out of Android backup (`allowBackup=false`, data-extraction rules exclude everything).
  - The ingest token is encrypted with a non-exportable Android Keystore key.
