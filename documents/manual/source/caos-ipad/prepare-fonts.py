"""Google FontsのNotoSansJP[wght].ttfを静的な400/700へ変換し、原稿に必要な文字を残す。"""
import argparse
from html.parser import HTMLParser
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
parser=argparse.ArgumentParser();parser.add_argument('font');args=parser.parse_args()
folder=Path(__file__).resolve().parent
class VisibleText(HTMLParser):
    def __init__(self):super().__init__();self.skip=0;self.text=''
    def handle_starttag(self,tag,attrs):
        if tag in ('style','script'):self.skip+=1
    def handle_endtag(self,tag):
        if tag in ('style','script'):self.skip-=1
    def handle_data(self,data):
        if not self.skip:self.text+=data
visible=VisibleText();visible.feed((folder/'manual.html').read_text())
chars=visible.text+''.join(chr(x) for x in range(32,127))
(folder/'fonts').mkdir(exist_ok=True)
for weight,name in [(400,'Regular'),(700,'Bold')]:
    font=instantiateVariableFont(TTFont(args.font),{'wght':weight},inplace=False,updateFontNames=True)
    options=subset.Options();options.name_IDs=['*'];options.name_legacy=True;options.name_languages=['*']
    sub=subset.Subsetter(options=options);sub.populate(text=chars);sub.subset(font)
    font.save(folder/'fonts'/f'NotoSansJP-{name}.ttf')
    print(name,len(font.getBestCmap()),'characters')
