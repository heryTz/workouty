// The bundled frame pair for each drawing referenced by exercise-illustrations.ts, split out of
// that module so it stays free of asset imports and testable under plain node.
//
// Static imports, one per file: Metro resolves an asset import to a bundled asset, but only when
// the path is a literal it can see at build time — a computed `require('.../' + slug + '.svg')`
// bundles nothing and fails at runtime. So this table is written out rather than generated, and
// exercise-illustration-assets.test.ts pins it against the map so a missing pair fails CI.
import type { ImageSource } from 'expo-image'
import start0004 from '../../assets/exercises/0004-relaxation.svg'
import end0004 from '../../assets/exercises/0004-tension.svg'
import start0018 from '../../assets/exercises/0018-relaxation.svg'
import end0018 from '../../assets/exercises/0018-tension.svg'
import start0021 from '../../assets/exercises/0021-relaxation.svg'
import end0021 from '../../assets/exercises/0021-tension.svg'
import start0025 from '../../assets/exercises/0025-relaxation.svg'
import end0025 from '../../assets/exercises/0025-tension.svg'
import start0026 from '../../assets/exercises/0026-relaxation.svg'
import end0026 from '../../assets/exercises/0026-tension.svg'
import start0032 from '../../assets/exercises/0032-relaxation.svg'
import end0032 from '../../assets/exercises/0032-tension.svg'
import start0033 from '../../assets/exercises/0033-relaxation.svg'
import end0033 from '../../assets/exercises/0033-tension.svg'
import start0042 from '../../assets/exercises/0042-relaxation.svg'
import end0042 from '../../assets/exercises/0042-tension.svg'
import start0043 from '../../assets/exercises/0043-relaxation.svg'
import end0043 from '../../assets/exercises/0043-tension.svg'
import start0051 from '../../assets/exercises/0051-relaxation.svg'
import end0051 from '../../assets/exercises/0051-tension.svg'
import start0052 from '../../assets/exercises/0052-relaxation.svg'
import end0052 from '../../assets/exercises/0052-tension.svg'
import start0055 from '../../assets/exercises/0055-relaxation.svg'
import end0055 from '../../assets/exercises/0055-tension.svg'
import start0061 from '../../assets/exercises/0061-relaxation.svg'
import end0061 from '../../assets/exercises/0061-tension.svg'
import start0075 from '../../assets/exercises/0075-relaxation.svg'
import end0075 from '../../assets/exercises/0075-tension.svg'
import start0077 from '../../assets/exercises/0077-relaxation.svg'
import end0077 from '../../assets/exercises/0077-tension.svg'
import start0079 from '../../assets/exercises/0079-relaxation.svg'
import end0079 from '../../assets/exercises/0079-tension.svg'
import start0087 from '../../assets/exercises/0087-relaxation.svg'
import end0087 from '../../assets/exercises/0087-tension.svg'
import start0092 from '../../assets/exercises/0092-relaxation.svg'
import end0092 from '../../assets/exercises/0092-tension.svg'
import start0095 from '../../assets/exercises/0095-relaxation.svg'
import end0095 from '../../assets/exercises/0095-tension.svg'
import start0096 from '../../assets/exercises/0096-relaxation.svg'
import end0096 from '../../assets/exercises/0096-tension.svg'
import start0099 from '../../assets/exercises/0099-relaxation.svg'
import end0099 from '../../assets/exercises/0099-tension.svg'
import start0107 from '../../assets/exercises/0107-relaxation.svg'
import end0107 from '../../assets/exercises/0107-tension.svg'
import start0115 from '../../assets/exercises/0115-relaxation.svg'
import end0115 from '../../assets/exercises/0115-tension.svg'
import start0117 from '../../assets/exercises/0117-relaxation.svg'
import end0117 from '../../assets/exercises/0117-tension.svg'
import start0122 from '../../assets/exercises/0122-relaxation.svg'
import end0122 from '../../assets/exercises/0122-tension.svg'
import start0123 from '../../assets/exercises/0123-relaxation.svg'
import end0123 from '../../assets/exercises/0123-tension.svg'
import start0127 from '../../assets/exercises/0127-relaxation.svg'
import end0127 from '../../assets/exercises/0127-tension.svg'
import start0130 from '../../assets/exercises/0130-relaxation.svg'
import end0130 from '../../assets/exercises/0130-tension.svg'
import start0138 from '../../assets/exercises/0138-relaxation.svg'
import end0138 from '../../assets/exercises/0138-tension.svg'
import start0142 from '../../assets/exercises/0142-relaxation.svg'
import end0142 from '../../assets/exercises/0142-tension.svg'
import start0183 from '../../assets/exercises/0183-relaxation.svg'
import end0183 from '../../assets/exercises/0183-tension.svg'
import start0188 from '../../assets/exercises/0188-relaxation.svg'
import end0188 from '../../assets/exercises/0188-tension.svg'
import start0189 from '../../assets/exercises/0189-relaxation.svg'
import end0189 from '../../assets/exercises/0189-tension.svg'
import start0198 from '../../assets/exercises/0198-relaxation.svg'
import end0198 from '../../assets/exercises/0198-tension.svg'
import start0205 from '../../assets/exercises/0205-relaxation.svg'
import end0205 from '../../assets/exercises/0205-tension.svg'
import start0211 from '../../assets/exercises/0211-relaxation.svg'
import end0211 from '../../assets/exercises/0211-tension.svg'
import start0212 from '../../assets/exercises/0212-relaxation.svg'
import end0212 from '../../assets/exercises/0212-tension.svg'
import start0216 from '../../assets/exercises/0216-relaxation.svg'
import end0216 from '../../assets/exercises/0216-tension.svg'
import start0224 from '../../assets/exercises/0224-relaxation.svg'
import end0224 from '../../assets/exercises/0224-tension.svg'
import start0227 from '../../assets/exercises/0227-relaxation.svg'
import end0227 from '../../assets/exercises/0227-tension.svg'
import start0282 from '../../assets/exercises/0282-relaxation.svg'
import end0282 from '../../assets/exercises/0282-tension.svg'
import start0287 from '../../assets/exercises/0287-relaxation.svg'
import end0287 from '../../assets/exercises/0287-tension.svg'
import start0291 from '../../assets/exercises/0291-relaxation.svg'
import end0291 from '../../assets/exercises/0291-tension.svg'

