"""Inspect the Jacob resume.docx template to find where placeholders are."""
import re
import sys
from pathlib import Path
from lxml import etree

NSMAP = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
}
PLACEHOLDER_RE = re.compile(r'<<[^>]+>>')

def inspect_template(docx_path: str):
    import zipfile
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read('word/document.xml')

    tree = etree.fromstring(xml)
    body = tree.find('.//w:body', NSMAP)
    if body is None:
        print("No body found")
        return

    print(f"=== Inspecting: {docx_path} ===\n")

    # Check all paragraphs (including those inside SDTs)
    print("--- ALL paragraphs (including SDT children) ---")
    for i, p in enumerate(body.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')):
        texts = []
        for t in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
            if t.text:
                texts.append(t.text)
        full = ''.join(texts)
        if '<<' in full or 'Extracted' in full or '[JD' in full or 'City, ST' in full:
            # Check if this paragraph is inside an SDT
            parent = p.getparent()
            in_sdt = False
            ancestors = []
            node = p
            while node is not None:
                tag = etree.QName(node.tag).localname if isinstance(node.tag, str) else str(node.tag)
                ancestors.append(tag)
                if tag == 'sdt' or tag == 'sdtContent':
                    in_sdt = True
                node = node.getparent()

            sdt_label = " [INSIDE SDT]" if in_sdt else " [NORMAL PARAGRAPH]"
            print(f"  Para {i}: {full[:120]}{sdt_label}")

    # Check SDT elements specifically
    print("\n--- SDT (Content Control) elements ---")
    for sdt in body.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sdt'):
        # Get SDT properties
        sdt_pr = sdt.find('w:sdtPr', NSMAP)
        alias = sdt_pr.find('w:alias', NSMAP) if sdt_pr is not None else None
        tag = sdt_pr.find('w:tag', NSMAP) if sdt_pr is not None else None
        alias_val = alias.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '') if alias is not None else ''
        tag_val = tag.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '') if tag is not None else ''

        # Get SDT content text
        sdt_content = sdt.find('w:sdtContent', NSMAP)
        texts = []
        if sdt_content is not None:
            for t in sdt_content.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                if t.text:
                    texts.append(t.text)
        full = ''.join(texts)

        # Check showing placeholder
        showing_plc = sdt_pr.find('w:showingPlcHdr', NSMAP) if sdt_pr is not None else None
        showing = showing_plc is not None

        if full or alias_val or tag_val:
            print(f"  SDT alias='{alias_val}' tag='{tag_val}' showingPlcHdr={showing}")
            print(f"    content: {full[:120]}")

if __name__ == '__main__':
    inspect_template(str(Path(__file__).parent.parent / 'json2docx' / 'resume_template' / 'Jacob' / 'resume.docx'))
