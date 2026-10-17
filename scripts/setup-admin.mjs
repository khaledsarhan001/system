import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (![ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD].every(Boolean)) {
  throw new Error('Set ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD in .env.');
}
if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters.');

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const username = ADMIN_USERNAME.trim().toLowerCase();
const email = ADMIN_EMAIL.trim().toLowerCase();
const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(ADMIN_PASSWORD, salt, 100_000, 32, 'sha256').toString('hex');
const permissions = JSON.stringify({ productsRead: true, productsWrite: true, salesCreate: true, employeesRead: true, analyticsRead: true });
const now = new Date().toISOString();
const values = [randomUUID(), ADMIN_NAME.trim(), username, email, passwordHash, salt.toString('hex'), permissions, now, now].map(sqlQuote);
const sql = `UPDATE users SET password_hash=${values[4]},password_salt=${values[5]},is_active=1,updated_at=${values[8]}
WHERE username=${values[2]} OR email=${values[3]};
INSERT INTO users (id,name,username,email,role,password_hash,password_salt,is_active,permissions_json,created_at,updated_at)
SELECT ${values[0]},${values[1]},${values[2]},${values[3]},'admin',${values[4]},${values[5]},1,${values[6]},${values[7]},${values[8]}
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = ${values[2]} OR email = ${values[3]});`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'apparel-inventory', '--remote', '--command', sql], { cwd: root, stdio: 'inherit' });
console.log(`Administrator setup finished for ${username} (matching existing accounts are left unchanged).`);
