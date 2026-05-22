// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Works on My Resume is a fully static, local-first app.
// Deployed to GitHub Pages at https://williamzujkowski.github.io/works-on-my-resume/
// https://astro.build/config
export default defineConfig({
  site: 'https://williamzujkowski.github.io',
  base: '/works-on-my-resume',
  output: 'static',
  integrations: [react()],
  // Resume content never touches a server; no SSR, no adapters, no analytics.
  // The Content Security Policy is a static <meta> tag in BaseLayout.astro.
  // See issue #38 for hardening it to script/style hashes post-MVP.
});
