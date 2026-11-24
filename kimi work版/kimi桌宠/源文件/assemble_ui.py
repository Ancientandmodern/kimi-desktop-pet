from argparse import ArgumentParser
from pathlib import Path
ROOT=Path(__file__).resolve().parent
source=ROOT/'installed-index.source.html'
text=source.read_text(encoding='utf-8')
addon=(ROOT/'companion-controls.html').read_text(encoding='utf-8')
input_marker='    /* COMPANION_INPUT */'
assert text.count(input_marker)==1
text=text.replace(input_marker,(ROOT/'companion-input.js').read_text(encoding='utf-8').rstrip())
needle='''      parent.postMessage({\n        type: 'daimon-pet:interactive-region','''
body_fix='''    function reportInteractiveRegion(dragRect) {\n      if (PET_PREVIEW) return;\n      const hitRegions = isThreeManifest(manifest) ? [] : [dragRect];'''
body_replacement='''    function reportInteractiveRegion(dragRect) {\n      if (PET_PREVIEW) return;\n      const hitRegions = dragRect && dragRect.width > 0 && dragRect.height > 0 ? [dragRect] : [];'''
assert text.count(body_fix)==1
text=text.replace(body_fix,body_replacement)
insert='''      for (const element of document.querySelectorAll('#kc-launcher, #kc-panel:not([hidden]), #kc-chatter[data-show="true"]')) {\n        const rect = element.getBoundingClientRect();\n        if (rect.width > 0 && rect.height > 0 && element.id === 'kc-panel' || element.id === 'kc-launcher') hitRegions.push({x:Math.round(rect.left),y:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)});\n      }\n'''+needle
assert text.count(needle)==1
text=text.replace(needle,insert)
assert text.count('</body>')==1
text=text.replace('</body>',addon+'\n</body>')
parser=ArgumentParser(description="Assemble the Kimi Work companion interface.")
parser.add_argument('--output',type=Path,default=ROOT.parent/'完整界面'/'index.html')
destination=parser.parse_args().output
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(text,encoding='utf-8')
print('Wrote',destination,len(text))
