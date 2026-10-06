import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../consts';
import { getArticles, getJournal, excerpt } from '../utils/content';
import { absoluteUrl } from '../utils/url';

export async function GET(context: APIContext) {
  const [articles, journal] = await Promise.all([getArticles(), getJournal()]);
  const items = [
    ...articles.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      categories: ['文章', ...p.data.tags],
      link: absoluteUrl(`/articles/${p.id}/`, context.site),
    })),
    ...journal.map((j) => ({
      title: j.data.title,
      description: j.data.description ?? excerpt(j.body, 140),
      pubDate: j.data.date,
      categories: ['日誌', ...j.data.tags],
      link: absoluteUrl(`/journal/${j.id}/`, context.site),
    })),
  ].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: absoluteUrl('/', context.site),
    items,
    customData: `<language>${SITE.lang}</language>`,
  });
}
