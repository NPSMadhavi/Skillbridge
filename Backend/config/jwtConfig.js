import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Resilient .env loading so JWT_SECRET is loaded regardless of current working directory or ESM hoisting
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const potentialEnvPaths = [
  path.join(currentDir, '..', '.env'),
  path.join(currentDir, '..', '..', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'Backend', '.env')
];
for (const envFile of potentialEnvPaths) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
let secret = process.env.JWT_SECRET;

const INSECURE_DEFAULTS = new Set([
  'super-secret-key-change-in-prod',
  'secret',
  'jwtsecret',
  'changeme',
  '123456',
  'default_secret'
]);

// Development fallback key: persistent across dev restarts so devs aren't logged out every nodemon reload
const DEV_FALLBACK_SECRET = 'skillbridge-dev-secret-local-development-only-2026-fixed-length-48';

let validationStatus = {
  valid: true,
  status: 'STRONG_PRODUCTION',
  message: 'Cryptographically strong secret configured'
};

if (!secret || secret.trim() === '' || INSECURE_DEFAULTS.has(secret.trim())) {
  if (isProduction) {
    console.error('================================================================');
    console.error('[CRITICAL SECURITY WARNING] Insecure or missing JWT_SECRET in production!');
    console.error('Please configure a strong, random 64-character JWT_SECRET in your .env file.');
    console.error('================================================================');
    // In production, generate an emergency ephemeral 48-byte key to prevent static key forgery
    secret = crypto.randomBytes(48).toString('hex');
    process.env.JWT_SECRET = secret;
    validationStatus = {
      valid: false,
      status: 'EMERGENCY_EPHEMERAL',
      message: 'Missing or default in production (ephemeral generated)'
    };
  } else {
    // Development mode fallback
    secret = DEV_FALLBACK_SECRET;
    process.env.JWT_SECRET = secret;
    validationStatus = {
      valid: true,
      status: 'DEV_DEFAULT',
      message: 'Using development fallback secret'
    };
  }
} else if (secret.length < 32) {
  if (isProduction) {
    console.warn('[SECURITY WARNING] JWT_SECRET is shorter than 32 characters in production.');
    validationStatus = {
      valid: true,
      status: 'WEAK',
      message: 'Secret is under 32 characters'
    };
  } else {
    validationStatus = {
      valid: true,
      status: 'DEV_CONFIGURED',
      message: 'Custom secret configured'
    };
  }
} else {
  validationStatus = {
    valid: true,
    status: isProduction ? 'STRONG_PRODUCTION' : 'STRONG_DEVELOPMENT',
    message: `${secret.length * 4}-bit cryptographic key configured`
  };
}

export function getJwtValidationStatus() {
  return validationStatus;
}

export const JWT_SECRET = secret;
export default JWT_SECRET;
