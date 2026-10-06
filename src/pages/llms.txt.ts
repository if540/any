// llms.txt：給 AI 讀的網站索引（https://llmstxt.org 提案格式）
import type { APIContext } from 'astro';
import { SITE, AUTHOR } from '../consts';
import { getArticles, getJournal, excerpt } from '../utils/content';
import { absoluteUrl } from '../utils/url';

export async function GET(context: APIContext) {
  const [articles, journal] = await Promise.all([getArticles(), getJournal()]);
  const url = (p: string) => absoluteUrl(p, context.site);

  const lines = [
    `# ${SITE.title}`,
    '',
    `> ${SITE.description}`,
    '',
    `作者：${AUTHOR.name}。${AUTHOR.bio}`,
    `全文版本：${url('/llms-full.txt')}`,
    '',
    '## 文章',
    '',
    ...articles.map((p) => `- [${p.data.title}](${url(`/articles/${p.id}/`)}): ${p.data.tldr ?? p.data.description}`),
    '',
    '## 日誌',
    '',
    ...journal.map((j) => `- [${j.data.title}](${url(`/journal/${j.id}/`)}): ${j.data.description ?? excerpt(j.body, 80)}`),
    '',
    '## Optional',
    '',
    `- [關於作者](${url('/about/')})`,
    `- [RSS](${url('/rss.xml')})`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
