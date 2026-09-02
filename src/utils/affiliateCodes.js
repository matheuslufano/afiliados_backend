const crypto = require('node:crypto');

function generateAffiliateCode() {
  return crypto.randomBytes(4).toString('hex');
}

function isAffiliateCode(value) {
  return /^[a-f0-9]{8}$/.test(String(value || '').trim().toLowerCase());
}

module.exports = { generateAffiliateCode, isAffiliateCode };
