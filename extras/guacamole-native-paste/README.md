# Native text paste for Guacamole 1.6.0

This extension handles Command+V in the configured macrdp connection. It reads the
browser's native paste event and sends text through the existing Guacamole
clipboard channel. It then sends Command+V to the guest. The 250 ms delay allows
CLIPRDR to deliver the text on a LAN. On a slow connection, the clipboard drawer
is available as a fallback. The extension does not request clipboard access on
focus, and regular web form fields keep their normal paste behavior.

Package the extension from this directory. Replace `CONNECTION_ID` with the
encoded ID after `#/client/` in the Guacamole URL for the macrdp connection.

```sh
python3 - CONNECTION_ID <<'PY'
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

connection_id = sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]+=*', connection_id):
    raise SystemExit('Invalid Guacamole connection ID')
with ZipFile('macrdp-native-paste.jar', 'w', ZIP_DEFLATED) as archive:
    archive.write('guac-manifest.json')
    script = Path('native-paste.js').read_text()
    archive.writestr('native-paste.js', script.replace('@MACRDP_CONNECTION_ID@', connection_id))
PY
```

Place the JAR in `GUACAMOLE_HOME/extensions` and restart the Guacamole web app.
Enable paste from the client in the selected connection. Test in Safari with
TextEdit open in the guest, including multiline text and accented characters.
Remove the JAR and restart the web app to roll back the extension.
