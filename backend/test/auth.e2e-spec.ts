import { randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { UserProfileDto } from '../src/users/dto/user-profile.dto';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accessToken: string;

  const email = `e2e-${randomUUID()}@example.com`;
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
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM users WHERE email = $1', [email]);
    await app.close();
  });

  it('registers a new user and never returns the password hash', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password });

    const body = response.body as AuthResponseDto;

    expect(response.status).toBe(201);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ email, role: 'user' });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('password_hash');
  });

  it('logs in with the registered credentials', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email, password });

    const body = response.body as AuthResponseDto;

    expect(response.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    accessToken = body.accessToken;
  });

  it('returns the current user profile for a valid access token', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    const body = response.body as UserProfileDto;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ email, role: 'user' });
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('rejects login with the wrong password', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects registering an email that is already taken', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({ email, password });

    expect(response.status).toBe(409);
  });

  it('throttles repeated auth requests from the same client', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer() as Server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong-password' }),
      ),
    );

    expect(responses.some((res) => res.status === 429)).toBe(true);
  });
});
