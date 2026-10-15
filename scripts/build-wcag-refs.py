"""
產生技能樹用的 WCAG 對照資料：每項成功準則的英文名稱與 W3C 網址代稱（slug），
以及 WCAG 2.2 在各指引新增的成功準則。

用法：
  git clone --depth 1 --filter=blob:none --sparse https://github.com/w3c/wcag.git wcag
  (cd wcag && git sparse-checkout set guidelines/sc && git checkout)
  python3 scripts/build-wcag-refs.py wcag src/data/a11y-guide.json src/data/wcag-refs.json
"""
import json, re, sys, os

repo, guide_path, out = sys.argv[1:4]
index = open(os.path.join(repo, 'guidelines/index.html'), encoding='utf-8').read()

# 依 index.html 的排列順序推出編號（原則.指引.第幾項）
sc = {}
p = g = n = 0
for m in re.finditer(r'<section class="principle"|<section class="guideline"|data-include="sc/(\d\d)/([a-z0-9-]+)\.html"', index):
    t = m.group(0)
    if 'principle' in t:
        p += 1; g = 0
    elif 'guideline' in t:
        g += 1; n = 0
    else:
        n += 1
        ver, slug = m.group(1), m.group(2)
        html = open(os.path.join(repo, f'guidelines/sc/{ver}/{slug}.html'), encoding='utf-8').read()
        name = re.search(r'<h4>([^<]+)</h4>', html).group(1).strip()
        lv = re.search(r'class="conformance-level">([^<]+)<', html)
        level = lv.group(1).strip() if lv else ''   # 已移除的 4.1.1 沒有等級
        obsolete = 'no longer has utility and is removed' in html
        sc[f'{p}.{g}.{n}'] = {'ver': ver, 'slug': slug, 'en': name, 'level': level, 'obsolete': obsolete}

# WCAG 2.1 與 2.2 代稱不同的項目（2.2 改名）
SLUG21 = {'2.5.5': 'target-size'}
EN21 = {'2.5.5': 'Target Size'}

guide = json.load(open(guide_path, encoding='utf-8'))
ids = [c['id'] for c in guide['criteria']]
refs = {}
for i in ids:
    s = sc[i]
    refs[i] = {
        # 2.1 的名稱：2.2 把 2.5.5 改名、把 4.1.1 標為已移除
        'en': EN21.get(i, re.sub(r'\s*\(Obsolete and removed\)', '', s['en'])),
        'slug21': SLUG21.get(i, s['slug']),
        'slug22': s['slug'],
        'obsolete22': s['obsolete'],
    }

# WCAG 2.2 新增（不在 78 項裡）的成功準則，依指引分組
added = {}
for k, s in sc.items():
    if k in refs:
        continue
    gid = '.'.join(k.split('.')[:2])
    added.setdefault(gid, []).append({'id': k, 'en': s['en'], 'level': s['level'], 'slug': s['slug']})

json.dump({'criteria': refs, 'added22': added}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'criteria={len(refs)} added22={sum(len(v) for v in added.values())}')
