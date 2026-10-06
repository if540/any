// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages（專案站）網址：https://<帳號>.github.io/<repo>/
// 換帳號或改用自訂網域時，只要改這兩行。
const SITE = 'https://if540.github.io';
const BASE = '/any';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  output: 'static',
  integrations: [sitemap()],
});
