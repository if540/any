/**
 * Claude Skills 專題：Skills 撰寫指南的單頁應用（SPA）行為。
 * - 以網址 hash（#load、#fields…）切換章節，上一頁／下一頁可用，網址可分享
 * - 切換後焦點移到章節標題，並用 role="status" 念出目前章節
 * - 欄位表的使用環境切換、範例分頁、複製按鈕、檢查清單（記在瀏覽器）
 * - Frontmatter 欄位快搜：Ctrl+F（Mac 為 ⌘F）聚焦，捲過 hero 後固定在視窗頂端
 * 沒有 JavaScript 時，所有章節依序顯示，錨點照常可用。
 */
const STORE_KEY = 'any:claude-skills:checklist';

export function initClaudeSkills(root: HTMLElement) {
  const status = root.querySelector<HTMLElement>('[data-cs-status]');
  const announce = (text: string) => {
    if (!status) return;
    status.textContent = '';
    window.setTimeout(() => { status.textContent = text; }, 50);
  };

  initRouter(root, announce);
  initFieldSearch(root, announce);
  initFieldMode(root, announce);
  initTabs(root);
  initCopy(root, announce);
  initChecklist(root);
}

function initRouter(root: HTMLElement, announce: (t: string) => void) {
  const views = [...root.querySelectorAll<HTMLElement>('[data-cs-view]')];
  const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-cs-link]')];
  const layout = root.querySelector<HTMLElement>('[data-cs-layout]');
  if (views.length === 0) return;

  const baseTitle = document.title;
  const ids = new Set(views.map((v) => v.id));
  root.classList.add('is-spa');

  const show = (id: string, opts: { focus: boolean }) => {
    const view = views.find((v) => v.id === id) ?? views[0];
    views.forEach((v) => { v.hidden = v !== view; });
    links.forEach((a) => {
      if (a.dataset.csLink === view.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const heading = view.querySelector<HTMLElement>('h2');
    const title = heading?.textContent?.trim() ?? '';
    document.title = `${title}｜${baseTitle}`;
    if (opts.focus) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      layout?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      heading?.focus({ preventScroll: true });
      announce(`已切換到：${title}`);
    }
  };

  const current = () => decodeURIComponent(location.hash.slice(1));

  // 首次載入：網址有章節 hash 才捲到該章；沒有就停在頁首、顯示第一章
  const first = current();
  show(ids.has(first) ? first : views[0].id, { focus: ids.has(first) });

  window.addEventListener('hashchange', () => {
    const id = current();
    if (ids.has(id)) show(id, { focus: true });
  });
}

function initFieldMode(root: HTMLElement, announce: (t: string) => void) {
  const box = root.querySelector<HTMLElement>('[data-cs-mode]');
  const table = root.querySelector<HTMLElement>('[data-cs-fields]');
  if (!box || !table) return;
  box.hidden = false;
  const buttons = [...box.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const portable = btn.dataset.mode === 'portable';
      table.classList.toggle('is-portable', portable);
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      announce(portable
        ? '已切換到上傳 claude.ai／Skills API：只能用 name、description、license、compatibility、metadata、allowed-tools。'
        : '已切換到 Claude Code：表中所有欄位都可以用。');
    });
  });
}

function initTabs(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>('[data-cs-tablist]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''));
  list.hidden = false;
  panels.forEach((p) => {
    if (!p) return;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', p.id.replace('panel-', 'tab-'));
    p.tabIndex = 0;
    p.classList.add('is-tab');
  });

  const select = (i: number, focus = false) => {
    tabs.forEach((t, j) => {
      const on = i === j;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (panels[j]) panels[j]!.hidden = !on;
    });
    if (focus) tabs[i].focus();
  };

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const keys: Record<string, number> = {
        ArrowRight: (i + 1) % tabs.length,
        ArrowLeft: (i - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      if (e.key in keys) { e.preventDefault(); select(keys[e.key], true); }
    });
  });
  select(0);
}

function initCopy(root: HTMLElement, announce: (t: string) => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-cs-copy]').forEach((btn) => {
    btn.hidden = false;
    const label = btn.firstChild?.textContent ?? '複製';
    btn.addEventListener('click', async () => {
      const code = btn.closest('figure')?.querySelector('pre');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        announce('已複製到剪貼簿');
        if (btn.firstChild) btn.firstChild.textContent = '已複製';
      } catch {
        // 剪貼簿不可用時改成選取文字，讓使用者自己複製
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        announce('無法存取剪貼簿，已選取程式碼，請按複製快捷鍵');
        if (btn.firstChild) btn.firstChild.textContent = '已選取';
      }
      window.setTimeout(() => { if (btn.firstChild) btn.firstChild.textContent = label; }, 1800);
    });
  });
}

function initChecklist(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>('[data-cs-checklist]');
  const progress = root.querySelector<HTMLElement>('[data-cs-progress]');
  if (!list) return;
  const boxes = [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    if (Array.isArray(saved)) boxes.forEach((b, i) => { b.checked = saved[i] === true; });
  } catch { /* 無法讀取瀏覽器儲存空間時，從全部未勾選開始 */ }

  const update = () => {
    const done = boxes.filter((b) => b.checked).length;
    if (progress) progress.textContent = `${done} / ${boxes.length}`;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(boxes.map((b) => b.checked))); } catch { /* 忽略 */ }
  };
  boxes.forEach((b) => b.addEventListener('change', update));
  update();
}

interface FieldEntry { id: string; names: string[]; group: string; use: string; note: string; cc: boolean }

