# deslop

One Cloudflare Worker, many small fixes for apps that got worse. Each fix is
a module mounted at its own subpath, for example `/instagram/`.

| Module | What it fixes |
| --- | --- |
| [instagram](./src/modules/instagram/) | The Instagram Home Screen icon always opens the feed. This one opens your DMs. |

## Deploy

The worker builds from this repo through Cloudflare Workers Builds. Push to
the connected branch and Cloudflare deploys the root `wrangler.toml`.

To run the same thing locally:

```
npm install
npm run dev
```

## Repo layout

```
wrangler.toml            worker config and module vars
src/index.js             router: mounts each module at its subpath
src/modules/<name>/      one module: handler, README, assets
```

A module exports an async `handle(request, env, ctx, base)` function, where
`base` is its mount path (for example `/instagram`). Register it in the
`MODULES` list in `src/index.js`. Configure it with `NAME_*` vars in
`wrangler.toml`. Its README documents routes and setup.

## How iOS "Add to Home Screen" picks its URL

The rules below are what the modules in this repo lean on. They come from the
W3C manifest spec, WebKit's implementation, and Apple's documentation.

1. When you tap **Add to Home Screen**, Safari fetches the manifest linked
   from the page (`<link rel="manifest">`). If the manifest has a `start_url`
   member, that URL becomes what the icon opens. If there is no manifest or
   no `start_url`, Safari saves the URL of the page you were viewing.
2. `start_url` is resolved against the manifest's own URL, so a relative
   value like `/instagram/launch` stays on the origin that served the
   manifest.
3. `start_url` must be same-origin with the page being installed. If it is
   not, the browser ignores it and falls back to the page URL. This is why a
   shortcut served from your own domain cannot declare
   `"start_url": "https://www.instagram.com/direct/inbox/"`; the working
   shape is a launcher page on your domain that redirects after launch.
4. `scope` is a single same-origin path prefix, never a list. Navigations
   that leave the scope (for example, a redirect to instagram.com) open in a
   Safari sheet with a Done button, or stay in the window depending on how
   the navigation started. There is no way to declare two origins in scope.
5. iOS reads the manifest at install time. Changing the manifest later does
   nothing for an icon that is already on the Home Screen. Remove and
   re-add the icon to pick up the change.
6. Icons come from the manifest `icons` list (iOS 15.4 and later), but
   `apple-touch-icon` links in the HTML head override them when present.
7. Since iOS 16.4, a Home Screen web app keeps its own cookies and storage,
   separate from Safari. Since iOS 26, every added site opens as a web app
   by default, with an "Open as Web App" toggle at install time.

Sources:

- [W3C Web Application Manifest spec](https://www.w3.org/TR/appmanifest/),
  processing rules for `start_url` and `scope`
- [MDN: start_url](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url)
- [Maximiliano Firtman, iOS PWA compatibility notes](https://firt.dev/notes/pwa-ios/)
- [WWDC23, What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/)
- [WebKit blog, Safari 26.0: every site can be a web app](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
