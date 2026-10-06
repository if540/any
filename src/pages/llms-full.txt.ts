// llms-full.txt：全站文章與日誌的 Markdown 全文，方便 AI 一次讀完
import type { APIContext } from 'astro';
import { SITE } from '../consts';
import { getArticles, getJournal } from '../utils/content';
import { absoluteUrl } from '../utils/url';

export async function GET(context: APIContext) {
  const [articles, journal] = await Promise.all([getArticles(), getJournal()]);
  const url = (p: string) => absoluteUrl(p, context.site);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const blocks = [
    `# ${SITE.title}\n\n> ${SITE.description}`,
    ...articles.map((p) =>
      [
        `## ${p.data.title}`,
        `來源：${url(`/articles/${p.id}/`)}｜發布：${iso(p.data.pubDate)}${p.data.updatedDate ? `｜更新：${iso(p.data.updatedDate)}` : ''}`,
        p.data.tldr ? `重點：${p.data.tldr}` : '',
        p.body ?? '',
      ].filter(Boolean).join('\n\n'),
    ),
    ...journal.map((j) =>
      [
        `## ${j.data.title}（日誌）`,
        `來源：${url(`/journal/${j.id}/`)}｜日期：${iso(j.data.date)}`,
        j.body ?? '',
      ].join('\n\n'),
    ),
  ];

  return new Response(blocks.join('\n\n---\n\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
