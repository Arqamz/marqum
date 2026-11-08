#!/usr/bin/env sh
# Runs the Android Gradle wrapper with sensible local defaults.
#   JAVA_HOME / ANDROID_HOME: kept if set, else the Homebrew JDK 21 and the default macOS SDK location.
#   Release signing: env vars MARQUM_KEYSTORE_* win; else ${MARQUM_KEYSTORE_ENV:-~/.marqum/keystore.env} is loaded
#   if it exists; else android/keystore.properties (see README).
set -e
cd "$(dirname "$0")/../android"

if [ -z "$JAVA_HOME" ] && [ -d /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
fi
if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

KEYSTORE_ENV="${MARQUM_KEYSTORE_ENV:-$HOME/.marqum/keystore.env}"
if [ -z "$MARQUM_KEYSTORE_PATH" ] && [ -f "$KEYSTORE_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$KEYSTORE_ENV"
  set +a
fi

exec ./gradlew "$@"
