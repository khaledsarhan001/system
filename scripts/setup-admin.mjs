import { randomBytes, pbkdf2Sync } from 'node:crypto';

const { MONGODB_DATA_API_URL, MONGODB_DATA_API_KEY, MONGODB_DATABASE = 'apparel_inventory', MONGODB_DATASOURCE = 'Cluster0', ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (![MONGODB_DATA_API_URL, MONGODB_DATA_API_KEY, ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD].every(Boolean)) {
  throw new Error('Set MongoDB Data API settings and ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD in .env first.');
}
if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must have at least 10 characters.');

const post = async (action, payload) => {
  const response = await fetch(`${MONGODB_DATA_API_URL.replace(/\/$/, '')}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': MONGODB_DATA_API_KEY },
    body: JSON.stringify({ dataSource: MONGODB_DATASOURCE, database: MONGODB_DATABASE, collection: 'users', ...payload }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Data API error ${response.status}`);
  return body;
};

const username = ADMIN_USERNAME.trim().toLowerCase();
const existing = await post('findOne', { filter: { $or: [{ username }, { email: ADMIN_EMAIL.trim().toLowerCase() }] } });
if (existing.document) throw new Error('An account with that username or email already exists.');
const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(ADMIN_PASSWORD, salt, 210_000, 32, 'sha256').toString('hex');
const permissions = { productsRead: true, productsWrite: true, salesCreate: true, employeesRead: true, analyticsRead: true };
const document = {
  id: randomBytes(12).toString('hex'), name: ADMIN_NAME.trim(), username,
  email: ADMIN_EMAIL.trim().toLowerCase(), role: 'admin', isActive: true,
  permissions, passwordHash, passwordSalt: salt.toString('hex'),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
await post('insertOne', { document });
console.log(`Created administrator ${username}.`);
