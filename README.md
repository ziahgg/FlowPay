# FlowPay

FlowPay is a portfolio-grade **simulated** crypto & fiat payment and trading platform, modeled on
the architecture of regulated payment institutions. All money, transfers, and market activity are
simulated in Postgres — there is no real currency and no real blockchain involved. The backend is
a NestJS modular monolith (designed so modules can later be split into microservices); the
frontend (Angular) will be added in a later step.

## Quickstart

Requirements: Docker and Docker Compose.

```bash
# bring up Postgres + the API (with hot reload)
docker compose up

# API is now available at:
curl http://localhost:3000/api/v1/health
# => { "status": "ok", "db": "up" }
```

## Backend development (without Docker)

```bash
cd backend
cp .env.example .env   # point DB_HOST etc. at your own Postgres instance
npm install
npm run migration:run  # applies any pending schema migrations
npm run seed            # idempotent: creates admin@flowpay.dev if missing
npm run start:dev
```

## Auth quickstart

```bash
# register a new user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"password123"}'
# => { "accessToken": "...", "user": { "id": "...", "email": "jane@example.com", "role": "user", ... } }

# log in
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"password123"}'
# => { "accessToken": "...", "user": { ... } }

# fetch the current user profile
curl http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer <accessToken>"
# => { "id": "...", "email": "jane@example.com", "role": "user", "createdAt": "...", "updatedAt": "..." }
```

Wrong password returns `401`, a duplicate email on register returns `409`, and hammering either
auth endpoint more than 5 times per minute from the same IP returns `429`.

## Known simplifications

- **No refresh tokens.** Access tokens are short-lived (15 minutes, `JWT_EXPIRES_IN`) and there is
  no refresh-token flow — once a token expires, the client must log in again. This is intentionally
  out of scope for now.

Useful scripts (run from `backend/`):

| Command                    | Description                                   |
| --------------------------- | ---------------------------------------------- |
| `npm run start:dev`         | Start the API with hot reload                  |
| `npm run lint`               | ESLint over `src` and `test`                   |
| `npm run test`               | Unit tests (Jest)                              |
| `npm run test:e2e`           | End-to-end tests against a real Postgres       |
| `npm run migration:generate` | Generate a migration from entity changes       |
| `npm run migration:run`      | Apply pending migrations                       |
| `npm run migration:revert`   | Revert the last applied migration              |
| `npm run seed`                | Idempotently seed the dev admin user           |

See [CLAUDE.md](CLAUDE.md) for architecture and the hard conventions this project follows.
