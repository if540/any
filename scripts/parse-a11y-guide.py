"""
把「網站無障礙規範」PDF 轉出的文字（pdftotext -layout）整理成技能樹用的 JSON。

用法：
  pdftotext -layout 規範.pdf guide.txt
  python3 scripts/parse-a11y-guide.py guide.txt src/data/a11y-guide.json

支援 110 年 3 月版與 115 年 5 月版的排版（115 年版的標題不空格，例：「成功準則1.1.1：」）。
"""
import json, re, sys

src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')

# 只取「柒、十三指引」到「附件一」之間
# 115 年版的目錄也有一行「柒、十三指引」，取最後一個
start = [i for i, l in enumerate(lines) if re.match(r'^\s*柒、\s*十三指引\s*$', l)][-1]
# 110 年版以「附件一」結束；115 年版之後接「修正附圖一」流程圖
end = next(i for i, l in enumerate(lines)
           if i > start and re.match(r'^\s*(修正)?附(件|圖)一', l))
body = lines[start + 1:end]

# 版本：封面的「中華民國 115年5月」
ver = next((re.sub(r'\s+', '', l) for l in lines[:20] if re.match(r'^\s*中華民國\s*\d+\s*年\s*\d+\s*月', l)), '')
ver_m = re.match(r'中華民國(\d+)年(\d+)月', ver)
SOURCE = f'網站無障礙規範（中華民國 {ver_m.group(1)} 年 {ver_m.group(2)} 月）' if ver_m else '網站無障礙規範'

# 115 年版有標題斷成兩行（例：3.3.4「…(檢測等」＋「級AA)」），先接回一行
merged = []
for l in body:
    if merged and re.match(r'^\s*成功準則\s*\d', merged[-1]) and not re.search(r'等級\s*A{1,3}\)\s*$', merged[-1]):
        merged[-1] = merged[-1].rstrip() + l.strip()
    else:
        merged.append(l)
body = merged

# 原則：取自「陸、檢測原則」
principles = []
for i, l in enumerate(lines[:start]):
    m = re.match(r'^\s*原則\s*(\d)：(.+?)–(.+)$', l)
    if m:
        summary = m.group(3).strip()
        # 摘要斷成兩行時，下一行是很短的續句（例：「式呈現」「並具有相容性」）
        nxt = lines[i + 1].strip()
        if nxt and len(nxt) <= 10:
            summary += nxt
        principles.append({'id': m.group(1), 'name': m.group(2).strip(), 'summary': summary})

G_RE = re.compile(r'^\s*指引\s*(\d\.\d)：(.+)$')
# 原文 2.2.6 寫成「(等級 AAA)」，少了「檢測」兩字，一併容許
S_RE = re.compile(r'^\s*成功準則\s*(\d\.\d\.\d+)：(.+?)\((?:檢測)?等級\s*(A{1,3})\)\s*$')
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
            items.append(re.sub(r'^\s*', '・', t))
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
        # 115 年版保留 4.1.1 編號，內文只有「(因過時而刪除。)」
        if '因過時而刪除' in cur_s['text'] and len(cur_s['text']) < 20:
            cur_s['obsolete'] = True
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
    'source': SOURCE,
    'principles': principles,
    'guidelines': guidelines,
    'criteria': criteria,
}
json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

lv = {}
for c in criteria:
    if not c.get('obsolete'):
        lv[c['level']] = lv.get(c['level'], 0) + 1
obs = [c['id'] for c in criteria if c.get('obsolete')]
print(f"source={SOURCE} principles={len(principles)} guidelines={len(guidelines)} "
      f"criteria={len(criteria)} active={sum(lv.values())} levels={lv} obsolete={obs}")
