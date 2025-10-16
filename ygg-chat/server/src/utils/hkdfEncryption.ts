import { createCipheriv, createDecipheriv, hkdf, randomBytes } from 'crypto'

const ALGORITHM = 'chacha20-poly1305'
const NONCE_LENGTH = 12 // ChaCha20-Poly1305 uses 12-byte nonces
const TAG_LENGTH = 16
const SALT_LENGTH = 32

export interface EncryptedData {
  encrypted: string
  nonce: string
  tag: string
  salt: string
}

function getMasterKey(): string {
  const masterKey = process.env.ENCRYPTION_MASTER_KEY
  if (!masterKey) {
    throw new Error('ENCRYPTION_MASTER_KEY environment variable is not set')
  }
  return masterKey
}

function deriveKey(salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const masterKey = getMasterKey()
    // XChaCha20 uses 32-byte keys
    hkdf('sha256', masterKey, salt, Buffer.alloc(0), 32, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(Buffer.from(derivedKey))
    })
  })
}

export async function encryptApiKey(plainText: string, providedSalt?: Buffer): Promise<EncryptedData> {
  if (!plainText) {
    throw new Error('Cannot encrypt empty string')
  }

  const salt = providedSalt || randomBytes(SALT_LENGTH)
  const nonce = randomBytes(NONCE_LENGTH)
  const key = await deriveKey(salt)

  const cipher = createCipheriv(ALGORITHM, key, nonce)

  let encrypted = cipher.update(plainText, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const tag = cipher.getAuthTag()

  return {
    encrypted,
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64')
  }
}

export async function decryptApiKey(encryptedData: EncryptedData): Promise<string> {
  const salt = Buffer.from(encryptedData.salt, 'base64')
  const nonce = Buffer.from(encryptedData.nonce, 'base64')
  const tag = Buffer.from(encryptedData.tag, 'base64')
  const key = await deriveKey(salt)

  const decipher = createDecipheriv(ALGORITHM, key, nonce)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

export async function testEncryption(plainText: string): Promise<boolean> {
  try {
    const encrypted = await encryptApiKey(plainText)
    const decrypted = await decryptApiKey(encrypted)
    return plainText === decrypted
  } catch (error) {
    console.error('Encryption test failed:', error)
    return false
  }
}