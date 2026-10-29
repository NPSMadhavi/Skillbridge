import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

let secret = process.env.JWT_SECRET;

if (!secret || secret.trim() === '' || secret === 'super-secret-key-change-in-prod') {
  if (process.env.NODE_ENV === 'production') {
    console.error('================================================================');
    console.error('[CRITICAL SECURITY WARNING] Insecure or missing JWT_SECRET in production!');
    console.error('Please configure a strong, random 64-character JWT_SECRET in your .env file.');
    console.error('================================================================');
  }
  // Generate an ephemeral cryptographically strong secret rather than using a known static default
  if (!secret || secret.trim() === '') {
    secret = crypto.randomBytes(48).toString('hex');
    process.env.JWT_SECRET = secret;
  }
}

export const JWT_SECRET = secret;
export default JWT_SECRET;

