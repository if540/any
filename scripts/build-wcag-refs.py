"""
產生技能樹用的 WCAG 對照資料：每項成功準則的英文名稱、W3C 網址代稱（slug），
以及是不是 WCAG 2.2 才新增的準則。

網站無障礙規範（115 年 5 月版）以 WCAG 2.2 為基礎，所以對照以 WCAG 2.2 為主。

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

guide = json.load(open(guide_path, encoding='utf-8'))
refs, mismatch = {}, []
for c in guide['criteria']:
    s = sc[c['id']]
    refs[c['id']] = {
        'en': re.sub(r'\s*\(Obsolete and removed\)', '', s['en']),
        'slug': s['slug'],
        'new22': s['ver'] == '22',      # WCAG 2.2 新增
        'obsolete': s['obsolete'],
    }
    if not s['obsolete'] and s['level'] != c['level']:
        mismatch.append(f"{c['id']} 規範 {c['level']} / WCAG {s['level']}")

missing = [k for k in sc if k not in refs]
json.dump({'criteria': refs}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'criteria={len(refs)} new22={sum(r["new22"] for r in refs.values())} '
      f'not-in-guide={missing} level-mismatch={mismatch}')
