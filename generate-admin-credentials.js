#!/usr/bin/env node

/**
 * Generate Admin Credentials for G-Spirit Worker
 * 
 * This script generates:
 * - ADMIN_PASSWORD_SALT (random salt)
 * - ADMIN_PASSWORD_HASH (PBKDF2 hashed password)
 * - ADMIN_JWT_SECRET (random secret for JWT signing)
 * 
 * Run: node generate-admin-credentials.js <password>
 */

const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
  console.error('❌ Error: Password is required');
  console.error('Usage: node generate-admin-credentials.js <password>');
  process.exit(1);
}

// Generate random salt (24 bytes, base64-encoded = 32 chars)
const salt = crypto.randomBytes(24).toString('base64');

// Generate random JWT secret (32 bytes, hex = 64 chars)
const jwtSecret = crypto.randomBytes(32).toString('hex');

// Hash password using PBKDF2 (matching worker.js logic)
// 100,000 iterations, SHA-256, 256-bit output
const hash = crypto
  .pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  .toString('hex');

console.log('\n' + '='.repeat(70));
console.log('🔐 G-SPIRIT ADMIN CREDENTIALS GENERATED');
console.log('='.repeat(70) + '\n');

console.log('📝 Copy these values to Cloudflare Workers → Settings → Environment Variables:\n');

console.log('Variable Name          | Value');
console.log('-'.repeat(70));
console.log(`ADMIN_PASSWORD_SALT    | ${salt}`);
console.log(`ADMIN_PASSWORD_HASH    | ${hash}`);
console.log(`ADMIN_JWT_SECRET       | ${jwtSecret}`);

console.log('\n' + '='.repeat(70));
console.log('✅ SETUP INSTRUCTIONS:');
console.log('='.repeat(70) + '\n');

console.log('1. Go to your Cloudflare Dashboard');
console.log('2. Navigate to: Workers & Pages → gspiritloans (or your worker name)');
console.log('3. Click: Settings → Environment Variables');
console.log('4. Add three new variables (Production):\n');

console.log('   Key: ADMIN_PASSWORD_SALT');
console.log(`   Value: ${salt}\n`);

console.log('   Key: ADMIN_PASSWORD_HASH');
console.log(`   Value: ${hash}\n`);

console.log('   Key: ADMIN_JWT_SECRET');
console.log(`   Value: ${jwtSecret}\n`);

console.log('5. Click "Encrypt & Save"');
console.log('6. Deploy your worker (if needed)');
console.log('7. Try logging in with password: ' + password);

console.log('\n' + '='.repeat(70) + '\n');

console.log('💡 NOTES:');
console.log('   • The password is NOT stored anywhere - only the hash');
console.log('   • Keep these credentials secure and never commit to git');
console.log('   • Admin can login with any admin panel using: ' + password);

console.log('\n');
