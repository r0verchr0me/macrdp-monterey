# Monterey / Intel fork

This branch adds a separate macOS 12 build to clintcan/macrdp. Upstream commit:
`8848191f866813df13ffa039c8c87b5eca32aa62`.

The goal is a real RDP server with NSPasteboard ↔ CLIPRDR text synchronization
for an Intel macOS Monterey guest, reachable through Apache Guacamole.
Compatibility is **experimental until the guest acceptance checks below pass**.
A successful cross-build alone is not a claim of a working Monterey session.

## Build

Requires Xcode/Command Line Tools, Rust (Cargo), CMake, and the Intel target:

```sh
rustup target add x86_64-apple-darwin
./scripts/build-monterey.sh
```

Run the native logic tests on the build Mac:

```sh
MACOSX_DEPLOYMENT_TARGET=12.0 cargo test --locked --no-default-features --features monterey capture::monterey::tests
```

The bundle is `dist/monterey/macrdpMonterey.app`. The modern build remains the
upstream default. The Monterey build must use `--no-default-features --features
monterey` to exclude ScreenCaptureKit, including its newer Swift runtime dependency.

## What changes

- Capture uses public `CGDisplayCreateImage` and an explicitly BGRA bitmap context,
  available on Monterey; ScreenCaptureKit is not linked.
- Capture mirrors a logged-in physical/virtual machine display; unchanged tiles
  are suppressed, and changed tiles are sent through upstream bitmap codecs.
- Mouse coordinates use the same shared desktop-size and letterbox state as
  upstream input; debounced RDP resize reactivates the display stream.
- Input, TLS/NLA local-account authentication and NSPasteboard/CLIPRDR remain
  upstream implementations. This bypasses the Apple VNC clipboard limitation.
- System-audio capture, microphone, camera, USB redirection, H.264 and private
  virtual-display modes are not supported in this build. Unsupported options fail
  at startup. This is a software capture path, not a graphics driver.

## First run inside the guest

Keep the existing VNC connection as a fallback. Do not run as root or a system
LaunchDaemon: screen capture and the pasteboard belong to the logged-in GUI user.

From Terminal, as the guest user, run:

```sh
/path/to/macrdpMonterey.app/Contents/MacOS/macrdp \
  --bind 192.0.2.10:3390 --username user \
  --width 1280 --height 720 --fps 15 --no-rich-clipboard
```

The password prompt expects the existing local macOS account password. Do not put
it in the command line. Grant Screen Recording and Accessibility to the identity
shown by macOS, then quit and restart the server. Keep its signature and path
stable so permissions survive relaunches. Ad-hoc signing is not notarization.
A user may need to approve the app in macOS security settings.

## Guacamole trial

Create a separate connection named `macOS Monterey RDP (test)`:

- Protocol: RDP; host `192.0.2.10`; port `3390`; username `user`.
- Security: NLA; existing local account password entered by the user.
- Clipboard copy/paste enabled; test plain Unicode text before rich formats.
- Start with 1280×720 and bitmap codecs, without H.264 or audio.
- Trust the server certificate after checking its fingerprint. For production,
  use a trusted certificate via upstream TLS certificate options.

## Acceptance checks — must be run on Monterey, not inferred from compilation

1. Binary starts on x86_64 macOS 12.7.6 with no missing symbols/frameworks.
2. Correct account accepted; wrong password rejected; network stays LAN-only.
3. Desktop renders, cursor matches clicks, scrolling and typing work.
4. Guacamole → TextEdit/Terminal and TextEdit → Guacamole: copy plain text with
   accents, emoji and multiple lines. Test both the menu clipboard and browser
   clipboard permission flow. Browsers may require user interaction per paste.
5. Idle display sends no bitmap tiles. Resume and reconnect repaint the desktop.
6. Changing the client viewport keeps input alignment and image orientation.
7. Compare scrolling/dragging with VNC at the same resolution; report actual
   results, not advertised frame-rate limits.

Stop with Ctrl-C. The trial does not install a startup service, alter VNC, disable
SIP/AMFI, or provide GPU acceleration. Do not configure auto-start before the
interactive acceptance checks pass.

## Validation recorded for this fork

- Intel build with deployment target macOS 12.0: passed.
- Mach-O minimum OS: 12.0; no ScreenCaptureKit or Swift runtime dependency.
- CLI startup (`--help`) on the build Mac via Rosetta: passed.
- Changed-tile / edge capture test: 1 passed.
- In-memory RDP connection tests: 14 passed.
- Monterey guest capture, input and Guacamole clipboard tests: pending.
