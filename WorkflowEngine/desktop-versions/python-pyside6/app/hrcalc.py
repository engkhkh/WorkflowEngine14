"""Employee import helpers (port of the portal's hr.fields.ts): reading .xlsx / .csv, matching columns to employee fields, validating rows.
No extra libraries: an .xlsx file is a zip of XML files, read with the standard library."""
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def norm(s):
    return re.sub(r'[\s_\-.]+', ' ', str('' if s is None else s).strip().lower())


def guess_field(fields, heading):
    h = norm(heading)
    if not h:
        return None
    flat = h.replace(' ', '')
    for f in fields:
        for n in f['names']:
            nn = norm(n)
            if nn == h or nn.replace(' ', '') == flat:
                return f['key']
    return None


def _valid(y, m, d):
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def parse_date(v):
    if v is None or v == '':
        return None
    if isinstance(v, (datetime, date)):
        return v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, (int, float)):
        if 20000 < v < 80000:
            return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
        return None
    s = str(v).strip()
    m = re.match(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', s)
    if m:
        return _valid(int(m[1]), int(m[2]), int(m[3]))
    m = re.match(r'^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})', s)
    if m:
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        return _valid(y, b, a) if a > 12 else (_valid(y, a, b) if b > 12 else _valid(y, b, a))   # day first (the usual format in the region)
    return None


def parse_status(words, v):
    s = norm(v)
    if not s:
        return 'Active'
    return words.get(s) or words.get(s.replace(' ', ''))


def parse_gender(v):
    s = norm(v)
    if not s:
        return None
    if s in ('m', 'male', 'man', 'ذكر', 'رجل'):
        return 'Male'
    if s in ('f', 'female', 'woman', 'أنثى', 'انثى', 'امرأة'):
        return 'Female'
    return '?'


def cell_text(v):
    if v is None:
        return ''
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def map_rows(spec, rows, mapping, first_data_row=1, can_salary=True):
    """mapping: column index -> field key ('' = skipped). -> [{'row', 'data', 'errors'}]; errors make a row unimportable."""
    out = []
    by_field = {f: int(c) for c, f in mapping.items() if f}
    for i in range(first_data_row, len(rows)):
        r = rows[i] or []
        if all(c is None or str(c).strip() == '' for c in r):
            continue
        data, errors = {}, []
        for f in spec['fields']:
            col = by_field.get(f['key'])
            if col is None or (f.get('salary') and not can_salary):
                continue
            raw = r[col] if col < len(r) else None
            if raw is None or str(raw).strip() == '':
                if f.get('required'):
                    errors.append(f['key'])
                continue
            t = f['type']
            if t == 'date':
                d = parse_date(raw)
                if d:
                    data[f['key']] = d
                else:
                    errors.append(f"{f['key']}:date")
            elif t == 'number':
                try:
                    n = float(str(raw).replace(',', '').replace(' ', '')) if not isinstance(raw, (int, float)) else raw
                    data[f['key']] = int(n) if n == int(n) else n
                except ValueError:
                    errors.append(f"{f['key']}:number")
            elif t == 'status':
                s = parse_status(spec['status'], raw)
                if s:
                    data[f['key']] = s
                else:
                    errors.append(f"{f['key']}:status")
            elif t == 'gender':
                g = parse_gender(raw)
                if g and g != '?':
                    data[f['key']] = g
                else:
                    errors.append(f"{f['key']}:gender")
            elif t == 'email':
                e = str(raw).strip()
                if '@' in e:
                    data[f['key']] = e
                else:
                    errors.append(f"{f['key']}:email")
            else:
                data[f['key']] = cell_text(raw)
        if not data.get('status'):
            data['status'] = 'Active'
        out.append({'row': i + 1, 'data': data, 'errors': errors})
    return out


def mark_duplicates(mapped):
    seen = set()
    for m in mapped:
        no = str(m['data'].get('empNo', '')).lower()
        if no and no in seen:
            m['errors'].append('empNo:dup')
        if no:
            seen.add(no)


def parse_csv(text):
    text = text.lstrip('﻿')
    first = text.split('\n', 1)[0]
    delim = max((',', ';', '\t'), key=lambda d: len(first.split(d)))
    rows, row, cur, q, i = [], [], '', False, 0
    while i < len(text):
        c = text[i]
        if q:
            if c == '"':
                if text[i + 1:i + 2] == '"':
                    cur += '"'
                    i += 1
                else:
                    q = False
            else:
                cur += c
        elif c == '"':
            q = True
        elif c == delim:
            row.append(cur)
            cur = ''
        elif c in '\r\n':
            if c == '\r' and text[i + 1:i + 2] == '\n':
                i += 1
            row.append(cur)
            rows.append(row)
            row, cur = [], ''
        else:
            cur += c
        i += 1
    if cur != '' or row:
        row.append(cur)
        rows.append(row)
    return rows


def _col_index(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref)[0]:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path):
    """first worksheet of an .xlsx file -> list of rows (values: str / int / float / None)"""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if 'xl/sharedStrings.xml' in names:
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(_NS + 'si'):
                shared.append(''.join(t.text or '' for t in si.iter(_NS + 't')))
        sheet = 'xl/worksheets/sheet1.xml'
        if sheet not in names:
            sheet = sorted(n for n in names if n.startswith('xl/worksheets/') and n.endswith('.xml'))[0]
        rows = []
        for r in ET.fromstring(z.read(sheet)).iter(_NS + 'row'):
            idx = int(r.get('r', len(rows) + 1)) - 1
            while len(rows) < idx:
                rows.append([])
            row = []
            for c in r.findall(_NS + 'c'):
                ci = _col_index(c.get('r', 'A1'))
                while len(row) < ci:
                    row.append(None)
                t, v = c.get('t'), c.find(_NS + 'v')
                if t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(_NS + 't'))
                elif v is None or v.text is None:
                    val = None
                elif t == 's':
                    val = shared[int(v.text)]
                elif t in ('str', 'e'):
                    val = v.text
                elif t == 'b':
                    val = v.text == '1'
                else:
                    f = float(v.text)
                    val = int(f) if f == int(f) else f
                row.append(val)
            rows.append(row)
        return rows


def read_table(path):
    low = path.lower()
    if low.endswith('.xlsx'):
        rows = read_xlsx(path)
    elif low.endswith(('.csv', '.txt')):
        with open(path, 'rb') as f:
            raw = f.read()
        try:
            rows = parse_csv(raw.decode('utf-8-sig'))
        except UnicodeDecodeError:
            rows = parse_csv(raw.decode('cp1256', 'replace'))
    else:
        raise ValueError('type')
    return [r for r in rows if any(c is not None and str(c).strip() != '' for c in r)]
