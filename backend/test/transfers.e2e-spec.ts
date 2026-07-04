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
import { PaginatedResponseDto } from '../src/common/dto/paginated-response.dto';
import { hashPayload } from '../src/common/idempotency/hash-payload';
import { TransferHistoryItemDto } from '../src/transfers/dto/transfer-history-item.dto';
import { TransferResponseDto } from '../src/transfers/dto/transfer-response.dto';

// Only two users are registered for this whole file (auth's /register is throttled to 5/min per
// IP); every test below works off relative balance deltas rather than a fresh empty wallet, and
// tops itself up with deposits (not throttled) as needed.
describe('Transfers (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let sender: { email: string; token: string };
  let recipient: { email: string; token: string };

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

    sender = await registerUser('sender');
    recipient = await registerUser('recipient');
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

  async function registerUser(label: string): Promise<{ email: string; token: string }> {
    const email = `e2e-transfer-${label}-${runId}@example.com`;
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password });
    return { email, token: (res.body as AuthResponseDto).accessToken };
  }

  async function deposit(token: string, amount: string): Promise<void> {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'USD', amount });
    expect(res.status).toBe(201);
  }

  // Sweeps the sender's wallet to exactly zero, so a concurrency test can deposit a known amount
  // and assert an exact count of successes -- without this, balances carried over from earlier
  // describes in this file (which share the same two users to stay under the register throttle)
  // would make the assertion depend on run order.
  async function sweepToZero(fromToken: string, toEmail: string): Promise<void> {
    const balance = await getUsdBalance(fromToken);
    if (new Decimal(balance).isZero()) {
      return;
    }
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${fromToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ recipientEmail: toEmail, currency: 'USD', amount: balance });
    expect(res.status).toBe(201);
  }

  async function getUsdBalance(token: string): Promise<string> {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`);
    const balances = res.body as AccountBalanceDto[];
    return balances.find((b) => b.currency === 'USD')!.balance;
  }

  describe('happy path and validation', () => {
    beforeAll(async () => {
      await deposit(sender.token, '200.00');
    });

    it('transfers funds, debiting the sender and crediting the recipient', async () => {
      const balanceBefore = await getUsdBalance(sender.token);
      const recipientBefore = await getUsdBalance(recipient.token);

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '30.00' });

      expect(res.status).toBe(201);
      const body = res.body as TransferResponseDto;
      const expectedBalance = new Decimal(balanceBefore).minus('30.00').toFixed(8);
      expect(body).toMatchObject({ currency: 'USD', amount: '30.00', balance: expectedBalance });
      expect(await getUsdBalance(sender.token)).toBe(expectedBalance);
      expect(await getUsdBalance(recipient.token)).toBe(
        new Decimal(recipientBefore).plus('30.00').toFixed(8),
      );
    });

    it('never exposes the recipient balance in the response', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '5.00' });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('recipientBalance');
      expect(Object.keys(res.body as object).sort()).toEqual(
        ['amount', 'balance', 'currency', 'entryId'].sort(),
      );
    });

    it('rejects a transfer that would overdraw the sender (422)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '999999.00' });

      expect(res.status).toBe(422);
    });

    it('rejects an unknown recipient (404)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ recipientEmail: `nobody-${runId}@example.com`, currency: 'USD', amount: '1.00' });

      expect(res.status).toBe(404);
    });

    it('rejects a request with no Idempotency-Key header (400)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '1.00' });

      expect(res.status).toBe(400);
    });
  });

  describe('idempotency', () => {
    beforeAll(async () => {
      await deposit(sender.token, '200.00');
    });

    it('replays a byte-identical response and posts exactly one entry for a repeated key + payload', async () => {
      const key = randomUUID();
      const payload = { recipientEmail: recipient.email, currency: 'USD', amount: '7.00' };
      const balanceBefore = await getUsdBalance(sender.token);

      const first = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send(payload);
      const second = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);

      const balanceAfter = await getUsdBalance(sender.token);
      expect(new Decimal(balanceBefore).minus(balanceAfter).toFixed(8)).toBe('7.00000000');
    });

    it('rejects re-use of the same key with a different payload (422)', async () => {
      const key = randomUUID();
      await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '2.00' });

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send({ recipientEmail: recipient.email, currency: 'USD', amount: '3.00' });

      expect(res.status).toBe(422);
    });

    it('reclaims a stale processing key past the threshold instead of returning 409 forever', async () => {
      const key = randomUUID();
      const payload = { recipientEmail: recipient.email, currency: 'USD', amount: '1.50' };
      const senderUser = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM users WHERE email = $1`,
        [sender.email],
      );

      // Simulate a crashed request: a 'processing' row far older than IDEMPOTENCY_STALE_MS.
      await dataSource.query(
        `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status, created_at)
         VALUES ($1, $2, $3, $4, 'processing', now() - interval '1 hour')`,
        [key, senderUser[0].id, 'POST /api/v1/transfers', hashPayload(payload)],
      );

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', key)
        .send(payload);

      expect(res.status).toBe(201);
    });

    it("lists sent and received transfers in the caller's own history", async () => {
      const senderHistory = await request(app.getHttpServer() as Server)
        .get('/api/v1/transfers')
        .set('Authorization', `Bearer ${sender.token}`);
      const recipientHistory = await request(app.getHttpServer() as Server)
        .get('/api/v1/transfers')
        .set('Authorization', `Bearer ${recipient.token}`);

      expect(senderHistory.status).toBe(200);
      const senderBody = senderHistory.body as PaginatedResponseDto<TransferHistoryItemDto>;
      expect(senderBody.meta.total).toBeGreaterThan(0);
      expect(senderBody.data.every((item) => item.direction === 'sent')).toBe(true);
      expect(senderBody.data.every((item) => item.counterpartyEmail === recipient.email)).toBe(
        true,
      );

      const recipientBody = recipientHistory.body as PaginatedResponseDto<TransferHistoryItemDto>;
      expect(recipientBody.data.every((item) => item.direction === 'received')).toBe(true);
    });
  });

  describe('concurrency: duplicate key', () => {
    it('creates exactly one entry when the same key + payload is fired in parallel', async () => {
      await deposit(sender.token, '100.00');
      const balanceBefore = await getUsdBalance(sender.token);

      const key = randomUUID();
      const payload = { recipientEmail: recipient.email, currency: 'USD', amount: '20.00' };

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app.getHttpServer() as Server)
            .post('/api/v1/transfers')
            .set('Authorization', `Bearer ${sender.token}`)
            .set('Idempotency-Key', key)
            .send(payload),
        ),
      );

      for (const res of responses) {
        expect([201, 409]).toContain(res.status);
      }

      // Regardless of how many responses were 201 (fresh success or replay) vs 409
      // (in-flight), only one debit should ever have been posted.
      const balanceAfter = await getUsdBalance(sender.token);
      expect(new Decimal(balanceBefore).minus(balanceAfter).toFixed(8)).toBe('20.00000000');
    });
  });

  describe('concurrency: distinct transfers draining one wallet', () => {
    it('lets exactly the affordable subset succeed and never drives the balance negative', async () => {
      await sweepToZero(sender.token, recipient.email);
      await deposit(sender.token, '100.00');
      const balanceBefore = await getUsdBalance(sender.token);
      expect(balanceBefore).toBe('100.00000000');

      const attempts = 10;
      const amountEach = '15.00';

      const responses = await Promise.all(
        Array.from({ length: attempts }, () =>
          request(app.getHttpServer() as Server)
            .post('/api/v1/transfers')
            .set('Authorization', `Bearer ${sender.token}`)
            .set('Idempotency-Key', randomUUID())
            .send({ recipientEmail: recipient.email, currency: 'USD', amount: amountEach }),
        ),
      );

      const succeeded = responses.filter((res) => res.status === 201);
      const failed = responses.filter((res) => res.status === 422);

      expect(succeeded).toHaveLength(6);
      expect(failed).toHaveLength(4);

      const balanceAfter = await getUsdBalance(sender.token);
      expect(new Decimal(balanceBefore).minus(balanceAfter).toFixed(8)).toBe('90.00000000');
      expect(new Decimal(balanceAfter).isNegative()).toBe(false);
    });
  });
});
