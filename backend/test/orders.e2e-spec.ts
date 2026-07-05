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
import { OrderResponseDto } from '../src/trading/dto/order-response.dto';
import { OrdersWorkerService } from '../src/trading/orders-worker.service';

// Only one user is registered for this whole file (auth's /register is throttled to 5/min per
// IP); every test tops itself up with deposits (not throttled) as needed. The real @nestjs/schedule
// cron worker is also running in the background against real (or static-fallback) rates, so tests
// that need an order to stay 'open' use a limit price no real/static rate could ever cross (e.g.
// buying BTC at $1), and the one test that exercises a fill invokes OrdersWorkerService.tryFill()
// directly for a deterministic result instead of waiting on the real ~10s cron tick.
describe('Trading / orders (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersWorkerService: OrdersWorkerService;
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
    ordersWorkerService = app.get(OrdersWorkerService);

    const email = `e2e-orders-${runId}@example.com`;
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password });
    user = { email, token: (res.body as AuthResponseDto).accessToken };

    // Two deposits (DEPOSIT_MAX_AMOUNT defaults to 50000 per call) to comfortably cover every
    // hold/fill in this file, including the 10,000.00 hold in the "fills a crossed limit order"
    // test below.
    await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currency: 'USD', amount: '50000.00' });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currency: 'USD', amount: '50000.00' });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ currency: 'BTC', amount: '1.00000000' });
  });

  afterAll(async () => {
    const pattern = `%${runId}%`;
    await dataSource.query(
      `DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
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

  async function getBalance(currency: string): Promise<string | undefined> {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${user.token}`);
    const balances = res.body as AccountBalanceDto[];
    return balances.find((b) => b.currency === currency)?.balance;
  }

  describe('POST /orders -- market', () => {
    it('buys BTC with USD at the current rate and moves both balances', async () => {
      const usdBefore = await getBalance('USD');
      const btcBefore = await getBalance('BTC');

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/USD', side: 'buy', type: 'market', quantity: '0.001' });

      expect(res.status).toBe(201);
      const body = res.body as OrderResponseDto;
      expect(body.status).toBe('filled');
      expect(body.type).toBe('market');
      expect(body.quantity).toBe('0.00100000');
      expect(body.fillEntryId).toBeTruthy();
      expect(body.filledPrice).toBeTruthy();

      // filledPrice is itself already rounded to USD's 2 decimals for display, so the quote
      // amount actually debited is (rate * quantity) rounded to 2 decimals half-even -- not the
      // raw, unrounded product of filledPrice * quantity, which can carry more than 2 decimals
      // (e.g. 62682.00 * 0.001 = 62.682, but only 62.68 can actually move in USD).
      const quoteAmount = new Decimal(body.filledPrice!)
        .times('0.001')
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      const expectedUsdAfter = new Decimal(usdBefore!).minus(quoteAmount).toFixed(8);
      expect(await getBalance('USD')).toBe(expectedUsdAfter);
      expect(await getBalance('BTC')).toBe(new Decimal(btcBefore!).plus('0.001').toFixed(8));
    });

    it('sells BTC for USD at the current rate', async () => {
      const usdBefore = await getBalance('USD');
      const btcBefore = await getBalance('BTC');

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/USD', side: 'sell', type: 'market', quantity: '0.001' });

      expect(res.status).toBe(201);
      const body = res.body as OrderResponseDto;
      expect(body.status).toBe('filled');

      const quoteAmount = new Decimal(body.filledPrice!)
        .times('0.001')
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      const expectedUsdAfter = new Decimal(usdBefore!).plus(quoteAmount).toFixed(8);
      expect(await getBalance('USD')).toBe(expectedUsdAfter);
      expect(await getBalance('BTC')).toBe(new Decimal(btcBefore!).minus('0.001').toFixed(8));
    });

    it('rejects a market order that would overdraw the wallet (422)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/USD', side: 'buy', type: 'market', quantity: '999999' });

      expect(res.status).toBe(422);
    });

    it('rejects a pair with an unknown currency (404)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/ZZZ', side: 'buy', type: 'market', quantity: '0.001' });

      expect(res.status).toBe(404);
    });

    it('rejects a pair whose base and quote are the same currency (422)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'USD/USD', side: 'buy', type: 'market', quantity: '1' });

      expect(res.status).toBe(422);
    });

    it('ignores a stray limitPrice on a market order DTO (executes at the market rate anyway)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/USD', side: 'buy', type: 'market', quantity: '0.001', limitPrice: '1' });

      expect(res.status).toBe(201);
      const body = res.body as OrderResponseDto;
      expect(body.status).toBe('filled');
      expect(body.limitPrice).toBeNull();
    });
  });

  describe('POST /orders -- limit, GET /orders, DELETE /orders/:id', () => {
    it('places a limit order that holds funds and stays open (no realistic rate crosses it)', async () => {
      const usdBefore = await getBalance('USD');

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          pair: 'BTC/USD',
          side: 'buy',
          type: 'limit',
          quantity: '0.01',
          limitPrice: '100.00',
        });

      expect(res.status).toBe(201);
      const body = res.body as OrderResponseDto;
      expect(body.status).toBe('open');
      expect(body.holdEntryId).toBeTruthy();
      expect(body.limitPrice).toBe('100.00');

      // Held amount = quantity * limitPrice = 0.01 * 100.00 = 1.00
      expect(await getBalance('USD')).toBe(new Decimal(usdBefore!).minus('1.00').toFixed(8));

      const list = await request(app.getHttpServer() as Server)
        .get('/api/v1/orders?status=open')
        .set('Authorization', `Bearer ${user.token}`);
      expect(list.status).toBe(200);
      const listBody = list.body as PaginatedResponseDto<OrderResponseDto>;
      expect(listBody.data.some((o) => o.id === body.id)).toBe(true);

      const cancelRes = await request(app.getHttpServer() as Server)
        .delete(`/api/v1/orders/${body.id}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(cancelRes.status).toBe(200);
      expect((cancelRes.body as OrderResponseDto).status).toBe('cancelled');

      const cancelAgain = await request(app.getHttpServer() as Server)
        .delete(`/api/v1/orders/${body.id}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(cancelAgain.status).toBe(409);
    });

    it('holds base currency (quantity, price-independent) for a sell limit order', async () => {
      const btcBefore = await getBalance('BTC');

      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          pair: 'BTC/USD',
          side: 'sell',
          type: 'limit',
          quantity: '0.001',
          limitPrice: '10000000.00',
        });

      expect(res.status).toBe(201);
      const body = res.body as OrderResponseDto;
      expect(await getBalance('BTC')).toBe(new Decimal(btcBefore!).minus('0.001').toFixed(8));

      const cancelRes = await request(app.getHttpServer() as Server)
        .delete(`/api/v1/orders/${body.id}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(cancelRes.status).toBe(200);
      expect(await getBalance('BTC')).toBe(btcBefore);
    });

    it('rejects a limit order DTO with no limitPrice (400)', async () => {
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ pair: 'BTC/USD', side: 'buy', type: 'limit', quantity: '0.001' });

      expect(res.status).toBe(400);
    });

    it("rejects cancelling another user's order (404)", async () => {
      const other = await request(app.getHttpServer() as Server)
        .post('/api/v1/auth/register')
        .send({ email: `e2e-orders-other-${runId}@example.com`, password });
      const otherToken = (other.body as AuthResponseDto).accessToken;

      const placed = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          pair: 'BTC/USD',
          side: 'buy',
          type: 'limit',
          quantity: '0.01',
          limitPrice: '100.00',
        });

      const res = await request(app.getHttpServer() as Server)
        .delete(`/api/v1/orders/${(placed.body as OrderResponseDto).id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });

    it('fills a crossed limit order when the worker evaluates it', async () => {
      const usdBefore = await getBalance('USD');
      const btcBefore = await getBalance('BTC');

      const placed = await request(app.getHttpServer() as Server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${user.token}`)
        // An absurdly generous limit price guarantees the real/static rate has already crossed it.
        .send({
          pair: 'BTC/USD',
          side: 'buy',
          type: 'limit',
          quantity: '0.001',
          limitPrice: '10000000.00',
        });
      const orderId = (placed.body as OrderResponseDto).id;

      const filled = await ordersWorkerService.tryFill(orderId);
      expect(filled).toBe(true);

      const getRes = await request(app.getHttpServer() as Server)
        .get('/api/v1/orders?status=filled')
        .set('Authorization', `Bearer ${user.token}`);
      const listBody = getRes.body as PaginatedResponseDto<OrderResponseDto>;
      const order = listBody.data.find((o) => o.id === orderId);
      expect(order?.status).toBe('filled');
      expect(order?.fillEntryId).toBeTruthy();

      // The hold (0.001 * 10,000,000 = 10,000.00 USD) was fully consumed into the fill at the
      // limit price -- not the current market rate -- so USD moves by exactly that much, and BTC
      // moves by exactly the order quantity.
      expect(await getBalance('USD')).toBe(new Decimal(usdBefore!).minus('10000.00').toFixed(8));
      expect(await getBalance('BTC')).toBe(new Decimal(btcBefore!).plus('0.001').toFixed(8));
    });
  });
});
