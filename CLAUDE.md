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

`frontend/` is the Angular "Client Console" — a standalone-components SPA that talks to the backend
only through `/api/v1`, proxied in dev (see `frontend/proxy.conf.js`) so the browser's requests are
same-origin and never touch CORS at all. The backend does enable CORS (`CORS_ORIGIN`, an env-driven
allowlist -- see `main.ts`) for the case of a frontend served from a different origin than the API
(e.g. a production deployment), but that's a separate, additive concern from the dev proxy.

```
frontend/src/app/
  core/          singletons: models (mirror backend DTOs exactly), one *.service.ts per backend
                 module, functional interceptors (auth, error), functional guards (auth/admin/guest)
  shared/        reusable presentational components (dialogs, cards, chips) and pipes
  features/      one folder per page/route (auth, dashboard, transactions, withdrawals, transfer,
                 convert, trade, admin), lazy-loaded via `loadComponent` in app.routes.ts
```

## Tech stack

- **Backend**: NestJS 10+, TypeScript (strict mode), Express platform
- **Database**: PostgreSQL 16 via TypeORM (`synchronize: false`, migrations only)
- **Validation**: `class-validator` / `class-transformer` for request DTOs, `zod` for environment
  config validated at startup
- **Logging**: `nestjs-pino` (structured JSON logs), correlated by a request-id middleware
- **Testing**: Jest for unit tests, a separate Jest e2e config against a real Postgres instance
- **Lint/format**: ESLint (flat config, typescript-eslint) + Prettier
- **Frontend**: Angular 22, standalone components, Angular Material (Material 3 theming), signals
  for local component state, Vitest for unit tests (no Karma/Chrome dependency)
- **CI**: GitLab CI, stages `lint -> test -> build`, backend `test` stage runs against a real
  `postgres` service container; frontend jobs run the same three stages independently
- **Containers**: Docker Compose for local dev (Postgres + backend + frontend, all with hot reload)

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
     this is what lets FX conversion's 4-line, 2-currency entries be caught if malformed instead of
     silently passing on a bogus aggregate-only check.
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

