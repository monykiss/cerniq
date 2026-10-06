import { randomBytes } from 'crypto';

// Unit-test secrets are generated per run — never fixed literals.
process.env.API_KEY_PEPPER =
  process.env.API_KEY_PEPPER || randomBytes(32).toString('hex');
