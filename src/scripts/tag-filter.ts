// 文章列表的標籤篩選：切換按鈕的 aria-pressed、隱藏不符的卡片、重新編號，
// 並把選取的標籤寫進網址（?tag=），方便分享與從文章內頁的標籤連過來
export function initTagFilter() {
  const bar = document.getElementById('tag-filter');
  if (!bar) return;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button[data-tag]')];
  const cards = [...document.querySelectorAll<HTMLElement>('.list [data-tags]')];
  const count = document.getElementById('article-count');
  const status = document.getElementById('filter-status');
  const more = bar.querySelector('details');
  const valid = new Set(buttons.map((b) => b.dataset.tag ?? ''));
  const total = cards.length;

  function apply(tag: string, announce: boolean) {
    if (!valid.has(tag)) tag = '';
    let shown = 0;
    for (const card of cards) {
      const tags: string[] = JSON.parse(card.dataset.tags ?? '[]');
      const match = !tag || tags.includes(tag);
      card.hidden = !match;
      if (match) {
        shown += 1;
        const idx = card.querySelector('.idx');
        if (idx) idx.textContent = String(shown).padStart(2, '0');
      }
    }
    for (const b of buttons) b.setAttribute('aria-pressed', String((b.dataset.tag ?? '') === tag));
    // 選到收合區裡的標籤時展開，讓使用者看得到目前的選取
    if (more && tag && [...more.querySelectorAll<HTMLButtonElement>('button')].some((b) => b.dataset.tag === tag)) {
      more.open = true;
    }
    if (count) count.textContent = tag ? `「${tag}」共 ${shown} 篇，全部 ${total} 篇。` : `共 ${total} 篇。`;
    if (announce && status) status.textContent = tag ? `已篩選「${tag}」，顯示 ${shown} 篇文章` : `顯示全部 ${total} 篇文章`;

    const url = new URL(location.href);
    if (tag) url.searchParams.set('tag', tag);
    else url.searchParams.delete('tag');
    history.replaceState(null, '', url);
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const tag = b.dataset.tag ?? '';
      // 再按一次已選取的標籤，等於取消篩選
      apply(b.getAttribute('aria-pressed') === 'true' && tag ? '' : tag, true);
    });
  }

  bar.hidden = false;
  apply(new URLSearchParams(location.search).get('tag') ?? '', false);
}