7. **Money-moving POST endpoints that a client might retry are idempotent via `IdempotencyService`.**
   - `common/idempotency/` is reusable infrastructure (used by transfers and FX conversion) — it is
     not specific to any one feature module.
   - The controller requires an `Idempotency-Key` header (400 if missing) and the service wraps
     the actual handler in `IdempotencyService.run({ userId, key, endpoint, requestPayload,
     successStatus, handler })`.
   - Mechanically: an immediately-committed `INSERT ... ON CONFLICT (user_id, key) DO NOTHING`
     claims the key before the handler runs (a fast, real mutual-exclusion lock, deliberately not
     part of the handler's own transaction — see the crash trade-off below); a concurrent duplicate
     that loses the race gets 409 while the first is still `processing`, or a replayed
     `{statusCode, body}` once it's `completed`. A different payload under the same key is a 422.
   - Every completed outcome is cached and replayed byte-identical on retry — including a
     deterministic `HttpException` (e.g. insufficient funds, unknown recipient): that's the correct
     idempotency semantics (matches Stripe et al.), not a bug. An *unexpected* (non-`HttpException`)
     error deletes the key instead, so a genuine retry can actually re-attempt the operation.
   - Known trade-off: marking `processing` and marking `completed` are separate commits on purpose
     (so a concurrent duplicate gets a fast 409 instead of blocking on the handler's transaction).
     This means a crash between them leaves a stuck `processing` row. Mitigated, not eliminated, by
     `IDEMPOTENCY_STALE_MS`: a `processing` row older than that threshold is reclaimed on the next
     attempt with that key instead of returning 409 forever.

8. **Frontend conventions**
   - Every model in `core/models/` mirrors a backend response/request DTO field-for-field
     (including which fields are decimal *strings*) — the frontend never redefines the API
     contract, it copies it.
   - `AuthService` holds the JWT + `UserProfileDto` from login/register as one JSON blob in
     `localStorage`, exposed as signals (`currentUser`, `isAuthenticated`, `isAdmin`). This is
     explicitly a demo-grade trade-off vs an httpOnly cookie — see "Known simplifications" in
     [README.md](README.md).
   - `authInterceptor` (attaches `Authorization`) and `errorInterceptor` (toasts every
     `HttpErrorResponse`, logs out and redirects on 401) are functional interceptors registered via
     `provideHttpClient(withInterceptors([...]))`, not classes.
   - `authGuard`/`adminGuard`/`guestGuard` are functional `CanActivateFn`s, not `CanActivate`
     classes — same reasoning as the interceptors: less boilerplate, no DI token indirection.
   - **Never reset a submitted `[formGroup]` with `this.form.reset(value)` alone.** `reset()` only
     clears the `FormGroup`'s own value/touched/dirty state; the enclosing `FormGroupDirective`
     keeps its `submitted` flag `true` from the earlier submit, and Material's default
     `ErrorStateMatcher` treats `submitted` like `touched` — so the freshly-cleared required fields
     immediately render as invalid with no user interaction. Inject the directive
     (`@ViewChild(FormGroupDirective)`) and call `formDirective.resetForm(value)` instead, which
     resets both together. (Caught by manually exercising the transfer form after a successful
     send — the empty recipient/amount fields lit up red immediately; re-caught the same way on the
     Trade page's order form, confirming this is a recurring trap worth checking on every new form.)
   - The transfer form's Idempotency-Key handling is the reference implementation for any future
     retryable mutation: generate the key with `crypto.randomUUID()` on the *first* attempt of a
     logical operation, hold it in a plain field (not a signal — it doesn't drive the template),
     reuse it across retries triggered by a network error (`HttpErrorResponse.status === 0`), and
     clear it on success or on any definitive server response (a real 4xx/5xx means the server
     already decided, so the *next* attempt is a new logical operation and needs a new key). The
     Convert page reuses this exact pattern.

9. **FX rate sourcing and conversion math.**
   - `RateProvider` (`rates/interfaces/rate-provider.interface.ts`) is a strategy interface —
     `CoinGeckoRateProvider` (live, public API, no key) and `StaticRateProvider` (hardcoded
     fallback) — both returning USD-anchored prices (`Map<currencyCode, Decimal>`, USD always `1`).
     `RatesService` is the only thing that decides which provider's result to trust: it caches a
     snapshot for `RATE_CACHE_TTL_MS` and, on any live-provider failure, falls back to the static
     provider and logs a warning rather than failing the request — the app must keep working
     offline. Never call a `RateProvider` directly from a controller or another module; go through
     `RatesService`.
   - USD is the fixed anchor currency; a pair's rate is always `usdPrice(from) / usdPrice(to)`.
     Fiat currencies that CoinGecko can't price directly against one another (there's no fiat/fiat
     pair in its API) are bridged through BTC — see "FX conversion quickstart" in
     [README.md](README.md) for the exact derivation. This is hardcoded to the app's fixed
     5-currency universe; do not generalize it into an N-currency client without a real reason to.
   - `FxService`'s quote math (spread via `FX_SPREAD_BPS`, rounding) lives in one private method
     shared by `GET /fx/quote` and `POST /fx/convert` — never duplicate the calculation between
     them, or a quote can silently drift from what convert actually executes.
   - All rounding to a currency's native `decimals` uses `Decimal.ROUND_HALF_EVEN` (banker's
     rounding), applied via `decimal.js`'s `toDecimalPlaces`/`toFixed` — chosen because it doesn't
     bias amounts in one direction over many conversions. Use this rounding mode for any future
     money computation that must truncate to a currency's precision, not `ROUND_HALF_UP`.
   - `POST /fx/convert` posts one atomic 4-line entry via `TradeExecutionService.executeSwap()`
     (debit user[from]/credit treasury[from], debit treasury[to]/credit user[to] at the net rate) —
     the spread is never a separate fee line, it's the implicit difference between what the
     treasury receives and what it gives up. It reuses `IdempotencyService` exactly like transfers
     (see convention 7); do not build a second idempotency mechanism for money-moving FX-adjacent
     features.

10. **Trading (orders): shared swap execution, hold/fill/release, and the cancel-vs-fill race guard.**
    - `TradeExecutionService` (`common/trade-execution/`) is the *only* place that builds a 2-currency
      ledger swap: debit a `source` account / credit `treasury[source.currency]`, then debit
      `treasury[toCurrency]` / credit the destination user's wallet. FX conversion and every trade
      fill (market or a triggered limit) call `executeSwap()` — never re-duplicate this 4-line
      pattern inline in a feature service. The only thing that varies per caller is the `source`
      account: a user's own wallet for FX conversion and market orders, or the pooled
      `trade_hold[currency]` system account for a filled limit order.
    - Market orders execute immediately at the current `RatesService` rate, with **no spread** —
      deliberately different from FX conversion's `FX_SPREAD_BPS`; trading and FX are separate
      pricing surfaces.
    - A limit order's hold amount is computed by `computeHoldAmount()`/`holdCurrencyCode()`
      (`trading/order-math.util.ts`) and reused verbatim at hold-placement, cancel-release, and
      worker-fill time, so the amount posted to the ledger is always byte-identical to what's
      already sitting in `trade_hold[currency]` — recomputed from the order's own stored
      `quantity`/`limitPrice` rather than stored in an extra column. A triggered limit order fills
      **at its own limit price, not the prevailing market rate**, which is what keeps the hold and
      the fill exactly equal (no partial-release reconciliation needed).
    - The hold/fill/release ledger flow mirrors withdrawals' hold/settle/release (convention 6):
      `TRADE_HOLD` (debit user/credit `trade_hold`) on limit placement, `TRADE` (via
      `TradeExecutionService`) on fill, `TRADE_RELEASE` (debit `trade_hold`/credit user) on cancel.
    - **Cancel-vs-fill is guarded by the same row-lock pattern as the withdrawals maker-checker
      guard**: `OrdersService.cancelOrder()` and `OrdersWorkerService.tryFill()` both lock the order
      row with `manager.findOne(Order, { lock: { mode: 'pessimistic_write' } })` and re-check
      `status === 'open'` before acting, inside the same transaction as the ledger entry. Whichever
      transaction's lock wins commits its outcome; the other sees the already-updated status and
      safely no-ops. Do not add a new "is this order still open" check that isn't inside the same
      locked transaction as the entry it guards — an out-of-transaction check is not a guard.
    - `OrdersWorkerService` is a `@nestjs/schedule` `@Cron` job (ticking every ~10s) that scans
      `status = 'open' AND type = 'limit'` orders and calls the same `tryFill()` used by the
      cancel-vs-fill race tests — there is no separate "worker-only" fill code path to keep in sync.
    - No trading-pairs table: `pair` is a `"BASE/QUOTE"` string split and validated against
      `currencies` at request time (see `trading/pair.util.ts`), matching FX's "any two distinct
      currencies" flexibility rather than a curated whitelist.

11. **Domain events go through the transactional outbox — never publish to Kafka directly.**
    - `OutboxService.append(event, manager)` takes its `EntityManager` as a **required** argument,
      not optional, forcing every call site to append the event inside the same transaction as the
      domain write it describes. This is what makes the outbox pattern's guarantee hold: if the
      transaction commits, the event row is guaranteed to exist; if it rolls back, the event row
      never existed either. Publish-after-commit (two separate steps) can't offer this — a crash
      between them either loses the event or, reordered, publishes a phantom event for a
      transaction that then rolls back. See "Event-driven architecture" in
      [README.md](README.md) for the full write-up and sequence diagram.
    - `OutboxPublisherService` (a `@nestjs/schedule` `@Cron` job, mirroring `OrdersWorkerService`'s
      established pattern) polls `outbox_events WHERE published_at IS NULL` every 5 seconds and
      publishes each row to Kafka's `flowpay.events` topic (keyed by `aggregateId`) in its own
      per-row transaction — lock row, send, mark `published_at`, commit. This yields **at-least-once
      delivery**, not exactly-once: a crash between the Kafka ack and the commit republishes the row
      on the next tick. Every consumer must be idempotent as a consequence — never assume a message
      is delivered exactly once.
    - `notifications/` is the one consumer today (`NotificationsConsumerService`, via `kafkajs`),
      and its module boundary is deliberately narrow: it imports only `KafkaModule` and its own
      `processed_events` table — no `LedgerModule`, `UsersModule`, or other domain module. Every
      value an email template needs (`recipientEmail`, amounts, currencies) must be embedded in the
      event payload by the domain service appending it, since that's the only place a `UsersService`
      lookup is available; the consumer is not allowed to reach back into another module to fetch
      what it's missing. This narrowness is the concrete proof the module could be extracted into
      its own microservice tomorrow with no code changes beyond the deployment boundary.
    - Idempotent consumption uses the exact same atomic-claim idiom as `IdempotencyService`'s
      `idempotency_keys` table (convention 7): `INSERT INTO processed_events (event_id) VALUES ($1)
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`. A losing claim means "already handled,
      no-op"; a winning claim means "mine, proceed." Any future Kafka consumer must dedupe the same
      way — do not assume a topic's delivery semantics will save you from a duplicate.
    - Kafka access goes through `EventProducer`/`EventConsumer` interfaces (`common/kafka/`), never
      `kafkajs` directly from a domain module — the same strategy-interface precedent
      `RateProvider` already set for `RatesService`, and why unit tests fake the broker instead of
      running one (Testcontainers is reserved for Postgres semantics that can't be faked; see
      `outbox-atomicity.integration-spec.ts`).
    - Both `KafkaEventProducer` and `NotificationsConsumerService` connect/subscribe via a
      fire-and-forget retry loop with capped backoff, never an `await`ed call inside
      `onModuleInit()` — Kafka being unreachable at boot must never crash the rest of the app.
      `KafkaEventConsumer` additionally listens for kafkajs's own `CRASH` event and resubscribes
      from scratch, because the client-level `retry: { retries: 0 }` needed for clean shutdown
      (so a dead broker fails fast instead of leaving sockets/timers open past `onModuleDestroy()`)
      also disables kafkajs's default crash-auto-restart as a side effect. Every retry loop cancels
      its own pending timer in `onModuleDestroy()`.

## Local development

See [README.md](README.md) for the quickstart. In short: `docker compose up` brings up Postgres +
Kafka + Mailhog + the API + the Angular dev server, all with hot reload. Backend: `npm run lint`,
`npm run test`, and `npm run test:e2e` run inside `backend/`; `npm run test:integration` runs the
Testcontainers-backed ledger integration suite and requires a local Docker daemon (see "Known
simplifications" in [README.md](README.md)). Frontend: `npm run lint`, `npm test`, and
`npm run build` run inside `frontend/`.

Kubernetes manifests live under `deploy/k8s/` (namespace, ConfigMap/Secret, Postgres, Kafka,
Mailhog, backend Deployment/Service) — see "Deploying to Kubernetes (minikube)" in
[README.md](README.md) for the verified step-by-step. Two things that trip up a first deploy: the
production image (`backend/Dockerfile`) has no `.ts` sources or `ts-node`, so migrations/seeding
against it use `npm run migration:run:prod`/`npm run seed:prod` (plain `typeorm`/`node` against
`dist/`), not the ts-node-based dev scripts; and Kafka's exec-based readiness probe needs an
explicit `timeoutSeconds` well above the default 1s, since `kafka-broker-api-versions.sh` boots its
own JVM per invocation.
