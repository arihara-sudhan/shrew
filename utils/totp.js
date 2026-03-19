const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.replace(/[^A-Z2-7]/g, '').toUpperCase();
  const bits = cleaned
    .split('')
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
    .join('');

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateHOTP(secret, counter, digits = 6) {
  const key = typeof secret === 'string' ? base32Decode(secret) : Buffer.from(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(counterBuf);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  const otp = (code % 10 ** digits).toString().padStart(digits, '0');
  return otp;
}

function generateTOTP(secret, digits = 6, stepSeconds = 30, epoch = Date.now()) {
  const counter = Math.floor(epoch / 1000 / stepSeconds);
  return generateHOTP(secret, counter, digits);
}

async function getTOTPSecretForPayer(payerName) {
  if (!payerName) throw new Error('payerName is required');
  const normalized = payerName.toString().trim().toUpperCase();

  // Env var priority only
  const envKey = `${normalized}_TOTP_SECRET`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  throw new Error(`TOTP secret not found for payer '${payerName}'. Set ${envKey} in .env.`);
}

async function getTOTPForPayer(payerName, options = {}) {
  const secret = await getTOTPSecretForPayer(payerName);
  const digits = Number(options.digits || 6);
  const step = Number(options.stepSeconds || 30);
  const epoch = options.epoch || Date.now();
  return generateTOTP(secret, digits, step, epoch);
}

module.exports = {
  generateHOTP,
  generateTOTP,
  getTOTPSecretForPayer,
  getTOTPForPayer,
};
