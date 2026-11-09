// 文章列表的分頁與標籤路由：全部是 build 時產生的靜態頁面
//   /articles/                       全部，第 1 頁
//   /articles/page/2/                全部，第 2 頁
//   /articles/tags/next-js/          標籤，第 1 頁
//   /articles/tags/next-js/page/2/   標籤，第 2 頁
import type { Article } from './content';

export const PAGE_SIZE = 10;

/** 標籤 → 網址片段：小寫、空白與「.」換成「-」，中文保留（例：Next.js → next-js、Rocky Linux → rocky-linux） */
export function tagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s.\/\\?#%]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface TagInfo { name: string; slug: string; count: number }

/** 依文章數多到少、再依名稱排序；兩個標籤算出同一個網址片段時直接讓 build 失敗 */
export function collectTags(articles: Article[]): TagInfo[] {
  const map = new Map<string, TagInfo>();
  for (const a of articles) {
    for (const name of a.data.tags) {
      const slug = tagSlug(name);
      const hit = map.get(slug);
      if (hit && hit.name !== name) {
        throw new Error(`標籤「${hit.name}」和「${name}」的網址都是 /articles/tags/${slug}/，請改用一致的寫法`);
      }
      map.set(slug, { name, slug, count: (hit?.count ?? 0) + 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
}

export const listPath = (tag?: string, page = 1) => {
  const base = tag ? `/articles/tags/${tag}/` : '/articles/';
  return page > 1 ? `${base}page/${page}/` : base;
};

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function slicePage<T>(items: T[], page: number) {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}
