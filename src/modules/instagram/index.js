/**
 * deslop module: instagram
 * Mounted at /instagram/. Fetches Instagram's web app manifest live and
 * patches it: start_url and scope point at this module, and icon srcs are
 * rewritten to a proxy route on this worker. Everything else (name, colors,
 * icons, display) passes through from upstream untouched. Nothing about
 * Instagram's branding is stored in this repo.
 * See ./README.md for the iOS rules this leans on.
 */

const UPSTREAM_ORIGIN = 'https://www.instagram.com';
const UPSTREAM_MANIFEST_URL = UPSTREAM_ORIGIN + '/data/manifest.json';
const UPSTREAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const UPSTREAM_TIMEOUT_MS = 5000;
const EDGE_CACHE_TTL_SECONDS = 86400;
const DEFAULT_TARGET_URL = 'https://www.instagram.com/direct/inbox/';

export async function handleInstagram(request, env, ctx, base) {
  const { pathname } = new URL(request.url);
  const path = pathname.slice(base.length) || '/';

  if (path === '/') return indexPage(request, env, ctx, base);
  if (path === '/launch') return launchRedirect(env);
  if (path === '/data/manifest.json' || path === '/manifest.webmanifest') {
    return serveManifest(request, env, ctx, base);
  }
  const iconMatch = path.match(/^\/icon\/(\d+x\d+)$/);
  if (iconMatch) return serveIcon(request, env, ctx, base, iconMatch[1]);
  return notFound();
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function badGateway(message) {
  return new Response(message, {
    status: 502,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function upstreamSignal() {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    : undefined;
}

function targetUrl(env) {
  const raw = env.INSTAGRAM_TARGET_URL || DEFAULT_TARGET_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // fall through to default
  }
  return DEFAULT_TARGET_URL;
}

function startUrlFor(env, base) {
  return (env.INSTAGRAM_REDIRECT_MODE || 'server').toLowerCase() === 'client'
    ? `${base}/`
    : `${base}/launch`;
}

function launchRedirect(env) {
  return new Response(null, {
    status: 302,
    headers: { location: targetUrl(env), 'cache-control': 'no-store' },
  });
}

/**
 * Instagram's manifest as a parsed object, fetched live and edge-cached as
 * raw text. Returns null if Instagram is unreachable, blocks the worker, or
 * serves something that is not a JSON manifest. Callers decide how to fail.
 */
async function getUpstreamManifest(request, env, ctx, base) {
  const cacheKey = new Request(new URL(base + '/__manifest-cache__', request.url).toString());
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return JSON.parse(await cached.text());
  } catch {
    // cache read failed, fetch live
  }

  let text = null;
  try {
    const response = await fetch(UPSTREAM_MANIFEST_URL, {
      headers: {
        'user-agent': UPSTREAM_UA,
        accept: 'application/manifest+json, application/json',
      },
      signal: upstreamSignal(),
    });
    if (response.ok) {
      const candidate = await response.text();
      const parsed = JSON.parse(candidate); // throws if Instagram served an HTML login wall
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
        text = candidate;
      }
    }
  } catch {
    text = null;
  }

  if (text === null) return null;

  try {
    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(text, {
          headers: {
            'content-type': 'application/manifest+json',
            'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
          },
        })
      )
    );
  } catch {
    // cache write failed, respond anyway
  }
  return JSON.parse(text);
}

/**
 * Applies the only three patches this module makes: start_url, scope, and
 * icon srcs (rewritten to /icon/<sizes> on this worker so the icon bytes
 * come from Instagram through us, at their URL, never ours). Icons without
 * a usable WxH sizes string are dropped, since the proxy route is keyed by
 * size and only serves sizes the upstream manifest declares.
 */
function patchManifest(manifest, env, base, origin) {
  const patched = { ...manifest };
  patched.start_url = startUrlFor(env, base);
  patched.scope = base + '/';

  const icons = [];
  for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
    if (!icon || typeof icon.src !== 'string') continue;
    if (!/^\d+x\d+$/.test(icon.sizes || '')) continue;
    if (icons.some((i) => i.sizes === icon.sizes)) continue;
    const entry = { src: `${origin}${base}/icon/${icon.sizes}`, sizes: icon.sizes };
    if (typeof icon.type === 'string') entry.type = icon.type;
    if (typeof icon.purpose === 'string') entry.purpose = icon.purpose;
    icons.push(entry);
  }
  if (icons.length > 0) patched.icons = icons;

  return patched;
}

