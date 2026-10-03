/**
 * HMAC-signed values for httpOnly cookies.
 *
 * Web Crypto is used instead of `node:crypto` so the same code path works in
 * the edge middleware and in Node server actions.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`
 */

const encoder = new TextEncoder()

const DEV_FALLBACK_SECRET = 'crypto-sentinel-development-signing-secret'

async function getSigningKey(): Promise<CryptoKey> {
  const secret =
    process.env.SESSION_SECRET ??
    process.env.ENCRYPTION_KEY ??
    DEV_FALLBACK_SECRET

  if (
    !process.env.SESSION_SECRET &&
    !process.env.ENCRYPTION_KEY &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'SESSION_SECRET or ENCRYPTION_KEY must be set in production to sign cookies',
    )
  }

  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** Returns `value.signature`, or null if the signature does not verify. */
export async function signValue(value: string): Promise<string> {
  const key = await getSigningKey()
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return `${toBase64Url(encoder.encode(value))}.${toBase64Url(new Uint8Array(signature))}`
}

/** Verifies a signed value and parses it as JSON, or returns null. */
export async function verifyValue<T>(signed: string): Promise<T | null> {
  const [payload, signature] = signed.split('.')
  if (!payload || !signature) return null

  try {
    const key = await getSigningKey()
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      fromBase64Url(payload),
    )
    if (!valid) return null

    return JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as T
  } catch {
    return null
  }
}