import crypto from 'crypto'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const TAG_LENGTH = 16
const IV_LENGTH = 12
const KEY_LENGTH = 32
const DEV_KEY_MATERIAL = 'crypto-sentinel-development-key'
const KEY_SALT = 'crypto-sentinel-key-salt'

/**
 * Resolves the AES-256 key.
 *
 * A 64-character hex `ENCRYPTION_KEY` is used verbatim. Anything else is run
 * through scrypt so a passphrase of any length still yields a 32-byte key.
 * With no key configured at all, a fixed development key is used — which is why
 * production startup fails loudly instead.
 */
function getEncryptionKey(): Buffer {
  const keyEnv = process.env.ENCRYPTION_KEY

  if (!keyEnv) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY environment variable is required in production')
    }
    return crypto.scryptSync(DEV_KEY_MATERIAL, KEY_SALT, KEY_LENGTH)
  }

  if (keyEnv.length === 64 && /^[0-9a-fA-F]{64}$/.test(keyEnv)) {
    return Buffer.from(keyEnv, 'hex')
  }

  return crypto.scryptSync(keyEnv, KEY_SALT, KEY_LENGTH)
}

/**
 * AES-256-GCM encryption.
 *
 * Output layout is `iv | authTag | ciphertext`, all hex-encoded. GCM's auth tag
 * means a tampered or wrongly-keyed value throws on decrypt rather than
 * returning garbage.
 */
export function encryptText(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)

  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return iv.toString('hex') + authTag.toString('hex') + encrypted
}

export function decryptText(encryptedText: string): string {
  const key = getEncryptionKey()

  const iv = Buffer.from(encryptedText.slice(0, IV_LENGTH * 2), 'hex')
  const authTag = Buffer.from(
    encryptedText.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2),
    'hex',
  )
  const encrypted = encryptedText.slice(IV_LENGTH * 2 + TAG_LENGTH * 2)

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
}
