# FlowPay

## Purpose

FlowPay is a portfolio-grade **simulated** crypto & fiat payment and trading platform, inspired by
the architecture of regulated payment institutions (e.g. e-money / payment institutions). All
money, balances, "blockchain" transfers, and trading activity are simulated inside Postgres —
**no real currency, no real blockchain, no real market connectivity.** The goal is to demonstrate
production-grade backend engineering practices (ledger correctness, migrations discipline, testing
rigor, observability) rather than to move real value.

## Architecture

FlowPay is built as a **modular monolith, deliberately**. Every domain area (accounts, ledger,
payments, trading, KYC, etc.) lives in its own NestJS module with a clear boundary — its own
controllers, services, DTOs, and entities. Modules talk to each other through injected services,
not by reaching into each other's internals or database tables.

This is deliberate preparation for splitting into microservices later: if a module only ever
depends on other modules through well-defined service interfaces, extracting it behind an HTTP or
message-queue boundary later is a refactor, not a rewrite. When adding a new module, ask "if this
had to become its own service tomorrow, what would its API be?" and shape the module boundary
around that answer.

```
backend/src/
  common/        cross-cutting concerns: config, logging, exception filters, middleware
  database/      TypeORM wiring (DataSource, TypeOrmModule.forRootAsync)
  migrations/    every schema change, as explicit TypeORM migration files
  health/        liveness/readiness endpoint
  <domain>/      one folder per bounded context (accounts, ledger, payments, ...)
    <domain>.module.ts
    <domain>.controller.ts
    <domain>.service.ts
    dto/
    entities/
    <domain>.service.spec.ts
```

`frontend/` will be an Angular application added in a later step. It is currently a placeholder.

## Tech stack

- **Backend**: NestJS 10+, TypeScript (strict mode), Express platform
- **Database**: PostgreSQL 16 via TypeORM (`synchronize: false`, migrations only)
- **Validation**: `class-validator` / `class-transformer` for request DTOs, `zod` for environment
  config validated at startup
- **Logging**: `nestjs-pino` (structured JSON logs), correlated by a request-id middleware
- **Testing**: Jest for unit tests, a separate Jest e2e config against a real Postgres instance
- **Lint/format**: ESLint (flat config, typescript-eslint) + Prettier
- **CI**: GitLab CI, stages `lint -> test -> build`, `test` stage runs against a real `postgres`
  service container
- **Containers**: Docker Compose for local dev (Postgres + backend with hot reload)

## Hard conventions (do not violate)

1. **No floating point for money, anywhere.**
   - Postgres columns storing monetary/quantity amounts are `NUMERIC(precision, scale)`, never
     `FLOAT`/`DOUBLE PRECISION`/`REAL`.
   - Amounts crossing process boundaries (HTTP JSON, logs) are **decimal strings**, never JS
     `number`.
   - Internally, all arithmetic on money/quantities goes through `decimal.js`
     (`new Decimal(...)`), never native `+`/`-`/`*`/`/` on numbers.
   - This applies to fiat amounts, crypto amounts, prices, fees, and FX rates without exception.

2. **All schema changes go through explicit migrations.**
   - `synchronize` is `false` everywhere, including local dev.
   - Every schema change is a file in `backend/src/migrations/`, generated with
     `npm run migration:generate -- src/migrations/<Name>` (or handwritten when generation isn't
     applicable) and reviewed like any other code change.
   - Never edit a migration that has already been merged; write a new one.

3. **Every feature ships with tests before it is considered done.**
   - New services/controllers get unit tests (Jest, mocking the database/repositories).
   - New endpoints that touch the database get an e2e test against a real Postgres instance.
   - A PR that adds behavior without a corresponding test is incomplete, not "done, tests later."

4. **Module layout and naming**
   - One module per bounded context, named after the domain (`ledger`, `payments`, `trading`, not
     generic names like `core` or `utils`).
   - Inside a module: `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`,
     `dto/*.dto.ts`, `entities/*.entity.ts`, `<name>.service.spec.ts` next to the file it tests.
   - Cross-cutting infrastructure (config, logging, filters, interceptors, middleware) lives in
     `common/`, not duplicated per module.
   - All HTTP routes are served under the `/api/v1` prefix (set globally in `main.ts`); breaking
     API changes get a new version prefix, not a mutated `v1`.
   - Environment variables are declared once in `common/config/env.schema.ts` (zod) and validated
     at startup — a missing/invalid env var must fail fast, not silently default in a way that
     hides misconfiguration.

