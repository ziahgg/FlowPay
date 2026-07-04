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

## Ledger quickstart

`npm run seed` creates five currencies (USD, EUR, IDR, BTC, ETH) and their system accounts
(treasury/fees/withdrawal_pending, one set per currency). User wallets are created lazily the first
time they're touched.

```bash
# current user's balances across all currencies (wallets created on first access)
curl http://localhost:3000/api/v1/accounts -H "Authorization: Bearer <accessToken>"
# => [{ "currency": "USD", "balance": "0.00000000", "decimals": 2 }, { "currency": "BTC", ... }, ...]

# paginated journal history for one currency's wallet
curl "http://localhost:3000/api/v1/accounts/USD/transactions?page=1&limit=20" \
  -H "Authorization: Bearer <accessToken>"
# => { "data": [{ "type": "deposit", "direction": "credit", "amount": "...", "description": "...", "createdAt": "..." }], "meta": { "page": 1, "limit": 20, "total": 1 } }
```

### Design decisions

- **The journal is the source of truth.** `account_balances` is a cache maintained transactionally
  alongside every journal entry, purely for read performance — if it and the sum of
  `journal_lines` ever disagreed, the journal would win. The integration test suite asserts this
  invariant after every operation.
- **Every account uses one sign convention:** `balance = Σ(credit lines) − Σ(debit lines)`, with no
  per-account-kind flipping. A deposit is *credit user wallet / debit treasury*; a withdrawal
  settlement reverses it. This is what makes "treasury can go negative" fall out naturally, rather
  than needing a special case: since every entry balances to zero, and user wallets are bounded at
  zero from below, treasury/fees necessarily absorb the mirror image of what users hold.
- **Entries balance per currency, independently** — not just in aggregate — so a future
  multi-currency entry (e.g. an FX conversion posting both legs at once) can't sneak an imbalance in
  one currency past a balanced-looking total.
- **Deterministic lock ordering.** `postEntry` takes `SELECT ... FOR UPDATE` locks on the
  `account_balances` rows it will update, in one statement ordered by ascending account id. This is
  Postgres's own documented deadlock-avoidance pattern for transactions that lock overlapping sets
  of rows in different orders.
- **User accounts can't go negative; system accounts can.** Any account with a non-null
  `owner_user_id` is rejected (422) if a proposed entry would take it below zero. Accounts with a
  null `owner_user_id` (treasury, fees, withdrawal_pending) are exempt — they represent the
  platform's simulated counterparty position, not a real user's funds.
- **One write path.** All other modules call `LedgerService.postEntry()` / `ensureAccount()` —
  nothing else touches `journal_entries`, `journal_lines`, or `account_balances`. See CLAUDE.md.

## Known simplifications

- **No refresh tokens.** Access tokens are short-lived (15 minutes, `JWT_EXPIRES_IN`) and there is
  no refresh-token flow — once a token expires, the client must log in again. This is intentionally
  out of scope for now.
- **The ledger integration suite (`npm run test:integration`) requires a local Docker daemon** — it
  spins up a real, disposable Postgres via Testcontainers. It is not wired into `.gitlab-ci.yml`
  because the current CI runner image (`node:20`) has no Docker socket available; running it in CI
  would need a Docker-in-Docker-enabled runner.

Useful scripts (run from `backend/`):

| Command                    | Description                                   |
| --------------------------- | ---------------------------------------------- |
| `npm run start:dev`         | Start the API with hot reload                  |
| `npm run lint`               | ESLint over `src` and `test`                   |
| `npm run test`               | Unit tests (Jest)                              |
| `npm run test:e2e`           | End-to-end tests against a real Postgres       |
| `npm run test:integration`   | Ledger integration tests (Testcontainers, needs Docker) |
| `npm run migration:generate` | Generate a migration from entity changes       |
| `npm run migration:run`      | Apply pending migrations                       |
| `npm run migration:revert`   | Revert the last applied migration              |
| `npm run seed`                | Idempotently seed the dev admin user + ledger  |

See [CLAUDE.md](CLAUDE.md) for architecture and the hard conventions this project follows.
