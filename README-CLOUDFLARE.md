# Cloudflare Workers + React + D1

This deployment serves the React/Vite application and the Hono API from one Cloudflare Worker. Cloudflare D1 stores users, products, and sales; there is no runtime dependency on Express, Mongoose, or Atlas Data API.

## Create and configure D1

Install packages with `npm install`, then authenticate Wrangler with `npx wrangler login`. Create the production database:

```sh
npx wrangler d1 create apparel-inventory
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Apply the schema locally for development and remotely for production:

```sh
npx wrangler d1 migrations apply apparel-inventory --local
npx wrangler d1 migrations apply apparel-inventory --remote
```

For local development, create `.dev.vars` with a long random JWT secret:

```dotenv
JWT_SECRET=replace-with-a-long-random-secret
```

Set the production secret without putting it in Git:

```sh
npx wrangler secret put JWT_SECRET
```

## Create the first admin

Copy `.env.example` to `.env` and fill in the administrator name, username, email, and a strong password. Wrangler must already be logged in. Then run:

```sh
npm run setup:admin
```

The setup script inserts a PBKDF2 password hash and boolean permission flags into D1. Keep `.env` private; it is ignored by Git.

## Run and deploy

Run the Worker API and Vite frontend in separate terminals:

```sh
npx wrangler dev --port 8787
npm run dev:worker
```

Build and publish the full app to a Cloudflare Workers URL:

```sh
npm run deploy
```

The first successful deploy prints the public `workers.dev` URL. The D1 binding and SQL migration are configured in `wrangler.toml` and `worker/migrations/0001_initial.sql`.

## API routes

- `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/products` (productsRead)
- `POST /api/products`, `PUT /api/products/:id` (productsWrite)
- `GET /api/employees` (employeesRead; admins bypass employee flags)
- `PUT /api/employees/:id/permissions` (admin only)
- `GET /api/analytics` (analyticsRead)
- `POST /api/sales` (salesCreate)

Permissions are saved as booleans in each user's `permissions_json`: `productsRead`, `productsWrite`, `salesCreate`, `employeesRead`, and `analyticsRead`. Admin users bypass employee permission flags. Product categories are `Men`, `Women`, and `Kids`; colors accept arbitrary user-entered names.

## Existing MongoDB data

The current MongoDB database is not automatically copied into D1. The D1 setup starts with empty tables; products and employees must be re-entered or migrated with a separate export/import step. MongoDB Atlas App Services Data API reached end of life on September 30, 2025, which is why this deployment uses D1 instead.
