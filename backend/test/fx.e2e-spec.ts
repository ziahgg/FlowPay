import { randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AccountBalanceDto } from '../src/accounts/dto/account-balance.dto';
import { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { ConvertResponseDto } from '../src/fx/dto/convert-response.dto';
import { QuoteResponseDto } from '../src/fx/dto/quote-response.dto';
import { RatesResponseDto } from '../src/fx/dto/rates-response.dto';

// Only one user is registered for this whole file (auth's /register is throttled to 5/min per
// IP); every test tops itself up with deposits (not throttled) as needed. Rate values themselves
// are never asserted against a hardcoded number -- CoinGeckoRateProvider may or may not reach the
// real network in CI, and RatesService transparently falls back to StaticRateProvider either way,
// so assertions only rely on internal consistency (the quote and convert agreeing, balances moving
// by exactly the posted amounts, per-currency debits == credits).
describe('FX conversion (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let user: { email: string; token: string };

  const runId = randomUUID();
  const password = 'password123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    dataSource = app.get<DataSource>(getDataSourceToken());

    const email = `e2e-fx-${runId}@example.com`;
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password });
    user = { email, token: (res.body as AuthResponseDto).accessToken };

    await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currency: 'USD', amount: '1000.00' });
  });

  afterAll(async () => {
    const pattern = `%${runId}%`;
    await dataSource.query(
      `DELETE FROM idempotency_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern],
    );
    await dataSource.query(
      `DELETE FROM journal_lines WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      [pattern],
    );
    await dataSource.query(
      `DELETE FROM account_balances WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1))`,
      [pattern],
    );
    await dataSource.query(
      `DELETE FROM accounts WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [pattern],
    );
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [pattern]);
    await app.close();
  });

  async function getBalance(token: string, currency: string): Promise<string | undefined> {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`);
    const balances = res.body as AccountBalanceDto[];
    return balances.find((b) => b.currency === currency)?.balance;
  }

  describe('GET /fx/rates', () => {
    it('returns a USD-anchored price list and a full pairwise matrix, unauthenticated', async () => {
      const res = await request(app.getHttpServer() as Server).get('/api/v1/fx/rates');

      expect(res.status).toBe(200);
      const body = res.body as RatesResponseDto;
      expect(body.base).toBe('USD');
      expect(body.prices.USD).toBe('1');
      expect(body.prices.BTC).toBeDefined();
      expect(body.matrix.USD.BTC).toBeDefined();
      expect(new Decimal(body.matrix.USD.BTC)).toEqual(
        new Decimal(1).dividedBy(new Decimal(body.matrix.BTC.USD)),
      );
    });
  });

  describe('GET /fx/quote', () => {
    it('returns a quote whose toAmount matches amount * netRate, rounded to the target decimals', async () => {
      const res = await request(app.getHttpServer() as Server).get(
        '/api/v1/fx/quote?from=USD&to=BTC&amount=100',
      );

      expect(res.status).toBe(200);
      const body = res.body as QuoteResponseDto;
      expect(body.from).toBe('USD');
      expect(body.to).toBe('BTC');
      expect(new Decimal(body.netRate)).toEqual(
        new Decimal(body.rate).times(
          new Decimal(1).minus(new Decimal(body.spreadBps).dividedBy(10_000)),
        ),
      );
      const expectedToAmount = new Decimal(body.amount)
        .times(body.netRate)
        .toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN)
        .toFixed(8);
      expect(body.toAmount).toBe(expectedToAmount);
      expect(new Date(body.quoteExpiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects converting a currency to itself (422)', async () => {
      const res = await request(app.getHttpServer() as Server).get(
        '/api/v1/fx/quote?from=USD&to=USD&amount=10',
      );
      expect(res.status).toBe(422);
    });
  });

  describe('POST /fx/convert', () => {
    it('rejects a request with no Idempotency-Key header (400)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/fx/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ from: 'USD', to: 'BTC', amount: '10' });

      expect(res.status).toBe(400);
    });

    it('converts funds and posts a balanced multi-currency ledger entry', async () => {
      const usdBefore = await getBalance(user.token, 'USD');
      const btcBefore = (await getBalance(user.token, 'BTC')) ?? '0.00000000';

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/fx/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ from: 'USD', to: 'BTC', amount: '100.00' });

      expect(res.status).toBe(201);
      const body = res.body as ConvertResponseDto;
      expect(body.from).toBe('USD');
      expect(body.to).toBe('BTC');
      expect(body.amount).toBe('100.00');

      const expectedUsdAfter = new Decimal(usdBefore!).minus('100.00').toFixed(8);
      expect(body.fromBalance).toBe(expectedUsdAfter);
      expect(await getBalance(user.token, 'USD')).toBe(expectedUsdAfter);

      const expectedBtcAfter = new Decimal(btcBefore).plus(body.toAmount).toFixed(8);
      expect(body.toBalance).toBe(expectedBtcAfter);
      expect(await getBalance(user.token, 'BTC')).toBe(expectedBtcAfter);

      // Per-currency invariant: the fx_convert entry must balance independently for USD and BTC.
      const lines = await dataSource.query<
        { currency_code: string; direction: string; amount: string }[]
      >(`SELECT currency_code, direction, amount FROM journal_lines WHERE entry_id = $1`, [
        body.entryId,
      ]);
      const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
      for (const line of lines) {
        const bucket = totals.get(line.currency_code) ?? {
          debit: new Decimal(0),
          credit: new Decimal(0),
        };
        if (line.direction === 'debit') {
          bucket.debit = bucket.debit.plus(line.amount);
        } else {
          bucket.credit = bucket.credit.plus(line.amount);
        }
        totals.set(line.currency_code, bucket);
      }
      expect(totals.size).toBe(2);
      for (const { debit, credit } of totals.values()) {
        expect(debit.equals(credit)).toBe(true);
      }
    });

    it('rejects a conversion that would overdraw the wallet (422)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/fx/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ from: 'USD', to: 'BTC', amount: '999999999.00' });

      expect(res.status).toBe(422);
    });

    it('replays a byte-identical response and posts exactly one entry for a repeated key + payload', async () => {
      const key = randomUUID();
      const payload = { from: 'USD', to: 'EUR', amount: '10.00' };
      const usdBefore = await getBalance(user.token, 'USD');

      const first = await request(app.getHttpServer() as Server)
        .post('/api/v1/fx/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', key)
        .send(payload);
      const second = await request(app.getHttpServer() as Server)
        .post('/api/v1/fx/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);

      const usdAfter = await getBalance(user.token, 'USD');
      expect(new Decimal(usdBefore!).minus(usdAfter!).toFixed(8)).toBe('10.00000000');
    });
  });
});
