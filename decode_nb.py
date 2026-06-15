import base64
import json
import sys
import urllib.parse
from pathlib import Path

input_file = sys.argv[1] if len(sys.argv) > 1 else r"c:\Users\91814\Downloads\03.SLE_NSP_Factors.html"
output_file = sys.argv[2] if len(sys.argv) > 2 else r"c:\Users\91814\vibe-match\nb_all.txt"

html = Path(input_file).read_text(encoding="utf-8")
start = html.find("__DATABRICKS_NOTEBOOK_MODEL = ")
if start == -1:
    raise SystemExit("model not found")
start += len("__DATABRICKS_NOTEBOOK_MODEL = ")
quote = html[start]
end = start + 1
while end < len(html):
    if html[end] == quote and html[end - 1] != "\\":
        break
    end += 1
raw = html[start + 1 : end]
print("Raw length:", len(raw))
b64_decoded = base64.b64decode(raw).decode("utf-8")
decoded = urllib.parse.unquote(b64_decoded)
print("Decoded start:", decoded[:120])
data = json.loads(decoded)
cmds = data.get("commands", [])
print("Total commands:", len(cmds))

out = Path(output_file)
with out.open("w", encoding="utf-8") as f:
    for i, cmd in enumerate(cmds):
        text = cmd.get("command", "")
        f.write(f"\n{'='*60}\nCMD {i} | type={cmd.get('commandType','')} | subtype={cmd.get('subtype','')}\n{'='*60}\n")
        f.write(text)
        f.write("\n")
print("Wrote", out)
