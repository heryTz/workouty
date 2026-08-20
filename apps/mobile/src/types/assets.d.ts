// `.svg` is in Metro's assetExts (see metro.config.js's resolved config), so importing one yields
// a bundled asset — but neither expo/types nor @types/react-native declares the module, and this
// is the first place in the app that imports an image at all.
//
// The type is a union because the runtime value genuinely differs per platform: Metro resolves a
// bundled asset to an opaque numeric handle on native and to an object carrying a uri on web,
// while vitest's `assetsInclude` (vitest.config.ts) hands back the path as a string. All three are
// valid expo-image `source` values, which is the only thing these imports are ever used as.
declare module '*.svg' {
  import type { ImageSource } from 'expo-image'

  const asset: ImageSource | string | number
  export default asset
}
