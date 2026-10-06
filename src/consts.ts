// 全站設定：網站名稱、作者、預設 SEO 文字都集中在這裡。
export const SITE = {
  title: 'any',
  tagline: '關於任何事的文章與日誌',
  description: '一個以文章與日誌為主的個人網站，紀錄技術筆記、想法與日常。',
  lang: 'zh-Hant-TW',
  locale: 'zh_TW',
  defaultOgImage: '/og-default.png',
  defaultOgImageAlt: 'any — 橘色圓點與黑色文字的網站標誌',
};

export const AUTHOR = {
  name: 'if540',
  bio: '前端與無障礙開發者，喜歡把複雜的事情寫清楚。',
  // JSON-LD 的 sameAs：放你的公開個人頁面，提升作者可信度（GEO/AEO）
  sameAs: ['https://github.com/if540'],
};

export const NAV = [
  { href: '/', label: '首頁' },
  { href: '/articles/', label: '文章' },
  { href: '/journal/', label: '日誌' },
  { href: '/about/', label: '關於' },
];
