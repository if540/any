// 無障礙技能樹的互動：顯示方式切換、分頁、詳情面板
// 沒有 JavaScript 時：只顯示四欄版，每個技能是連到個別頁的一般連結。

interface SkillData {
  name: string; level: string; levelLabel: string; guideline: string;
  text: string; stars: number; slug: string;
  articles: { title: string; href: string }[];
}
interface Payload { skills: Record<string, SkillData>; guidelines: Record<string, string>; base: string }

const STORE_KEY = 'any:skill-view';
const LEVEL_KEY = 'any:skill-levels';
const LEVELS = ['A', 'AA', 'AAA'] as const;
const LEVEL_NAME: Record<string, string> = { A: 'A 級', AA: 'AA 級', AAA: 'AAA 級' };
const VIEWS = ['a', 'b', 'c'] as const;
type View = (typeof VIEWS)[number];

const readView = (): View => {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return (VIEWS as readonly string[]).includes(v ?? '') ? (v as View) : 'a';
  } catch { return 'a'; }
};
const saveView = (v: View) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* 私密模式等情況，略過 */ } };

const readLevels = (): Set<string> => {
  try {
    const v = JSON.parse(localStorage.getItem(LEVEL_KEY) ?? 'null');
    if (Array.isArray(v)) return new Set(v.filter((x) => (LEVELS as readonly string[]).includes(x)));
  } catch { /* 略過 */ }
  return new Set(LEVELS);
};
const saveLevels = (s: Set<string>) => { try { localStorage.setItem(LEVEL_KEY, JSON.stringify([...s])); } catch { /* 略過 */ } };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

export function initSkillTree() {
  const raw = document.getElementById('skill-data')?.textContent;
  if (!raw) return;
  const data: Payload = JSON.parse(raw);

  const switcher = document.querySelector<HTMLFieldSetElement>('.view-switch');
  const views = document.querySelectorAll<HTMLElement>('[data-view]');
  const detail = document.querySelector<HTMLElement>('.detail');
  const detailTitle = document.getElementById('detail-title') as HTMLElement;
  const detailBody = document.getElementById('detail-body') as HTMLElement;
  let lastNode: HTMLElement | null = null;
  let current: View = readView();
  let selectedId: string | null = null;

  // ----- 顯示方式 -----
  const apply = (v: View) => {
    current = v;
    views.forEach((n) => { n.hidden = n.dataset.view !== v; });
    switcher?.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = i.value === v; });
    markSelected();
  };
  if (switcher) {
    switcher.hidden = false;
    switcher.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value as View;
      apply(v);
      saveView(v);
    });
  }
  apply(current);

  // ----- 等級篩選：關掉的等級淡化並設為 inert（看得到、但不能操作，也不會被念出） -----
  const filter = document.querySelector<HTMLElement>('.level-filter');
  const levelStatus = document.getElementById('level-status');
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-level-toggle]')];
  const nodes = [...document.querySelectorAll<HTMLElement>('.sk[data-level]')];
  let shown = readLevels();
  const applyLevels = (announce: boolean) => {
    toggles.forEach((b) => b.setAttribute('aria-pressed', String(shown.has(b.dataset.levelToggle!))));
    nodes.forEach((n) => { n.inert = !shown.has(n.dataset.level!); });
    if (!announce || !levelStatus) return;
    const on = LEVELS.filter((l) => shown.has(l));
    const off = LEVELS.filter((l) => !shown.has(l));
    // 每個版面都有一份完整的技能，用其中一個版面計數
    const count = document.querySelectorAll('[data-view="a"] .sk[data-level]:not([inert])').length;
    levelStatus.textContent = on.length === 0
      ? '已淡化全部等級的技能'
      : `目前顯示 ${on.map((l) => LEVEL_NAME[l]).join('、')}技能，共 ${count} 項` + (off.length ? `；${off.map((l) => LEVEL_NAME[l]).join('、')}已淡化` : '');
  };
  if (filter) {
    filter.hidden = false;
    toggles.forEach((b) => b.addEventListener('click', () => {
      const lv = b.dataset.levelToggle!;
      if (shown.has(lv)) shown.delete(lv); else shown.add(lv);
      saveLevels(shown);
      applyLevels(true);
    }));
    applyLevels(false);
  }

  // ----- B：原則分頁（WAI-ARIA tabs，自動啟用） -----
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.view-b [role="tab"]')];
  const selectTab = (t: HTMLButtonElement, focus = false) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(x.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !on;
    });
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      selectTab(tabs[(map[e.key] + tabs.length) % tabs.length], true);
    });
  });

  // ----- 詳情面板 -----
  if (!detail) return;
  detail.hidden = false;

  function markSelected() {
    document.querySelectorAll('.sk.is-selected').forEach((n) => n.classList.remove('is-selected'));
    if (!selectedId) return;
    document.querySelectorAll(`.sk[data-sc="${selectedId}"]`).forEach((n) => n.classList.add('is-selected'));
  }

  const render = (id: string) => {
    const s = data.skills[id];
    const on = s.stars > 0;
    detailTitle.textContent = `${id} ${s.name}`;

    const stars = el('span', { className: 'stars md', ariaHidden: 'true' },
      ...Array.from({ length: 5 }, (_, i) => el('span', { className: `st ${i < s.stars ? 'full' : 'empty'}` }, '★')));

    const list = on
      ? el('ul', {}, ...s.articles.map((a) => el('li', {}, el('a', { href: a.href }, a.title))))
      : el('p', { className: 'd-hint' }, '還沒有文章談到這項準則。');

    const back = el('button', { type: 'button' }, '回到技能樹');
    back.addEventListener('click', () => lastNode?.focus());

    detailBody.replaceChildren(
      el('p', { className: 'd-id' }, `指引 ${s.guideline} ${data.guidelines[s.guideline] ?? ''}`),
      el('p', {},
        el('span', { className: `lv lv-${s.level}`, ariaHidden: 'true' }, s.level), ` ${s.levelLabel}技能　`,
        el('span', { className: `d-status${on ? '' : ' off'}` }, on ? '★ 已解鎖' : '尚未解鎖')),
      on ? el('p', {}, stars, el('span', { className: 'visually-hidden' }, `${s.stars} 顆星`)) : '',
      el('h3', {}, '規範原文'),
      el('p', { className: 'd-text' }, s.text),
      el('h3', {}, `相關文章（${s.articles.length}）`),
      list,
      el('div', { className: 'd-actions' }, el('a', { href: `${data.base}${s.slug}/` }, '完整頁面'), back),
    );
    selectedId = id;
    markSelected();
  };

  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.sk[data-sc]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    lastNode = a;
    render(a.dataset.sc!);
    // 把焦點移到面板標題，螢幕閱讀器會接著念出詳情
    detailTitle.focus({ preventScroll: window.matchMedia('(min-width: 60rem)').matches });
    if (!window.matchMedia('(min-width: 60rem)').matches) detail.scrollIntoView({ block: 'start' });
  });

  // 面板內按 Esc 回到原本的技能
  detail.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lastNode) { e.preventDefault(); lastNode.focus(); }
  });
}