async function serveManifest(request, env, ctx, base) {
  const manifest = await getUpstreamManifest(request, env, ctx, base);
  if (!manifest) return badGateway('Instagram manifest fetch failed');

  const patched = patchManifest(manifest, env, base, new URL(request.url).origin);
  return new Response(JSON.stringify(patched, null, 2), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Proxies one icon declared in the upstream manifest. The size key is
 * resolved against the live manifest, so only sizes Instagram currently
 * declares are fetchable. Bytes are edge-cached.
 */
async function serveIcon(request, env, ctx, base, sizes) {
  const manifest = await getUpstreamManifest(request, env, ctx, base);
  if (!manifest) return badGateway('Instagram manifest fetch failed');

  const icon = (Array.isArray(manifest.icons) ? manifest.icons : []).find(
    (i) => i && i.sizes === sizes && typeof i.src === 'string'
  );
  if (!icon) return notFound();

  const upstreamSrc = new URL(icon.src, UPSTREAM_ORIGIN + '/').toString();
  const cacheKey = new Request(
    new URL(`${base}/__icon-cache__/${encodeURIComponent(upstreamSrc)}`, request.url).toString()
  );
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // cache read failed, fetch live
  }

  try {
    const response = await fetch(upstreamSrc, {
      headers: { 'user-agent': UPSTREAM_UA },
      signal: upstreamSignal(),
    });
    if (!response.ok) return badGateway('Instagram icon fetch failed');

    const proxied = new Response(await response.arrayBuffer(), {
      headers: {
        'content-type': response.headers.get('content-type') || icon.type || 'image/webp',
        'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
      },
    });
    try {
      ctx.waitUntil(cache.put(cacheKey, proxied.clone()));
    } catch {
      // cache write failed, respond anyway
    }
    return proxied;
  } catch {
    return badGateway('Instagram icon fetch failed');
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function iconSizeNum(sizes) {
  return Number(/^(\d+)x/.exec(sizes)?.[1] || 0);
}

async function indexPage(request, env, ctx, base) {
  const manifest = await getUpstreamManifest(request, env, ctx, base);
  if (!manifest) return badGateway('Instagram manifest fetch failed');

  const origin = new URL(request.url).origin;
  const patched = patchManifest(manifest, env, base, origin);

  // Everything visible on this page comes from the upstream manifest.
  const appName = manifest.short_name || manifest.name || 'Instagram';
  const themeColor = typeof manifest.theme_color === 'string' ? manifest.theme_color : null;
  const iconLinks = patched.icons
    .map(
      (icon) => `<link rel="apple-touch-icon" sizes="${icon.sizes}" href="${icon.src}">`
    )
    .join('\n');
  const largest = patched.icons
    .slice()
    .sort((a, b) => iconSizeNum(b.sizes) - iconSizeNum(a.sizes))[0];
  const previewImg = largest
    ? `<img class="icon" src="${largest.src}" alt="${escapeHtml(appName)}">`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(appName)} DMs</title>
<link rel="manifest" href="${base}/data/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(appName)}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
${themeColor ? `<meta name="theme-color" content="${escapeHtml(themeColor)}">\n` : ''}${iconLinks}
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fafafa; color: #111;
    display: flex; min-height: 100vh; align-items: center; justify-content: center;
    padding: 24px;
  }
  main { max-width: 420px; text-align: center; }
  img.icon { width: 96px; height: 96px; border-radius: 22px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p.sub { color: #666; font-size: 15px; line-height: 1.45; margin-bottom: 20px; }
  ol {
    text-align: left; background: #fff; border: 1px solid #e5e5e5; border-radius: 14px;
    padding: 16px 16px 16px 40px; display: grid; gap: 10px; font-size: 15px; line-height: 1.4;
  }
  p.foot { margin-top: 16px; color: #888; font-size: 12px; line-height: 1.5; }
  #launching { display: none; font-size: 17px; }
  body.launching ol, body.launching p.sub, body.launching p.foot { display: none; }
  body.launching #launching { display: block; }
  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #f2f2f2; }
    ol { background: #1c1c1e; border-color: #2c2c2e; }
    p.sub { color: #aaa; }
    p.foot { color: #777; }
  }
</style>
</head>
<body>
<main>
  ${previewImg}
  <h1>${escapeHtml(appName)}, straight to messages</h1>
  <p class="sub">Add this page to your Home Screen. You get the real ${escapeHtml(appName)} icon and name, but tapping it opens your DMs, not the feed.</p>
  <ol>
    <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
    <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
    <li>iOS 26 and later: leave <strong>Open as Web App</strong> enabled. Then tap <strong>Add</strong>.</li>
  </ol>
  <p class="foot">Launch it once from the Home Screen after adding. If ${escapeHtml(appName)} asks you to log in again, that is normal: Home Screen web apps keep their own cookies, separate from Safari (iOS 16.4 and later).</p>
  <p id="launching">Opening messages&hellip;</p>
</main>
<script>
  var TARGET = ${JSON.stringify(targetUrl(env))};
  (function () {
    var standalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!standalone) return;
    document.body.classList.add('launching');
    window.location.replace(TARGET);
  })();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
