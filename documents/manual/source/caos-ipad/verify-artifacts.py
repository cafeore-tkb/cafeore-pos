"""PDFのページ・文字・埋め込みフォントとSVGの段落・画像構造を点検する。"""
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
import fitz
folder=Path(__file__).resolve().parent
pdf=fitz.open(folder/'../../pdf/master-sheet-ipad.pdf')
assert len(pdf)==8
ns={'s':'http://www.w3.org/2000/svg'}
normalize=lambda s:re.sub(r'\s+','',s)
md=(folder/'guide.md').read_text()
blocks={m[1]:re.sub(r'^(?:#{1,6}|-) ','',m[2]) for m in re.finditer(r'<!-- block:([\w-]+) -->\n([\s\S]*?)(?=\n\n)',md)}
fonts={}
for page in pdf:
    assert abs(page.rect.width-841.89)<1 and abs(page.rect.height-595.28)<1
    for row in page.get_fonts():
        name,extension,kind,data=pdf.extract_font(row[0]);assert data and extension=='ttf',(name,extension,kind)
        fonts[name]={'format':kind,'embedded_bytes':len(data)}
seen={};images=0;paragraphs=0
for n,page in enumerate(pdf,1):
    svg=ET.parse(folder/f'../../editable/caos-ipad/page-{n:02}.svg').getroot()
    for el in svg.findall('s:text',ns):
        paragraphs+=1
        block=el.get('id')
        if block in blocks:
            assert block not in seen,block
            actual=''.join(el.itertext())
            expected=blocks[block]
            if block in ('p8-20','p8-21','p8-22','p8-23'):actual=re.sub(r'^\d+\.\s*','',actual)
            assert normalize(actual)==normalize(expected),(block,actual,expected)
            assert normalize(expected) in normalize(page.get_text()),f'PDFに本文がありません: {block}'
            seen[block]=n
    for el in svg.findall('s:image',ns):
        href=el.get('{http://www.w3.org/1999/xlink}href') or el.get('href')
        assert href.startswith('data:image/png;base64,'),'画像が外部参照です'
        images+=1
assert set(seen)==set(blocks),(set(blocks)-set(seen))
result={'pages':len(pdf),'markdown_blocks_verified_in_pdf_and_svg':len(seen),'svg_text_objects':paragraphs,'embedded_images':images,'fonts':fonts,'illustrator_application_test':'not performed'}
(folder/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
