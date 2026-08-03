import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  importPKCS8,
  type CryptoKey,
  type JWK,
} from 'jose'

// The RS256 signing key must be STABLE across restarts: a per-boot keypair would
// change the `kid`, invalidating every outstanding access token and PowerSync's
// cached JWKS. In real environments JWT_PRIVATE_KEY (base64-encoded PKCS8 PEM) is
// supplied via env. Locally/in tests, if it's unset we fall back to an ephemeral
// keypair generated once per process (with a warning) so the suite still runs.

interface KeyMaterial {
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicJwk: JWK
  kid: string
}

let keyMaterialPromise: Promise<KeyMaterial> | undefined

async function loadKeyMaterial(): Promise<KeyMaterial> {
  const base64PrivateKey = process.env.JWT_PRIVATE_KEY

  let privateKey: CryptoKey
  let publicKey: CryptoKey

  if (base64PrivateKey) {
    const pkcs8Pem = Buffer.from(base64PrivateKey, 'base64').toString('utf8')
    privateKey = await importPKCS8(pkcs8Pem, 'RS256', { extractable: true })
    // A private key can't be used to derive its public counterpart directly with
    // importPKCS8 alone, so we round-trip through its JWK form to get the public
    // parameters (n, e) and re-import those as a standalone public key.
    const privateJwk = await exportJWK(privateKey)
    const publicJwkParams = { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e }
    publicKey = (await importJWK(
      { ...publicJwkParams, alg: 'RS256' },
      'RS256',
      { extractable: true },
    )) as CryptoKey
  } else {
    console.warn(
      '[crypto/keys] JWT_PRIVATE_KEY is not set — generating an ephemeral RSA keypair. ' +
        'Tokens signed with it will NOT survive a process restart.',
    )
    const generated = await generateKeyPair('RS256', { extractable: true })
    privateKey = generated.privateKey
    publicKey = generated.publicKey
  }

  const publicJwk = await exportJWK(publicKey)
  const kid = await calculateJwkThumbprint(publicJwk)

  return {
    privateKey,
    publicKey,
    publicJwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' },
    kid,
  }
}

function getKeyMaterial(): Promise<KeyMaterial> {
  if (!keyMaterialPromise) {
    keyMaterialPromise = loadKeyMaterial()
  }
  return keyMaterialPromise
}

export async function getPrivateKey(): Promise<CryptoKey> {
  return (await getKeyMaterial()).privateKey
}

export async function getPublicKey(): Promise<CryptoKey> {
  return (await getKeyMaterial()).publicKey
}

export async function getPublicJwk(): Promise<JWK> {
  return (await getKeyMaterial()).publicJwk
}

export async function getKid(): Promise<string> {
  return (await getKeyMaterial()).kid
}
