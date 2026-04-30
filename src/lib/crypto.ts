/**
 * AES-256-GCM encryption for wallet private keys stored in the database.
 *
 * Encrypted format: `enc:v1:<base64(iv)>.<base64(authTag)>.<base64(ciphertext)>`
 * The `enc:v1:` prefix lets callers detect whether a DB value is ciphertext or
 * legacy plaintext, enabling zero-downtime migration.
 *
 * Requires env var: WALLET_ENCRYPTION_KEY — 64 hex characters (32 bytes).
 * Generate with: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES = 12 // 96-bit IV — recommended for GCM
const TAG_BYTES = 16 // 128-bit auth tag
const PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'WALLET_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32',
    )
  }
  return Buffer.from(hex, 'hex')
}

/** Returns true if the value has already been encrypted by this utility. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * Encrypts a plaintext private key string.
 * Throws if WALLET_ENCRYPTION_KEY is not set or malformed.
 */
export function encryptPrivateKey(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return PREFIX + iv.toString('base64') + '.' + authTag.toString('base64') + '.' + encrypted.toString('base64')
}

/**
 * Decrypts a value previously encrypted with `encryptPrivateKey`.
 * If the value does not carry the `enc:v1:` prefix it is returned as-is
 * (graceful fallback for records not yet migrated).
 */
export function decryptPrivateKey(value: string): string {
  if (!isEncrypted(value)) {
    // Legacy plaintext — return untouched; migration script will encrypt it.
    return value
  }

  const payload = value.slice(PREFIX.length)
  const parts = payload.split('.')
  if (parts.length !== 3) {
    throw new Error('Encrypted private key has unexpected format.')
  }

  const [ivB64, tagB64, ciphertextB64] = parts
  const key = getKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}
