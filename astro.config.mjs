// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import { tableRegion } from './src/markdown/table-region.mjs';

// GitHub Pages（專案站）網址：https://<帳號>.github.io/<repo>/
// 換帳號或改用自訂網域時，只要改這兩行。
const SITE = 'https://if540.github.io';
const BASE = '/any';

// github-dark 的註解色 #6A737D 在底色 #24292e 上只有 3.05:1，換成 #959DA5（5.34:1）
const COLOR_FIX = { '#6A737D': '#959DA5' };

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  output: 'static',
  integrations: [sitemap()],
  markdown: {
    processor: satteri({ hastPlugins: [tableRegion()] }),
    shikiConfig: {
      theme: 'github-dark',
      transformers: [{
        name: 'contrast-fix',
        span(node) {
          const style = node.properties.style;
          if (typeof style !== 'string') return;
          node.properties.style = style.replace(/#[0-9A-Fa-f]{6}/g, (c) => COLOR_FIX[c.toUpperCase()] ?? c);
        },
      }],
    },
  },
});
