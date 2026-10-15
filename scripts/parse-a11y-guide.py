"""
把「網站無障礙規範」PDF 轉出的文字（pdftotext -layout）整理成技能樹用的 JSON。

用法：
  pdftotext -layout 規範.pdf guide.txt
  python3 scripts/parse-a11y-guide.py guide.txt src/data/a11y-guide.json
"""
import json, re, sys

src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')

# 只取「柒、十三指引」到「附件一」之間
start = next(i for i, l in enumerate(lines) if re.match(r'^\s*柒、\s*十三指引\s*$', l))
end = next(i for i, l in enumerate(lines) if i > start and l.strip().startswith('附件一'))
body = lines[start + 1:end]

# 原則：取自「陸、檢測原則」
principles = []
for l in lines[:start]:
    m = re.match(r'^\s*原則 (\d)：(.+?)–(.+)$', l)
    if m:
        principles.append({'id': m.group(1), 'name': m.group(2).strip(), 'summary': m.group(3).strip()})

G_RE = re.compile(r'^\s*指引 (\d\.\d)：(.+)$')
# 原文 2.2.6 寫成「(等級 AAA)」，少了「檢測」兩字，一併容許
S_RE = re.compile(r'^\s*成功準則 (\d\.\d\.\d+)：(.+?)\((?:檢測)?等級 (A{1,3})\)\s*$')
BULLET = re.compile(r'^\s*(|\d+\.(?!\d)|\(\d+\))')

def is_noise(l):
    s = l.replace('\x0c', '').strip()
    # 空行、頁碼、圖說（例：附圖一：…）
    return s == '' or re.fullmatch(r'\d{1,3}', s) is not None or s.startswith('附圖')

def join(raw):
    """CJK 斷行直接相接；條列項目另起一行。"""
    items = []
    for l in raw:
        l = l.replace('\x0c', '')
        if is_noise(l):
            continue
        t = l.strip()
        if BULLET.match(l) or not items:
            items.append(t.replace('', '・'))
        else:
            prev = items[-1]
            sep = ' ' if re.search(r'[A-Za-z0-9]$', prev) and re.match(r'[A-Za-z0-9]', t) else ''
            items[-1] = prev + sep + t
    return '\n'.join(items)

guidelines, criteria = [], []
cur_g = cur_s = None
mode = None  # 'g-title' | 'g-desc' | 's'
buf = []

def flush():
    global buf
    if mode == 's' and cur_s is not None:
        cur_s['text'] = join(buf)
    elif mode == 'g-title' and cur_g is not None:
        cur_g['summary'] = join(buf).replace('\n', '')
    buf = []

for l in body:
    gm, sm = G_RE.match(l), S_RE.match(l)
    if gm:
        flush()
        cur_g = {'id': gm.group(1), 'name': gm.group(2).strip(), 'summary': ''}
        guidelines.append(cur_g); cur_s = None; mode = 'g-title'
        continue
    if sm:
        flush()
        cur_s = {'id': sm.group(1), 'name': sm.group(2).strip(), 'level': sm.group(3),
                 'guideline': cur_g['id'], 'principle': cur_g['id'][0], 'text': ''}
        criteria.append(cur_s); mode = 's'
        continue
    if mode == 'g-title' and l.strip().startswith('說明：'):
        flush(); mode = 'g-desc'
        continue
    if mode in ('g-title', 's'):
        buf.append(l)
flush()

data = {
    'source': '網站無障礙規範（中華民國 110 年 3 月）',
    'principles': principles,
    'guidelines': guidelines,
    'criteria': criteria,
}
json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

lv = {}
for c in criteria:
    lv[c['level']] = lv.get(c['level'], 0) + 1
print(f"principles={len(principles)} guidelines={len(guidelines)} criteria={len(criteria)} levels={lv}")
