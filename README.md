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
npm run start:dev
```

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

See [CLAUDE.md](CLAUDE.md) for architecture and the hard conventions this project follows.
