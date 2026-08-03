// PowerSync ships two client SDKs: @powersync/react-native (op-sqlite, native) and @powersync/web
// (wa-sqlite/WASM, web). Metro picks the right *source* file per platform automatically via the
// database.native.ts / database.web.ts split (see src/powersync/database.ts), but @powersync/web's
// own package.json needs an extra nudge to resolve correctly under Metro:
//
// Expo's default Metro config strips the "react-native" export condition when bundling for web
// (https://github.com/expo/expo/blob/main/packages/@expo/metro-config/src/ExpoMetroConfig.ts —
// search "This is removed for server platforms" / the `web: ['browser']` condition list). But
// @powersync/web's package.json only exposes a Metro/react-native-web-compatible build behind a
// "react-native-web" export condition (its "default" export condition targets Vite/webpack, which
// support `new Worker(new URL(...), import.meta.url)`; Metro does not). So we add that condition
// back for the web platform — see @powersync/web's own docs:
// https://docs.powersync.com/client-sdks/frameworks/react-native-web-support
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.resolver.unstable_conditionsByPlatform.web.push('react-native-web')

module.exports = config
