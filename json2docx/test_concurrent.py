"""Verify concurrent generations produce unique files with correct content."""
import json
import threading
from pathlib import Path

from docx_utils import read_docx_paragraph_text
from output_mode import OutputMode
from pipeline import process_json
from templates import downloads_dir, load_template_bundle, resolve_template_dir

ROOT = Path(".")


def gen_with_company(company_1: str) -> tuple[str, str]:
    raw = Path("../scripts/test-2819-input.json").read_text(encoding="utf-8")
    data = json.loads(raw)
    # Patch company to make each generation distinguishable
    data["work_experience"]["experience_1"]["company"]["text"] = company_1
    raw = json.dumps(data, ensure_ascii=False)
    bundle = load_template_bundle(resolve_template_dir(ROOT, "Jacob"))
    result = process_json(raw, bundle, output_mode=OutputMode.DOCX_ONLY)
    assert result.ok, f"Generation failed: {result.error}"
    resume_docx = [o for o in result.outputs if o.kind == "resume"][0]
    text = read_docx_paragraph_text(resume_docx.path)
    # Clean up
    for f in result.saved_files:
        f.unlink(missing_ok=True)
    return company_1, text


results = {}
errors = []


def run(company: str):
    try:
        name, text = gen_with_company(company)
        results[name] = text
    except Exception as e:
        errors.append((company, str(e)))


companies = ["AAAA_Corp", "BBBB_Corp", "CCCC_Corp"]
threads = [threading.Thread(target=run, args=(c,)) for c in companies]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"Generated {len(results)} resumes, {len(errors)} errors")
for e in errors:
    print(f"  ERROR: {e[0]}: {e[1]}")

ok = True
for company, text in results.items():
    if company in text:
        print(f"  {company}: CORRECT (found in DOCX)")
    else:
        print(f"  {company}: WRONG (not found in DOCX!)")
        ok = False
    # Also check no OTHER company leaked in
    for other in companies:
        if other != company and other in text:
            print(f"    !!! CROSS-CONTAMINATION: {other} found in {company}'s DOCX")
            ok = False

print(f"\nResult: {'PASS' if ok and not errors else 'FAIL'}")
