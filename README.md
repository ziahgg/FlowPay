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

## Deposits & withdrawals quickstart

Deposits are simulated and instant. Withdrawals follow a maker-checker (two-step approval) pattern
standard in regulated payment institutions: the user's request immediately **holds** the funds so
they can't be double-spent while pending, and a separate admin decision either **settles** (moves
the hold to treasury) or **releases** (returns the hold to the user's wallet) it.

```bash
# deposit (instant, capped by DEPOSIT_MAX_AMOUNT)
curl -X POST http://localhost:3000/api/v1/deposits \
  -H "Content-Type: application/json" -H "Authorization: Bearer <accessToken>" \
  -d '{"currency":"USD","amount":"200.00"}'
# => { "currency": "USD", "amount": "200.00", "balance": "200.00000000" }

# request a withdrawal -- funds are held immediately
curl -X POST http://localhost:3000/api/v1/withdrawals \
  -H "Content-Type: application/json" -H "Authorization: Bearer <accessToken>" \
  -d '{"currency":"USD","amount":"50.00","destination":"IBAN-SIMULATED-123"}'
# => { "id": "...", "status": "pending", "holdEntryId": "...", ... }

# own withdrawal history
curl http://localhost:3000/api/v1/withdrawals -H "Authorization: Bearer <accessToken>"

# admin: list pending requests
curl "http://localhost:3000/api/v1/admin/withdrawals?status=pending" \
  -H "Authorization: Bearer <adminAccessToken>"

# admin: approve (settles the hold to treasury) or reject (releases it back to the wallet)
curl -X POST http://localhost:3000/api/v1/admin/withdrawals/<id>/approve -H "Authorization: Bearer <adminAccessToken>"
curl -X POST http://localhost:3000/api/v1/admin/withdrawals/<id>/reject  -H "Authorization: Bearer <adminAccessToken>"
```

A deposit above `DEPOSIT_MAX_AMOUNT` returns `400`; a withdrawal request that would overdraft the
wallet returns `422`; a non-admin calling approve/reject returns `403`; deciding an
already-decided request returns `409` (the second admin's `SELECT ... FOR UPDATE` blocks until the
first's transaction commits, then re-reads the now-decided row and fails the pending-status check).

## Transfers quickstart

Instant transfers between users. `Idempotency-Key` is required on every request — this is the
flagship demonstration of safe-retry semantics in the API (see the design section below).

```bash
# transfer funds -- the Idempotency-Key header is required
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Content-Type: application/json" -H "Authorization: Bearer <accessToken>" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"recipientEmail":"jane@example.com","currency":"USD","amount":"25.00","note":"lunch"}'
# => { "entryId": "...", "currency": "USD", "amount": "25.00", "balance": "175.00000000" }
# (never the recipient's balance -- see below)

# own transfer history, sent and received
curl http://localhost:3000/api/v1/transfers -H "Authorization: Bearer <accessToken>"
```

Retrying the **exact same request** with the **same key** (e.g. because the client didn't see the
first response) is safe: it returns the identical cached response and never posts a second ledger
entry. Reusing the same key with a **different** payload is rejected (`422`) rather than silently
executing the new request.

### Payments: idempotency & concurrency

- **`Idempotency-Key` is required** on `POST /transfers` (`400` if missing). The key is scoped to
  `(user_id, key)` — two different users may reuse the same literal key string without conflict.
- **How a key is claimed.** `IdempotencyService.run()` first does an immediately-committed
  `INSERT INTO idempotency_keys ... ON CONFLICT (user_id, key) DO NOTHING` — a real mutual-exclusion
  lock, deliberately committed *before* the transfer's own transaction starts (not as part of it).
  Whichever request wins the insert runs the handler; every other concurrent request with the same
  key sees the row and either gets `409` (still `processing`) or the cached `{statusCode, body}`
  once it's `completed`.
  - This module is written as reusable infrastructure (`common/idempotency/`), not something
    transfer-specific — FX conversion will use the same `IdempotencyService.run()` later.
- **What gets cached.** Every *completed* outcome is cached and replayed byte-identical on a
  retry — including a deterministic rejection like insufficient funds (`422`) or an unknown
  recipient (`404`). This matches how idempotency keys behave in the systems it's modeled on
  (Stripe, etc.): the key represents one attempt at *this exact operation*, so if it failed for a
  reason tied to the payload, retrying with the same key replays the same failure — the client
  must use a new key to genuinely try again (e.g. after depositing more funds). An *unexpected*
  (non-`HttpException`) error is **not** cached: the key is deleted instead, so a real retry can
  actually re-attempt the operation rather than being poisoned by an infrastructure blip.
- **Known trade-off, stated plainly.** Marking a key `processing` and later marking it `completed`
  are two separate commits, on purpose — that's what lets a concurrent duplicate get a fast `409`
  instead of blocking for the full duration of the transfer's own transaction. The cost: a crash
  between those two commits leaves the row stuck at `processing` forever, with no automatic
  recovery. Mitigation, not elimination: `IDEMPOTENCY_STALE_MS` (default 30s) — a `processing` row
  older than that is treated as abandoned and reclaimed on the next attempt with that key, instead
  of returning `409` indefinitely. A proper fix (an outbox/saga that guarantees the ledger commit
  and the key's completion move together) is out of scope here.
- **The ledger entry itself** is a normal `LedgerService.postEntry()` — debit sender wallet, credit
  recipient wallet, and (only when `TRANSFER_FEE_FLAT` is nonzero) a third line crediting
  `fees[currency]`. The fee is additive: the sender is debited `amount + fee`, the recipient always
  receives exactly `amount`. This composes with everything in the ledger's own design section
  above — same sign convention, same per-currency balancing, same overdraft guard.
- **Concurrency is tested at the HTTP layer**, not just the ledger: `N` parallel requests with the
  *same* idempotency key produce exactly one journal entry; `N` parallel *distinct* transfers that
  jointly exceed a wallet's balance let exactly the affordable subset through, and the balance
  never goes negative.

## Known simplifications

- **No refresh tokens.** Access tokens are short-lived (15 minutes, `JWT_EXPIRES_IN`) and there is
  no refresh-token flow — once a token expires, the client must log in again. This is intentionally
  out of scope for now.
- **The ledger integration suite (`npm run test:integration`) requires a local Docker daemon** — it
  spins up a real, disposable Postgres via Testcontainers. It is not wired into `.gitlab-ci.yml`
  because the current CI runner image (`node:20`) has no Docker socket available; running it in CI
  would need a Docker-in-Docker-enabled runner.
- **`withdrawal_requests.settle_entry_id` is reused for both outcomes**: it holds the settle entry
  id on approval and the release entry id on rejection (there is no separate `release_entry_id`
  column), matching the originally specified schema.
- **An idempotency key can get stuck `processing`** if the process crashes between committing the
  underlying operation and marking the key `completed` (see "Payments: idempotency & concurrency"
  above). `IDEMPOTENCY_STALE_MS` reclaims it on the next attempt rather than blocking forever, but
  this is a mitigation, not a full fix — a proper fix needs an outbox/saga pattern, out of scope here.

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
