// Reads the `exp` claim out of a JWT WITHOUT verifying the signature. Verification isn't our
// job here: the client trusts the token it was just handed (by our own /auth endpoints), and
// PowerSync's server verifies it against the JWKS on the way in. This is purely local
// bookkeeping to decide when to proactively refresh.
//
// Hand-rolled base64url decode (dependency-free, and doesn't assume `atob`/`Buffer` exist —
// this module must import cleanly in both plain Node and the RN/Hermes runtime).

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlDecodeToString(input: string): string {
  // Strip any padding and reject characters outside the base64url alphabet.
  const clean = input.replace(/=+$/u, '')

  let bits = 0
  let value = 0
  let output = ''

  for (const char of clean) {
    const index = BASE64URL_ALPHABET.indexOf(char)
    if (index === -1) throw new Error(`Invalid base64url character: ${char}`)

    value = (value << 6) | index
    bits += 6

    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((value >> bits) & 0xff)
    }
  }

  return output
}

// Decodes a UTF-8 byte string (as produced by base64UrlDecodeToString) into a JS string.
function utf8Decode(byteString: string): string {
  let result = ''
  let i = 0

  while (i < byteString.length) {
    const byte1 = byteString.charCodeAt(i)

    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1)
      i += 1
    } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
      const byte2 = byteString.charCodeAt(i + 1)
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f))
      i += 2
    } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
      const byte2 = byteString.charCodeAt(i + 1)
      const byte3 = byteString.charCodeAt(i + 2)
      result += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f))
      i += 3
    } else {
      // 4-byte sequences (outside the BMP) — not expected in JWT claims, but decode
      // best-effort rather than throwing.
      const byte2 = byteString.charCodeAt(i + 1)
      const byte3 = byteString.charCodeAt(i + 2)
      const byte4 = byteString.charCodeAt(i + 3)
      const codepoint =
        ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f)
      result += String.fromCodePoint(codepoint)
      i += 4
    }
  }

  return result
}

// Decodes a JWT's payload segment to a plain object, or null if the token is malformed
// (wrong segment count, unparseable base64url, non-JSON, or not a JSON object). Shared by
// decodeJwtExpiry and decodeJwtSub below — same "trust our own token, don't verify" rationale
// as this file's header comment.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payloadJson = utf8Decode(base64UrlDecodeToString(parts[1]))
    const payload: unknown = JSON.parse(payloadJson)
    if (typeof payload !== 'object' || payload === null) return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

// Returns the JWT's `exp` claim as a Date, or null if the token is malformed, has no `exp`,
// or `exp` isn't a finite number.
export function decodeJwtExpiry(token: string): Date | null {
  const payload = decodeJwtPayload(token)
  if (!payload || !('exp' in payload)) return null

  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null

  // JWT `exp` is seconds since epoch; Date wants milliseconds.
  return new Date(exp * 1000)
}

// Returns the JWT's `sub` claim (our access tokens carry the user's uuid there — see
// apps/api's auth.service.ts), or null if the token is malformed, has no `sub`, or `sub` isn't
// a string. Used to derive the current user's id client-side for local writes (e.g. a new
// custom exercise's `user_id`) without a round trip.
export function decodeJwtSub(token: string): string | null {
  const payload = decodeJwtPayload(token)
  if (!payload || !('sub' in payload)) return null

  const sub = payload.sub
  return typeof sub === 'string' && sub.length > 0 ? sub : null
}
