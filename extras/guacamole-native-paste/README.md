# Native text paste for Guacamole 1.6.0

This extension handles Command+V in the configured macOS and Windows connections. It reads the
browser's native paste event and sends text through the existing Guacamole
clipboard channel. It then sends Command+V to macOS or Ctrl+V to Windows. The 250 ms delay allows
CLIPRDR to deliver the text on a LAN. On a slow connection, the clipboard drawer
is available as a fallback. The extension does not request clipboard access on
focus, and regular web form fields keep their normal paste behavior.

Package the extension from this directory. Replace `CONNECTION_ID` with the
encoded ID after `#/client/` in the Guacamole URL for the macrdp connection.
Append the encoded IDs of any Windows connections as additional arguments.

```sh
python3 - CONNECTION_ID WINDOWS_CONNECTION_ID <<'PY'
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

connection_id, *windows_ids = sys.argv[1:]
if any(not re.fullmatch(r'[A-Za-z0-9_-]+=*', value) for value in (connection_id, *windows_ids)):
    raise SystemExit('Invalid Guacamole connection ID')
if connection_id in windows_ids:
    raise SystemExit('Specify each connection for a single guest OS')
with ZipFile('macrdp-native-paste.jar', 'w', ZIP_DEFLATED) as archive:
    archive.write('guac-manifest.json')
    script = Path('native-paste.js').read_text()
    script = script.replace('@MACRDP_CONNECTION_ID@', connection_id)
    script = script.replace('@WINDOWS_CONNECTION_IDS@', ','.join(windows_ids))
    archive.writestr('native-paste.js', script)
PY
```

Place the JAR in `GUACAMOLE_HOME/extensions` and restart the Guacamole web app.
Enable paste from the client in the selected connections. Test in Safari with
TextEdit on macOS or Notepad on Windows, including multiline text and accented characters.
Remove the JAR and restart the web app to roll back the extension.
