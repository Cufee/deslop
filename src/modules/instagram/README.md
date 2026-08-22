# instagram

A Home Screen icon that looks exactly like the real Instagram app but opens
`instagram.com/direct/inbox/` instead of the feed. Mounted at `/instagram/`
on the deslop worker.

Safari decides what a Home Screen icon opens from the manifest's `start_url`
at install time, and `start_url` must be same-origin with the installed page
(see the [repo README](../../../README.md) for the full rules). So the worker
hosts a launcher on its own origin: it fetches Instagram's manifest live and
patches it, and everything the phone shows (name, colors, icons) comes from
that manifest. Nothing about Instagram's branding is stored in this repo.

## What gets patched

The module fetches `https://www.instagram.com/data/manifest.json` (edge
cached for one day) and changes three members:

- `start_url` becomes `/instagram/launch` (or `/instagram/` in client
  redirect mode, see below).
- `scope` becomes `/instagram/`.
- every `icons[].src` becomes `/instagram/icon/<sizes>` on this worker, so
  icon bytes are proxied from Instagram's current icon URLs instead of
  pinned ones.

Every other member passes through upstream untouched. The install page
derives its `apple-mobile-web-app-title`, `theme-color`, and
`apple-touch-icon` links from the same manifest, so a rebrand or icon change
on Instagram's side propagates on its own.

If the upstream fetch fails (Instagram down or blocking worker egress), the
module's routes return 502 rather than serving stale hardcoded data.

## Routes

| Route | Serves |
| --- | --- |
| `/instagram/` | Install page. In Safari: instructions for Add to Home Screen. Launched from the Home Screen: client-side redirect to the target (safety net for both redirect modes). |
| `/instagram/launch` | 302 to the target. This is the `start_url` in `server` mode. |
| `/instagram/data/manifest.json` | Instagram's manifest with the three patches above. `/instagram/manifest.webmanifest` is an alias. |
| `/instagram/icon/<sizes>` | Icon bytes for a size declared in the upstream manifest, proxied live and edge cached. Any other size returns 404. |

## Configuration

Settings are `[vars]` in the root `wrangler.toml`:

- `INSTAGRAM_TARGET_URL`: where a launch lands. Default
  `https://www.instagram.com/direct/inbox/`.
- `INSTAGRAM_REDIRECT_MODE`: `server` (default) or `client`, see below.

Changing vars or code and pushing to the connected branch redeploys the
worker through Workers Builds.

## Set it up on the phone

1. Open `https://<worker-host>/instagram/` in Safari on the iPhone. You will
   see the install page.
2. Tap **Share**, scroll down, tap **Add to Home Screen**.
3. On iOS 26 and later, leave **Open as Web App** enabled. Tap **Add**.
4. Tap the new icon. It should open Instagram straight into your messages.

If Instagram asks you to log in on first launch, that is expected. Home
Screen web apps have their own cookie jar, separate from Safari (iOS 16.4
and later). Log in once and the session persists.

## Redirect modes

The launch has to leave the worker's origin to reach instagram.com, and a
same-origin `scope` cannot cover two origins. What happens at that boundary
depends on how the navigation starts, which is what the two modes trade on:

- `server`: the manifest's `start_url` is `/instagram/launch`, which 302s to
  the target. Redirect chains that begin with the launch navigation itself
  stay inside the chromeless web app window. This is the same path WebKit
  fixed in iOS 12.2 for OAuth flows, so it is the default.
- `client`: the manifest's `start_url` is `/instagram/`, and the page script
  calls `location.replace(target)` after detecting standalone mode.

Test `server` mode first. If launching instead hands you to a Safari view
with an address bar and you want the chromeless window, set
`INSTAGRAM_REDIRECT_MODE = "client"` in `wrangler.toml`, push, then remove
and re-add the Home Screen icon. iOS reads the manifest only at install
time, so redeploying alone changes nothing for an existing icon.
