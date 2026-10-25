"""Bounded local document extraction with local Tesseract OCR. Originals stay intact."""
import sys, os, zipfile, json, subprocess, tempfile, time, math, xml.etree.ElementTree as ET
from pathlib import Path
MAX = 2 * 1024 * 1024
warnings = []
metadata = {'method': 'text', 'visuallyVerified': False, 'ocrPages': []}
file, ext = sys.argv[1:3]
ext = ext.lower()
if os.path.getsize(file) > 12 * 1024 * 1024:
    raise ValueError('File exceeds 12 MB')

def ocr(pages=None):
    """Use installed local Tesseract; no network or model downloads."""
    started = time.monotonic()
    executable = next((p for p in ('/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract') if os.path.isfile(p)), None)
    if not executable:
        warnings.append('Local Tesseract OCR unavailable; inspect the original.')
        return {}
    usable = {}
    document = None
    try:
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = 30_000_000
        if pages is not None:
            import pypdfium2 as pdfium
            document = pdfium.PdfDocument(file)
        with tempfile.TemporaryDirectory(prefix='jarvis-study-ocr-', dir='/private/tmp') as temporary:
            for number in (pages[:20] if pages is not None else [1]):
                if time.monotonic() - started > 40:
                    warnings.append('OCR time budget reached; remaining pages need review.')
                    break
                if document is not None:
                    page = document[number - 1]
                    width, height = page.get_size()
                    if not (math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0):
                        page.close()
                        raise ValueError('Invalid PDF dimensions')
                    bitmap = page.render(scale=min(2.5, 2400 / max(width, height)))
                    image = bitmap.to_pil().copy()
                    bitmap.close()
                    page.close()
                else:
                    with Image.open(file) as original:
                        if original.width * original.height > 30_000_000:
                            raise ValueError('Image exceeds 30 megapixels')
                        image = ImageOps.exif_transpose(original).convert('RGB')
                    image.thumbnail((2400, 2400))
                target = Path(temporary) / 'page.png'
                image.save(target)
                image.close()
                result = subprocess.run([executable, str(target), 'stdout', '-l', 'eng', 'tsv'],
                    capture_output=True, text=True, timeout=max(1, 45 - (time.monotonic() - started)),
                    env=dict(os.environ, OMP_THREAD_LIMIT='2'))
                if result.returncode:
                    warnings.append('Local OCR failed on page ' + str(number) + '; inspect the original.')
                    continue
                lines = {}
                scores = []
                import csv, io
                for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
                    word = (row.get('text') or '').strip()
                    if word:
                        key = tuple(row.get(k) for k in ('block_num', 'par_num', 'line_num'))
                        lines.setdefault(key, []).append(word)
                        scores.append(float(row.get('conf', '-1')))
                text = '\n'.join(' '.join(words) for words in lines.values())
                if text.strip():
                    usable[number] = {'page': number, 'text': text, 'lines': len(lines),
                                      'lowConfidenceWords': sum(score < 80 for score in scores)}
        if pages is not None and len(pages) > 20:
            warnings.append('OCR limited to 20 empty PDF pages; remaining pages need review.')
    except (subprocess.TimeoutExpired, OSError, ValueError, ImportError):
        warnings.append('Local OCR unavailable or exceeded its time budget; inspect the original.')
    finally:
        if document is not None:
            document.close()
    metadata['ocrEngine'] = 'tesseract-local-eng'
    metadata['ocrPages'] = [{k: value for k, value in p.items() if k != 'text'} for p in usable.values()]
    if usable:
        warnings.append('Local English OCR is unverified and may misread other languages, names, numbers, equations, tables and reading order. Check the original before citing or calculating; figures and layout are not visually verified.')
    return usable

if ext == '.docx':
    with zipfile.ZipFile(file) as z:
        if any(n.startswith(('word/media/', 'word/embeddings/')) for n in z.namelist()):
            warnings.append('Document contains images or embedded objects; their contents are not included in extracted text. Review the original before relying on figures or charts.')
        names = [n for n in z.namelist() if n == 'word/document.xml' or n.startswith(('word/footnotes', 'word/endnotes', 'word/header', 'word/footer')) and n.endswith('.xml')]
        if sum(z.getinfo(n).file_size for n in names) > 8 * 1024 * 1024:
            raise ValueError('Expanded document exceeds limit')
        out = []
        for n in names:
            root = ET.fromstring(z.read(n))
            for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                out.append(''.join(x.text or '' for x in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')))
        text = '\n'.join(out)
elif ext == '.pdf':
    from pypdf import PdfReader
    reader = PdfReader(file)
    if reader.is_encrypted:
        raise ValueError('Encrypted PDF needs an unlocked copy')
    if len(reader.pages) > 500:
        raise ValueError('PDF exceeds 500 page import limit')
    warnings.append('PDF diagrams, figures and layout have not been visually verified.')
    pages = []
    size = 0
    for page in reader.pages:
        value = page.extract_text() or ''
        size += len(value.encode('utf8'))
        if size > MAX:
            raise ValueError('Extracted text exceeds 2 MB')
        pages.append(value)
    empty = [i + 1 for i, value in enumerate(pages) if not value.strip()]
    recognized = ocr(empty) if empty else {}
    if recognized:
        metadata['method'] = 'text+local-ocr'
        for n, result in recognized.items():
            pages[n - 1] = '[Unverified local OCR]\n' + result['text']
    missing = [n for n in empty if n not in recognized]
    metadata['unreadPages'] = missing
    if missing:
        warnings.append('No readable text on PDF pages ' + ', '.join(map(str, missing)) + '. These may be blank or unreadable scans; inspect the original.')
    if not any(value.strip() for value in pages):
        raise ValueError('No readable text after local OCR; original needs manual review')
    text = '\n\n'.join('[Page ' + str(i + 1) + ']\n' + value for i, value in enumerate(pages))
elif ext in ('.png', '.jpg', '.jpeg'):
    recognized = ocr()
    if not recognized:
        raise ValueError('No readable text after local OCR; original image needs manual review')
    metadata['method'] = 'local-ocr'
    text = '[Image 1 — unverified local OCR]\n' + recognized[1]['text']
else:
    raise ValueError('Unsupported extraction type')
if len(text.encode('utf8')) > MAX:
    raise ValueError('Extracted text exceeds 2 MB')
if not text.strip():
    raise ValueError('No readable text; OCR may be needed')
print(json.dumps({'text': text, 'warnings': warnings, 'extraction': metadata}))