// Whatever the bundler made of the imported file — see src/types/assets.d.ts for why this is a
// union and not just ImageSource. Narrower than expo-image's own `source` type on purpose: these
// are always bundled assets, never a remote URL or an SF Symbol.
export type IllustrationFrame = ImageSource | string | number

export type IllustrationFrames = {
  start: IllustrationFrame
  end: IllustrationFrame
}

export const ILLUSTRATION_ASSETS: Record<string, IllustrationFrames> = {
  '0004': { start: start0004, end: end0004 },
  '0018': { start: start0018, end: end0018 },
  '0021': { start: start0021, end: end0021 },
  '0025': { start: start0025, end: end0025 },
  '0026': { start: start0026, end: end0026 },
  '0032': { start: start0032, end: end0032 },
  '0033': { start: start0033, end: end0033 },
  '0042': { start: start0042, end: end0042 },
  '0043': { start: start0043, end: end0043 },
  '0051': { start: start0051, end: end0051 },
  '0052': { start: start0052, end: end0052 },
  '0055': { start: start0055, end: end0055 },
  '0061': { start: start0061, end: end0061 },
  '0075': { start: start0075, end: end0075 },
  '0077': { start: start0077, end: end0077 },
  '0079': { start: start0079, end: end0079 },
  '0087': { start: start0087, end: end0087 },
  '0092': { start: start0092, end: end0092 },
  '0095': { start: start0095, end: end0095 },
  '0096': { start: start0096, end: end0096 },
  '0099': { start: start0099, end: end0099 },
  '0107': { start: start0107, end: end0107 },
  '0115': { start: start0115, end: end0115 },
  '0117': { start: start0117, end: end0117 },
  '0122': { start: start0122, end: end0122 },
  '0123': { start: start0123, end: end0123 },
  '0127': { start: start0127, end: end0127 },
  '0130': { start: start0130, end: end0130 },
  '0138': { start: start0138, end: end0138 },
  '0142': { start: start0142, end: end0142 },
  '0183': { start: start0183, end: end0183 },
  '0188': { start: start0188, end: end0188 },
  '0189': { start: start0189, end: end0189 },
  '0198': { start: start0198, end: end0198 },
  '0205': { start: start0205, end: end0205 },
  '0211': { start: start0211, end: end0211 },
  '0212': { start: start0212, end: end0212 },
  '0216': { start: start0216, end: end0216 },
  '0224': { start: start0224, end: end0224 },
  '0227': { start: start0227, end: end0227 },
  '0282': { start: start0282, end: end0282 },
  '0287': { start: start0287, end: end0287 },
  '0291': { start: start0291, end: end0291 },
}
