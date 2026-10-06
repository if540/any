// robots.txt：允許一般搜尋引擎與 AI 爬蟲，並指向 sitemap。
// 注意：GitHub Pages 專案站的 robots.txt 位於 /any/robots.txt，
// 爬蟲只讀網域根目錄的 robots.txt，詳見 README「GitHub Pages 的限制」。
import type { APIContext } from 'astro';
import { absoluteUrl } from '../utils/url';

// 想阻擋某個 AI 爬蟲，把它從這裡移到 BLOCKED
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];
const BLOCKED: string[] = [];

export function GET(context: APIContext) {
  const lines = [
    'User-agent: *',
    'Allow: /',
    '',
    ...AI_CRAWLERS.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
    ...BLOCKED.flatMap((ua) => [`User-agent: ${ua}`, 'Disallow: /', '']),
    `Sitemap: ${absoluteUrl('/sitemap-index.xml', context.site)}`,
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
