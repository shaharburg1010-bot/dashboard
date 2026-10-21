"""Turns the Claude-artifact dashboard (original.html) into the app's legacy.js + styles.css.
Every change is an exact search/replace that must match once, so if the original changes,
this script fails loudly instead of producing a half-ported app. Run: python3 tools/port_legacy.py <original.html>"""
import re, sys, json
src = open(sys.argv[1], encoding='utf-8').read()

css = re.search(r'<style id="app-style">(.*?)</style>', src, re.S).group(1)
js = re.search(r'<script id="app-script">(.*?)</script>\s*</body>', src, re.S).group(1)
font = re.search(r'<link id="app-font-link"[^>]*>', src).group(0)

def sub(old, new, count=1):
    global js
    n = js.count(old)
    assert n == count, f'expected {count} match(es), found {n}: {old[:70]!r}'
    js = js.replace(old, new)

# 1. STATE comes from the phone's local copy (boot.js), not from inside the page.
sub("""  var stateTag = document.getElementById('state-data');
  var STATE = JSON.parse(stateTag.textContent);""",
"""  var STATE = window.__DASH__.initialState();""")

# 2. Calendar list moves out of the (public) code into the private data file.
js = re.sub(r"  var CAL_LIST = \[.*?\n  \];\n", "  // Calendar list now lives in the data file (STATE.calendars), not in public code.\n", js, count=1, flags=re.S)
sub("    CAL_LIST.forEach(function(c){", "    (STATE.calendars || []).forEach(function(c){")

# 3. Saving: instead of republishing the whole page, hand STATE to the sync engine.
sub("""        var artifact = await claude.use('artifact');
        if(artifact){ await artifact.publish(documentHTML(STATE)); }""",
"""        window.__DASH__.save(STATE);""")
# no "saving…" lock/overlay any more: saving is instant and local
sub("""  function setSavingUI(on){""", """  function setSavingUI(on){ return; /* saving is local and instant now */""")

# 4. Updates that arrive from Drive (Claude / another device) replace STATE and re-render.
sub("""  window.addEventListener('hashchange', function(){ render(); window.scrollTo(0,0); });""",
"""  window.__DASH__.onRemoteState(function(next){ STATE = next; render(); });
  window.addEventListener('hashchange', function(){ render(); window.scrollTo(0,0); });""")

open('legacy.js', 'w', encoding='utf-8').write('// Ported from the Claude-artifact dashboard by tools/port_legacy.py — UI code unchanged except where marked.\n' + js)
open('styles.css', 'w', encoding='utf-8').write(css)
open('tools/font-link.html', 'w', encoding='utf-8').write(font)
print('ok: legacy.js', len(js), 'chars; styles.css', len(css))
