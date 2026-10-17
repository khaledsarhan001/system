# Cloudflare Workers + React implementation

This deployment uses Hono in a Cloudflare Worker and a React/Vite single-page app. The Worker makes HTTP `fetch` calls to the configured MongoDB Data API endpoint; it does not import Mongoose or a MongoDB driver. The legacy Express application remains available through the existing `server.js` scripts.

## MongoDB service status

MongoDB Atlas App Services Data API reached end of life on **September 30, 2025**. A new deployment in 2026 cannot use MongoDB's hosted Data API. The adapter in `worker/data-api.ts` implements the Data API HTTP action protocol for an endpoint that still supports it. To run this deployment, configure a compatible HTTP gateway that connects to MongoDB and supports `find`, `findOne`, `insertOne`, and `updateOne`, or replace the adapter with another supported database service. Do not expose the data API key in the React frontend.

## Local configuration

Create `.env` in the repository root for the one-time administrator setup command:

```dotenv
MONGODB_DATA_API_URL=https://your-compatible-endpoint.example/endpoint/data/v1/action
MONGODB_DATA_API_KEY=your-server-side-key
MONGODB_DATABASE=apparel_inventory
MONGODB_DATASOURCE=Cluster0
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_NAME=Store Administrator
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-long-unique-password
```

Create `.dev.vars` in the repository root for local Worker secrets:

```dotenv
MONGODB_DATA_API_URL=https://your-compatible-endpoint.example/endpoint/data/v1/action
MONGODB_DATA_API_KEY=your-server-side-key
JWT_SECRET=replace-with-a-long-random-secret
```

Install dependencies with `npm install`, then create the first Worker-format administrator using `npm run setup:admin`. The setup command inserts a PBKDF2 password hash and boolean permission flags in the `users` collection. Existing bcrypt hashes from the legacy Express app can also be used to sign in; the worker verifies them with bcryptjs.

Run the React frontend with `npm run dev:worker` and the Hono API separately with `npx wrangler dev --port 8787`. Vite proxies `/api` requests to Wrangler. Build and deploy with `npm run deploy`. Add secrets before deployment:

```sh
npx wrangler secret put JWT_SECRET
npx wrangler secret put MONGODB_DATA_API_URL
npx wrangler secret put MONGODB_DATA_API_KEY
```

Set `MONGODB_DATABASE` and `MONGODB_DATASOURCE` in `wrangler.toml` or as Worker variables. The Worker serves the built React assets through the configured `ASSETS` binding.

## API routes

- `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/products` (productsRead)
- `POST /api/products`, `PUT /api/products/:id` (productsWrite)
- `GET /api/employees` (employeesRead; admins bypass permission flags)
- `PUT /api/employees/:id/permissions` (admin only)
- `GET /api/analytics` (analyticsRead)
- `POST /api/sales` (salesCreate)

Permissions are stored on each user as booleans: `productsRead`, `productsWrite`, `salesCreate`, `employeesRead`, and `analyticsRead`. Admin accounts bypass employee permission flags. Product categories are restricted to `Men`, `Women`, and `Kids`; the colors field accepts an arbitrary list of user-entered names.