5. **Auth & response shaping**
   - Passwords are hashed with `argon2` (never stored or logged in plaintext); access tokens are
     JWTs signed with `JWT_SECRET`, 15 minutes by default (`JWT_EXPIRES_IN`). There is no refresh
     token — see "Known simplifications" in [README.md](README.md).
   - Services never return TypeORM entities directly from a controller. Any entity with sensitive
     columns (e.g. `password_hash`) exposes an explicit mapping method (e.g. `toProfile()`) that
     returns a plain response DTO — this is the only path a controller may return to the client.
   - Sensitive/mutating endpoints (auth, and anything similar later) are rate-limited with
     `@nestjs/throttler`, applied locally via `@UseGuards(ThrottlerGuard)` on the owning controller
     rather than globally, so unrelated endpoints aren't throttled by default.
   - `JwtAuthGuard` (route auth) and `RolesGuard` + `@Roles(...)` (authorization) are separate
     guards, composed as `@UseGuards(JwtAuthGuard, RolesGuard)` on any endpoint that needs both.
   - One-off idempotent scripts (e.g. dev/admin seeding) live in `src/scripts/`, run via
     `ts-node src/scripts/<name>.ts` (see `npm run seed`). Scripts that only need plain repository
     access reuse the `DataSource` exported from `src/typeorm.config.ts`; scripts that must enforce
     business rules owned by a service (e.g. creating ledger accounts) instead bootstrap a Nest
     application context (`NestFactory.createApplicationContext(AppModule)`) and call that service
     — never reimplement its logic against the tables directly.

6. **The ledger is append-only and has exactly one write path.**
   - `journal_entries`, `journal_lines`, and `account_balances` are written **only** through
     `LedgerService.postEntry()` (entries/lines + the derived balance update, atomically) and
     `LedgerService.ensureAccount()` (account + its zero balance row, atomically). No migration,
     seed script, or other module may `INSERT`/`UPDATE` those tables directly — this is what keeps
     "cached balance == SUM(journal lines)" true everywhere, forever.
   - The journal is the source of truth; `account_balances` is a derived cache maintained
     transactionally alongside every entry. If the two ever disagree, the journal wins.
   - Every account uses the same sign convention: `balance = Σ(credit lines) − Σ(debit lines)`.
     There is no per-kind flipping — this is what makes "treasury can go negative" fall out
     naturally (it's the system's mirror image of what users hold) instead of being special-cased.
   - A journal entry must balance to zero **per currency** independently, not just in aggregate —
     required for future multi-currency entries (FX conversion, etc.) to be caught if malformed.
   - `postEntry` locks the `account_balances` rows it touches with `SELECT ... FOR UPDATE`,
     ordered by ascending account id in one statement — Postgres's own documented pattern for
     avoiding deadlocks when transactions lock overlapping sets of rows in different orders.
   - Accounts with a non-null `owner_user_id` (user wallets) may never go negative; accounts with a
     null `owner_user_id` (treasury, fees, withdrawal_pending) may — they represent the platform's
     counterparty position, not a user's funds.
   - `postEntry()` takes an optional trailing `EntityManager`. Pass one whenever the entry must be
     atomic with a write to another module's own table (e.g. a withdrawal request row) — see
     `WithdrawalsService.approve()`/`reject()`, which lock the request row with
     `manager.findOne(..., { lock: { mode: 'pessimistic_write' } })` and pass that same `manager`
     into `postEntry()`, so the lock, the entry, and the status update commit or roll back
     together. Without this, a maker-checker guard's row lock would be meaningless — locks only
     matter within the same transaction. Omit the manager for a standalone entry (e.g. a deposit)
     and `postEntry()` opens and owns its own transaction.

## Local development

See [README.md](README.md) for the quickstart. In short: `docker compose up` brings up Postgres +
the API with hot reload; `npm run lint`, `npm run test`, and `npm run test:e2e` run inside
`backend/`. `npm run test:integration` runs the Testcontainers-backed ledger integration suite and
requires a local Docker daemon (see "Known simplifications" in [README.md](README.md)).
