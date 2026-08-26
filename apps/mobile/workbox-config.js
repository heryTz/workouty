// Generates dist/sw.js from an already-exported web build — run it AFTER `expo export`, never
// before, since it globs the real output (see the `build` script in package.json and the
// Dockerfile's build stage).
//
// Scope note: only same-origin static output is cached here. Requests to the API and to
// PowerSync (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_POWERSYNC_URL, both cross-origin) match no route,
// so the service worker leaves them to the network — offline data is PowerSync's local SQLite
// job, not the cache's.
module.exports = {
  globDirectory: 'dist/',
  swDest: 'dist/sw.js',
  // Nothing debugs the generated worker from a prod deploy; skip shipping dist/sw.js.map.
  sourcemap: false,

  globPatterns: [
    // One HTML per route, matched at serve time by workbox's cleanURLs/directoryIndex handling
    // (/register -> register.html, /sessions -> sessions/index.html), same as the Caddyfile's
    // try_files. Serving one shared shell instead would be tempting — every page is a spinner
    // plus the shared bundle — but the prerendered markup differs enough per route to trip React
    // hydration (error #418) and throw the whole tree away on the client.
    '**/*.html',
    'favicon.ico',
    'manifest.json',
    'icons/*.png',
    '_expo/static/**/*.{js,css}',
    '@powersync/*.js',
  ],
  // `(app)` is a route group: expo-router strips it from URLs, so `expo export` writes every
  // authed route twice and only the copy without the group prefix is ever requested.
  globIgnores: ['**/*.map', '(app)/**', '_sitemap.html'],

  // The entry bundle is already past 1.5 MB and grows with the app; the 2 MB default would skip
  // it with nothing but a warning, leaving a service worker that "works" but boots to nothing
  // offline.
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,

  // Both Metro and @powersync/web's prebuilt workers put a content hash in the filename, so the
  // URL is already the version — no need for workbox to append its own __WB_REVISION__ and split
  // the HTTP cache entry Caddy already serves as immutable.
  dontCacheBustURLsMatching: /-(?:[0-9a-f]{32}|[A-Za-z0-9_-]{8})\.js$/,

  // Covers what precache can't match by URL: the dynamic routes, whose exported filenames are
  // literally `session/[id].html` and `sessions/[id].html`. Both are byte-identical to index.html
  // (the shell only ever prerenders the auth-guard spinner for them), so falling back to it is
  // exactly what the Caddyfile's /session/* rewrite serves. Unknown URLs land here too and
  // client-render the +not-found route.
  navigateFallback: '/index.html',

  // clientsClaim without skipWaiting: the first-ever worker takes control immediately (so the app
  // is offline-capable after one visit rather than two), but a later update stays in `waiting`
  // until every tab is closed. Swapping the bundle under a page mid-workout is exactly the
  // "aggressive service worker" failure the Expo PWA guide warns about.
  clientsClaim: true,
  skipWaiting: false,
  cleanupOutdatedCaches: true,

  runtimeCaching: [
    {
      // ~7 MB of wa-sqlite WASM ships in dist but only the variant matching the browser's VFS is
      // ever fetched, so these are cached on first use instead of precached. Content-hashed, so
      // CacheFirst can never go stale.
      urlPattern: /\/@powersync\/assets\/[^/]+\.wasm$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'powersync-wasm',
        expiration: { maxEntries: 8 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      // Exercise illustrations (~2 MB across 88 SVGs) and the other bundled images: cached as
      // they're viewed, so a session's movements stay previewable offline without making every
      // first load pay for all of them.
      urlPattern: /\/assets\/.*\.(?:svg|png|jpg|jpeg|webp|gif)$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'app-images',
        expiration: { maxEntries: 300, maxAgeSeconds: 90 * 24 * 60 * 60, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
}
