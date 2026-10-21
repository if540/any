// 文章內頁的互動：目錄展開狀態、目前段落標示、標題旁的段落連結
// 都是加強功能，沒有 JavaScript 時目錄照樣可以點。

const WIDE = '(min-width: 64rem)';

function initToc() {
  const nav = document.querySelector<HTMLElement>('[data-toc]');
  if (!nav) return;
  const details = nav.querySelector('details');
  const wide = matchMedia(WIDE);
  // 桌機永遠展開；切回手機寬度時收合
  wide.addEventListener('change', (e) => { if (details) details.open = e.matches; });

  const pairs = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
    .map((a) => ({ a, el: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
    .filter((p): p is { a: HTMLAnchorElement; el: HTMLElement } => p.el !== null);
  if (!pairs.length) return;

  let active: HTMLAnchorElement | null = null;
  let queued = false;

  const update = () => {
    queued = false;
    // 標題捲過視窗上方 25% 這條線，就算讀到這一段
    const line = window.innerHeight * 0.25;
    let current: (typeof pairs)[number] | null = null;
    for (const p of pairs) {
      if (p.el.getBoundingClientRect().top <= line) current = p;
      else break;
    }
    // 捲到底時，最後幾段可能永遠碰不到那條線
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = pairs[pairs.length - 1];

    const next = current?.a ?? null;
    if (next === active) return;
    active?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'true');
    active = next;

    // 側欄目錄太長時，讓目前項目保持在可見範圍（只捲目錄本身，不動頁面）
    if (next && wide.matches && nav.scrollHeight > nav.clientHeight) {
      const top = next.offsetTop;
      if (top < nav.scrollTop + 24 || top > nav.scrollTop + nav.clientHeight - 48) {
        nav.scrollTop = top - nav.clientHeight / 3;
      }
    }
  };

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}

function initHeadingLinks() {
  const status = document.getElementById('copy-status');
  let timer = 0;
  const say = (msg: string) => {
    if (!status) return;
    clearTimeout(timer);
    // 先清空再填入，同一句話連按兩次也會再念一次
    status.textContent = '';
    requestAnimationFrame(() => { status.textContent = msg; });
    timer = window.setTimeout(() => { status.textContent = ''; }, 2500);
  };

  document.querySelectorAll<HTMLElement>('.post .prose :is(h2, h3)[id]').forEach((h) => {
    const text = h.textContent?.trim() ?? '';
    // 連結放在標題外面，標題的名稱維持乾淨，標題清單不會多念「#」
    const wrap = document.createElement('div');
    wrap.className = `h-wrap h-wrap-${h.tagName.toLowerCase()}`;
    h.before(wrap);
    wrap.append(h);

    const a = document.createElement('a');
    a.className = 'h-anchor';
    a.href = `#${encodeURIComponent(h.id)}`;
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '#';
    const label = document.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = `複製「${text}」的段落連結`;
    a.append(mark, label);
    wrap.append(a);

    a.addEventListener('click', async () => {
      // 不擋預設行為：網址列會變成這一段的網址，並捲到該段
      const url = `${location.origin}${location.pathname}${a.getAttribute('href')}`;
      try {
        await navigator.clipboard.writeText(url);
        say(`已複製「${text}」的段落連結`);
      } catch {
        say('無法自動複製，網址列已經是這一段的連結');
      }
    });
  });
}

export function initPost() {
  initHeadingLinks();
  initToc();
}
