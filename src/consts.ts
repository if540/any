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

// 自動封面的幾何符號（src/utils/og.ts）
export const MOTIF_NAMES = ['chain', 'target', 'grid', 'stack', 'code', 'bars'] as const;
export type MotifName = (typeof MOTIF_NAMES)[number];

export const NAV = [
  { href: '/', label: '首頁' },
  { href: '/articles/', label: '文章' },
  { href: '/journal/', label: '日誌' },
  { href: '/security/', label: '資安' },
  { href: '/skills/', label: '技能樹' },
  { href: '/about/', label: '關於' },
];

// 專題單元：文章 frontmatter 的 series 填這裡的 key，就會歸到該單元。
// 每個單元有自己的首頁（href），文章網址維持 /articles/<slug>/ 不變。
export const SERIES = {
  security: {
    title: '資安',
    href: '/security/',
    description: '從前端工程師的角度看資訊安全：token、cookie、連結與瀏覽器的防護機制，每個說法都用實驗驗證。',
  },
} as const;

export type SeriesKey = keyof typeof SERIES;
export const SERIES_KEYS = Object.keys(SERIES) as [SeriesKey, ...SeriesKey[]];
