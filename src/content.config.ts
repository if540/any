import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { AUTHOR_KEYS, DEFAULT_AUTHORS, MOTIF_NAMES } from './consts';
import guide from './data/a11y-guide.json';

// 兩個集合共用的 SEO / GEO 欄位
// 掛名作者：有參與撰寫或編修的人才列入（key 見 src/consts.ts）
const authors = z.array(z.enum(AUTHOR_KEYS)).min(1).default(DEFAULT_AUTHORS);

// 自動封面的選項
const coverTitle = z.string().optional(); // 封面上的標題，可用 \n 指定換行
const coverMotif = z.enum(MOTIF_NAMES).optional();

// 有放封面圖就必須寫替代文字
const requireCoverAlt = (d: { cover?: unknown; coverAlt?: string }) => !d.cover || !!d.coverAlt?.trim();
const coverAltMsg = { message: '有 cover 時必須填寫 coverAlt 替代文字', path: ['coverAlt'] };

// 對應的成功準則編號（例：['4.1.3']），用來點亮無障礙技能樹
const SC_IDS = guide.criteria.map((c) => c.id) as [string, ...string[]];
const wcag = z.array(z.enum(SC_IDS)).default([]);

const faq = z
  .array(z.object({ question: z.string(), answer: z.string() }))
  .optional();

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(70),
      // 必填：meta description 與分享摘要（約 70–150 字）
      description: z.string().min(20).max(160),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      authors,
      tags: z.array(z.string()).default([]),
      wcag,
      cover: image().optional(),
      coverAlt: z.string().optional(),
      ogImage: z.string().optional(), // public/ 下的路徑，蓋過 cover
      coverTitle,
      coverMotif,
      tldr: z.string().optional(), // 顯示在文章開頭的一兩句結論
      faq,
      canonical: z.string().url().optional(), // 只在轉載自其他平台時填
      noindex: z.boolean().default(false),
      toc: z.boolean().optional(), // 目錄：文章預設 3 個以上 h2／h3 才顯示，日誌預設不顯示
      draft: z.boolean().default(false),
    }).refine(requireCoverAlt, coverAltMsg),
});

const journal = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/journal' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(70),
      // 日誌選填：沒填就自動擷取內文開頭
      description: z.string().max(160).optional(),
      date: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      mood: z.string().optional(),
      authors,
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      coverTitle,
      coverMotif,
      tldr: z.string().optional(),
      faq,
      noindex: z.boolean().default(false),
      toc: z.boolean().optional(), // 目錄：文章預設 3 個以上 h2／h3 才顯示，日誌預設不顯示
      draft: z.boolean().default(false),
    }).refine(requireCoverAlt, coverAltMsg),
});

export const collections = { articles, journal };
