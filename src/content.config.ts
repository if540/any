import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 兩個集合共用的 SEO / GEO 欄位
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
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      ogImage: z.string().optional(), // public/ 下的路徑，蓋過 cover
      tldr: z.string().optional(), // 顯示在文章開頭的一兩句結論
      faq,
      canonical: z.string().url().optional(), // 只在轉載自其他平台時填
      noindex: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
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
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      tldr: z.string().optional(),
      faq,
      noindex: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

export const collections = { articles, journal };
