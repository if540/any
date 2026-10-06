import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type Journal = CollectionEntry<'journal'>;

// 正式 build 排除草稿；dev 時仍可預覽
const visible = ({ data }: { data: { draft: boolean } }) =>
  import.meta.env.DEV || !data.draft;

export async function getArticles(): Promise<Article[]> {
  const items = await getCollection('articles', visible);
  return items.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getJournal(): Promise<Journal[]> {
  const items = await getCollection('journal', visible);
  return items.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 沒有 description 時，從 Markdown 內文擷取純文字摘要 */
export function excerpt(body = '', max = 120): string {
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const dateFmt = new Intl.DateTimeFormat('zh-Hant-TW', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Taipei',
});

export const formatDate = (d: Date) => dateFmt.format(d);
export const isoDate = (d: Date) => d.toISOString();
