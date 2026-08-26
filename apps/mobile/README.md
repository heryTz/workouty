# @workouty/mobile

The Workouty client: an Expo app that runs on iOS, Android, and the web from the same source.
It owns the local database — every set is written to on-device SQLite through PowerSync and
syncs back when there's a connection — so most of the app never waits on the network.

- Routes live in `src/app`, using [Expo Router](https://docs.expo.dev/router/introduction/)'s
  file-based routing. `(app)` holds the authenticated screens; `login`, `register`, and
  `forgot-password` sit outside it.
- The web target exports as a static site (`web.output: "static"`) and is served by Caddy in
  production — see `Dockerfile` and `Caddyfile`.
- `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_POWERSYNC_URL` are inlined at build time, not read at
  runtime.
- The web build is an installable PWA: `public/manifest.json` plus a Workbox service worker that
  `pnpm build` generates from the export (`workbox-config.js`). The service worker is only
  registered in production builds — see the guard in `src/app/+html.tsx`.

```bash
pnpm --filter @workouty/mobile start        # dev server on :6102
pnpm --filter @workouty/mobile test         # unit tests
pnpm --filter @workouty/mobile test:sync    # sync round-trip, needs the whole stack up
```

Running the full stack, the test layout, and deployment: [docs/development.md](../../docs/development.md).

Licensed under the GNU Affero General Public License v3.0, like the rest of the repo — see
[LICENSE](../../LICENSE).
