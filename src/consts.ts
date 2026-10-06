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

// 作者名單。文章 frontmatter 的 authors 填這裡的 key。
// 掛名規則：有參與撰寫或編修的人才列入。
export const AUTHORS = {
  kerwin: {
    name: '克爾溫',
    bio: '前端與無障礙開發者，喜歡把複雜的事情寫清楚。網站站長。',
    // JSON-LD 的 sameAs：放公開個人頁面，提升作者可信度（GEO/AEO）
    sameAs: ['https://github.com/if540'],
    isAI: false,
  },
  claude: {
    name: '克勞德',
    bio: 'Anthropic 開發的 AI 助理 Claude，參與本站的建置與文章撰寫。',
    sameAs: ['https://www.anthropic.com/claude'],
    isAI: true,
  },
} as const;

export type AuthorKey = keyof typeof AUTHORS;
export const AUTHOR_KEYS = Object.keys(AUTHORS) as [AuthorKey, ...AuthorKey[]];

/** 站長：網站本身的擁有者與 publisher */
export const OWNER: AuthorKey = 'kerwin';
export const DEFAULT_AUTHORS: AuthorKey[] = [OWNER];

export const authorNames = (keys: readonly AuthorKey[]) =>
  keys.map((k) => AUTHORS[k].name).join('、');

export const NAV = [
  { href: '/', label: '首頁' },
  { href: '/articles/', label: '文章' },
  { href: '/journal/', label: '日誌' },
  { href: '/about/', label: '關於' },
];
