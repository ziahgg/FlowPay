import { randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import Decimal from 'decimal.js';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AccountBalanceDto } from '../src/accounts/dto/account-balance.dto';
import { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { UserRole } from '../src/users/entities/user-role.enum';
import { WithdrawalResponseDto } from '../src/withdrawals/dto/withdrawal-response.dto';

describe('Deposits & withdrawals (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let userToken: string;
  let adminToken: string;

  const userEmail = `e2e-wd-user-${randomUUID()}@example.com`;
  const adminEmail = `e2e-wd-admin-${randomUUID()}@example.com`;
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

    const registerRes = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password });
    userToken = (registerRes.body as AuthResponseDto).accessToken;

    // Registration always creates a 'user' role; insert the admin test fixture directly, mirroring
    // how the seed script provisions admin@flowpay.dev.
    const passwordHash = await argon2.hash(password);
    await dataSource.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)`, [
      adminEmail,
      passwordHash,
      UserRole.ADMIN,
    ]);
    const adminLoginRes = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = (adminLoginRes.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM withdrawal_requests WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [userEmail],
    );
    await dataSource.query(
      `DELETE FROM journal_lines WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id = (SELECT id FROM users WHERE email = $1))`,
      [userEmail],
    );
    await dataSource.query(
      `DELETE FROM account_balances WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id = (SELECT id FROM users WHERE email = $1))`,
      [userEmail],
    );
    await dataSource.query(
      `DELETE FROM accounts WHERE owner_user_id = (SELECT id FROM users WHERE email = $1)`,
      [userEmail],
    );
    await dataSource.query(`DELETE FROM users WHERE email IN ($1, $2)`, [userEmail, adminEmail]);
    await app.close();
  });

  async function getUsdBalance(token: string): Promise<string> {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`);
    const balances = res.body as AccountBalanceDto[];
    return balances.find((b) => b.currency === 'USD')!.balance;
  }

  async function assertJournalInvariantForUser(email: string): Promise<void> {
    const rows: { balance: string; direction: string; amount: string }[] = await dataSource.query(
      `SELECT ab.balance, jl.direction, jl.amount
       FROM accounts a
       JOIN account_balances ab ON ab.account_id = a.id
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       WHERE a.owner_user_id = (SELECT id FROM users WHERE email = $1) AND a.currency_code = 'USD'`,
      [email],
    );

    const balance = new Decimal(rows[0].balance);
    const sum = rows.reduce((total, row) => {
      if (!row.direction) return total;
      const sign = row.direction === 'credit' ? 1 : -1;
      return total.plus(new Decimal(row.amount).times(sign));
    }, new Decimal(0));

    expect(balance.equals(sum)).toBe(true);
  }

  it('deposits, rejecting amounts above the configured sanity limit', async () => {
    const ok = await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currency: 'USD', amount: '200.00' });

    expect(ok.status).toBe(201);
    expect(await getUsdBalance(userToken)).toBe('200.00000000');

    const tooMuch = await request(app.getHttpServer() as Server)
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currency: 'USD', amount: '9999999999' });

    expect(tooMuch.status).toBe(400);
    await assertJournalInvariantForUser(userEmail);
  });

  it('holds funds on withdrawal request, rejects overdraft, and settles on approval', async () => {
    const overdraft = await request(app.getHttpServer() as Server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currency: 'USD', amount: '10000.00', destination: 'IBAN-TEST' });
    expect(overdraft.status).toBe(422);

    const holdRes = await request(app.getHttpServer() as Server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currency: 'USD', amount: '50.00', destination: 'IBAN-TEST-1' });

    expect(holdRes.status).toBe(201);
    const withdrawal = holdRes.body as WithdrawalResponseDto;
    expect(withdrawal.status).toBe('pending');
    expect(await getUsdBalance(userToken)).toBe('150.00000000');
    await assertJournalInvariantForUser(userEmail);

    const forbidden = await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.id}/approve`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(forbidden.status).toBe(403);

    const approveRes = await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approveRes.status).toBe(201);
    expect((approveRes.body as WithdrawalResponseDto).status).toBe('approved');

    // Settlement moves the hold to treasury; it does not touch the user's wallet again.
    expect(await getUsdBalance(userToken)).toBe('150.00000000');
    await assertJournalInvariantForUser(userEmail);

    const doubleApprove = await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(doubleApprove.status).toBe(409);
  });

  it('releases funds back to the wallet on rejection', async () => {
    const before = await getUsdBalance(userToken);

    const holdRes = await request(app.getHttpServer() as Server)
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currency: 'USD', amount: '30.00', destination: 'IBAN-TEST-2' });
    const withdrawal = holdRes.body as WithdrawalResponseDto;

    expect(await getUsdBalance(userToken)).toBe(new Decimal(before).minus('30.00').toFixed(8));

    const rejectRes = await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(rejectRes.status).toBe(201);
    expect((rejectRes.body as WithdrawalResponseDto).status).toBe('rejected');

    expect(await getUsdBalance(userToken)).toBe(before);
    await assertJournalInvariantForUser(userEmail);

    const doubleReject = await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/withdrawals/${withdrawal.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(doubleReject.status).toBe(409);
  });

  it('lists the admin pending queue and the user history', async () => {
    const pendingRes = await request(app.getHttpServer() as Server)
      .get('/api/v1/admin/withdrawals?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pendingRes.status).toBe(200);

    const historyRes = await request(app.getHttpServer() as Server)
      .get('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${userToken}`);
    expect(historyRes.status).toBe(200);
    expect((historyRes.body as { meta: { total: number } }).meta.total).toBe(2);
  });
});
