// const crypto = require('crypto');
import crypto from 'crypto'

const algorithm = 'aes-256-cbc';
const secretKey = process.env.SECRET_KEY || 'your-32-byte-secret-key-123456';
const iv = crypto.randomBytes(16);

export function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex')
  };
}

export function decrypt(encryptedData) {
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const encryptedText = Buffer.from(encryptedData.content, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// module.exports = { encrypt, decrypt };
