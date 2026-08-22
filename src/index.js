/**
 * deslop: one worker, many small fixes for apps that got worse.
 * Each module is mounted at its own subpath (for example /instagram/).
 */

import { handleInstagram } from './modules/instagram/index.js';

const MODULES = [
  {
    prefix: 'instagram',
    title: 'Instagram DMs',
    description:
      'Home Screen icon that looks like the real Instagram app but opens instagram.com/direct/inbox/ instead of the feed.',
    handle: handleInstagram,
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/') return indexPage();

    const segment = url.pathname.split('/')[1];
    const mod = MODULES.find((m) => m.prefix === segment);
    if (!mod) return notFound();

    const base = '/' + mod.prefix;
    if (url.pathname === base) {
      return new Response(null, { status: 301, headers: { location: base + '/' } });
    }
    return mod.handle(request, env, ctx, base);
  },
};

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function indexPage() {
  const items = MODULES.map(
    (m) =>
      `<li><a href="/${m.prefix}/"><strong>${m.title}</strong></a><br><span>${m.description}</span></li>`
  ).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>deslop</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fafafa; color: #111;
    display: flex; min-height: 100vh; align-items: center; justify-content: center;
    padding: 24px;
  }
  main { max-width: 460px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #666; font-size: 14px; margin-bottom: 20px; }
  ul { list-style: none; display: grid; gap: 12px; }
  li {
    background: #fff; border: 1px solid #e5e5e5; border-radius: 14px; padding: 14px 16px;
    font-size: 14px; line-height: 1.45;
  }
  li a { color: #007aff; text-decoration: none; font-size: 16px; }
  li span { color: #666; }
  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #f2f2f2; }
    li { background: #1c1c1e; border-color: #2c2c2e; }
    li span, p.sub { color: #aaa; }
  }
</style>
</head>
<body>
<main>
  <h1>deslop</h1>
  <p class="sub">Small fixes for apps that got worse. Open a module on your phone to install it.</p>
  <ul>
${items}
  </ul>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
