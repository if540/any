/**
 * Claude Skills 專題：Skills 撰寫指南的單頁應用（SPA）行為。
 * - 以網址 hash（#load、#fields…）切換章節，上一頁／下一頁可用，網址可分享
 * - 切換後焦點移到章節標題，並用 role="status" 念出目前章節
 * - 欄位表的使用環境切換、範例分頁、複製按鈕、檢查清單（記在瀏覽器）
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
