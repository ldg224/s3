"""Stamp a new asset version into every page, so browsers never mix old and new code.

GitHub Pages lets browsers cache files for 10 minutes. After an update, a page could load a
fresh home.js next to a stale ui.js and break (e.g. "does not provide an export named ...").
This script gives every local CSS/JS file the same ?v=<version>:
  - the <link>/<script src> tags in each page, and
  - an import map, so every `import ... from './x.js'` inside the modules is versioned too.

Run it before committing any change to js/ or css/:   python tools/stamp_version.py
"""
import glob
import json
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = time.strftime('%Y%m%d%H%M')
PAGES = [p for p in glob.glob(os.path.join(ROOT, '*.html'))
         if not os.path.basename(p).startswith('_') and os.path.basename(p) != '404.html']
MODULES = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'js', '*.js')))

imports = {f'./js/{m}': f'./js/{m}?v={VERSION}' for m in MODULES}
importmap = ('<script type="importmap">' + json.dumps({'imports': imports}, separators=(',', ':')) + '</script>')

for path in PAGES:
    with open(path, encoding='utf-8') as f:
        html = f.read()
    out = re.sub(r'((?:href|src)="(?:css|js)/[^"?]+\.(?:css|js))(\?v=[^"]*)?"', rf'\1?v={VERSION}"', html)
    if '<script type="importmap">' in out:
        out = re.sub(r'<script type="importmap">.*?</script>', lambda m: importmap, out, count=1, flags=re.S)
    elif '<script' in out:
        # The import map must come before the first module script.
        i = out.index('<script')
        line_start = out.rfind('\n', 0, i) + 1
        indent = out[line_start:i]
        out = out[:i] + importmap + '\n' + indent + out[i:]
    if out != html:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
        print('stamped', os.path.basename(path))
print('version', VERSION)
