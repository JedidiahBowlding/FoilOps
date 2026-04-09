import crypto from 'crypto'

export type EncryptedBackupPayload = {
  version: 1
  algorithm: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

function parseAesKeyFromEnv(rawKey: string): Buffer {
  const trimmed = rawKey.trim()

  // 64-char hex key (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }

  // Base64 key (expects 32 decoded bytes)
  const base64Buffer = Buffer.from(trimmed, 'base64')
  if (base64Buffer.length === 32) {
    return base64Buffer
  }

  throw new Error('Invalid BACKUP_ENCRYPTION_KEY. Use 32-byte base64 or 64-char hex.')
}

function getAesKey(): Buffer {
  const key = process.env.BACKUP_ENCRYPTION_KEY
  if (!key) {
    throw new Error('BACKUP_ENCRYPTION_KEY is required when encrypted backup mode is enabled')
  }

  return parseAesKeyFromEnv(key)
}

export function encryptBackupJson(plainText: string): EncryptedBackupPayload {
  const key = getAesKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }
}

export function decryptBackupJson(payload: EncryptedBackupPayload): string {
  const key = getAesKey()

  if (payload.version !== 1 || payload.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted backup payload format')
  }

  const iv = Buffer.from(payload.iv, 'base64')
  const authTag = Buffer.from(payload.authTag, 'base64')
  const ciphertext = Buffer.from(payload.ciphertext, 'base64')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

export function isEncryptedPayload(value: unknown): value is EncryptedBackupPayload {
  if (!value || typeof value !== 'object') return false

  const payload = value as Record<string, unknown>
  return (
    payload.version === 1 &&
    payload.algorithm === 'aes-256-gcm' &&
    typeof payload.iv === 'string' &&
    typeof payload.authTag === 'string' &&
    typeof payload.ciphertext === 'string'
  )
}
