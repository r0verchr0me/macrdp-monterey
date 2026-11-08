#!/bin/sh
# Build the Intel macOS 12 variant, without ScreenCaptureKit or Swift runtime.
set -eu
cd "$(dirname "$0")/.."
export MACOSX_DEPLOYMENT_TARGET=12.0
case "${MACRDP_BUILD_PROFILE:-release}" in
  release) cargo build --locked --release --target x86_64-apple-darwin --no-default-features --features monterey; profile=release ;;
  dev) cargo build --locked --target x86_64-apple-darwin --no-default-features --features monterey; profile=debug ;;
  *) echo "MACRDP_BUILD_PROFILE must be release or dev" >&2; exit 2 ;;
esac
bundle=dist/monterey/macrdpMonterey.app
mkdir -p "$bundle/Contents/MacOS"
cp "target/x86_64-apple-darwin/$profile/macrdp" "$bundle/Contents/MacOS/macrdp"
python3 - "$bundle" <<'PY'
import plistlib, sys
from pathlib import Path
bundle = Path(sys.argv[1])
plist = {
    'CFBundleName': 'macrdpMonterey',
    'CFBundleDisplayName': 'macrdp Monterey',
    'CFBundleIdentifier': 'local.macrdp.monterey',
    'CFBundleExecutable': 'macrdp',
    'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '0.9.11',
    'CFBundleShortVersionString': '0.9.11-monterey.1',
    'LSMinimumSystemVersion': '12.0',
    'LSUIElement': True,
    'NSMicrophoneUsageDescription': 'Capture system sound from the BlackHole virtual audio device for RDP.',
    'NSAppleEventsUsageDescription': 'Forward remote keyboard shortcuts at the user request.',
}
(bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
PY
strip "$bundle/Contents/MacOS/macrdp"
codesign --force --sign - "$bundle"
cp LICENSE* dist/monterey/
cp docs/MONTEREY.md dist/monterey/
printf '%s\n' "Built $bundle (ad-hoc signed; not notarized). See docs/MONTEREY.md."