function initFieldSearch(root: HTMLElement, announce: (t: string) => void) {
  const slot = root.querySelector<HTMLElement>('[data-cs-search-slot]');
  const bar = root.querySelector<HTMLElement>('[data-cs-search]');
  const input = root.querySelector<HTMLInputElement>('[data-cs-search-input]');
  const list = root.querySelector<HTMLUListElement>('[data-cs-search-list]');
  const kbd = root.querySelector<HTMLElement>('[data-cs-search-kbd]');
  const dataEl = root.querySelector<HTMLScriptElement>('[data-cs-search-data]');
  if (!slot || !bar || !input || !list || !dataEl) return;

  let entries: FieldEntry[] = [];
  try { entries = JSON.parse(dataEl.textContent ?? '[]'); } catch { return; }
  slot.hidden = false;

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (kbd) kbd.textContent = isMac ? '⌘ F' : 'Ctrl F';
  const hint = document.getElementById('cs-search-hint');
  if (hint && isMac) hint.textContent = hint.textContent!.replace('Ctrl+F', 'Command+F');

  // ---- 搜尋與結果清單（combobox + listbox） ----
  let results: FieldEntry[] = [];
  let active = -1;

  const score = (e: FieldEntry, q: string) => {
    if (!q) return 1;
    const names = e.names.join(' ').toLowerCase();
    if (e.names.some((n) => n.toLowerCase() === q)) return 100;
    if (e.names.some((n) => n.toLowerCase().startsWith(q))) return 50;
    if (names.includes(q)) return 30;
    if (`${e.use} ${e.note} ${e.group}`.toLowerCase().includes(q)) return 10;
    return 0;
  };

  const mark = (text: string, q: string) => {
    const frag = document.createDocumentFragment();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { frag.append(text); return frag; }
    const m = document.createElement('mark');
    m.textContent = text.slice(i, i + q.length);
    frag.append(text.slice(0, i), m, text.slice(i + q.length));
    return frag;
  };

  const setActive = (i: number) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    const li = list.children[i] as HTMLElement | undefined;
    if (li) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };

  const open = (show: boolean) => {
    list.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
    if (!show) setActive(-1);
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    results = entries
      .map((e) => ({ e, s: score(e, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.e);
    list.replaceChildren();
    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'cs-search-empty';
      li.textContent = `找不到「${input.value.trim()}」相關的欄位`;
      li.setAttribute('role', 'presentation');
      list.append(li);
    }
    results.forEach((e, i) => {
      const li = document.createElement('li');
      li.id = `cs-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.className = 'cs-opt-name';
      e.names.forEach((n, k) => {
        if (k) name.append('、');
        const c = document.createElement('code');
        c.append(mark(n, q));
        name.append(c);
      });
      if (e.cc) {
        const tag = document.createElement('span');
        tag.className = 'cs-cc';
        tag.textContent = '僅 Claude Code';
        name.append(' ', tag);
      }
      const desc = document.createElement('span');
      desc.className = 'cs-opt-desc';
      desc.append(mark(e.use, q));
      const grp = document.createElement('span');
      grp.className = 'cs-opt-group';
      grp.textContent = e.group;
      li.append(name, grp, desc);
      li.addEventListener('mousedown', (ev) => ev.preventDefault()); // 保留輸入框焦點
      li.addEventListener('click', () => choose(i));
      list.append(li);
    });
    open(true);
    if (results.length) setActive(0);
    if (input.value.trim()) announce(results.length ? `找到 ${results.length} 個欄位` : '找不到符合的欄位');
  };

  const choose = (i: number) => {
    const e = results[i];
    if (!e) return;
    open(false);
    input.blur();
    if (location.hash !== '#fields') location.hash = 'fields';
    window.setTimeout(() => {
      const row = document.getElementById(e.id);
      if (!row) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      row.classList.remove('is-hit');
      void row.offsetWidth;
      row.classList.add('is-hit');
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
      announce(`已跳到欄位 ${e.names.join('、')}：${e.use}`);
    }, 120);
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => window.setTimeout(() => open(false), 100));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (list.hidden) { render(); return; }
      if (!results.length) return;
      const d = ev.key === 'ArrowDown' ? 1 : -1;
      setActive((active + d + results.length) % results.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (active >= 0) choose(active);
    } else if (ev.key === 'Escape') {
      if (!list.hidden) { ev.preventDefault(); open(false); }
      else if (input.value) { ev.preventDefault(); input.value = ''; }
      else input.blur();
    }
  });

  // ---- 快速鍵：Ctrl+F／⌘F 聚焦快搜；已經在快搜裡再按一次，交還給瀏覽器原生的尋找 ----
  document.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() !== 'f' || ev.altKey || ev.shiftKey) return;
    if (!(isMac ? ev.metaKey : ev.ctrlKey)) return;
    if (document.activeElement === input) return;
    ev.preventDefault();
    input.focus();
    input.select();
  });

  // ---- 捲過 hero 後固定在視窗頂端、滿寬 ----
  let stuck = false;
  const update = () => {
    const shouldStick = slot.getBoundingClientRect().top < 0;
    if (shouldStick === stuck) return;
    stuck = shouldStick;
    if (stuck) slot.style.height = `${bar.offsetHeight}px`;
    else slot.style.height = '';
    bar.classList.toggle('is-stuck', stuck);
    root.style.setProperty('--cs-stuck-h', stuck ? `${bar.offsetHeight}px` : '0px');
  };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  }, { passive: true });
  window.addEventListener('resize', () => { if (stuck) root.style.setProperty('--cs-stuck-h', `${bar.offsetHeight}px`); });
  update();
}
