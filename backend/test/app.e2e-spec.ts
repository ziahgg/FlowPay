import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HealthResponseDto } from '../src/health/dto/health-response.dto';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok with db up', async () => {
    const response = await request(app.getHttpServer() as Server).get('/api/v1/health');
    const body = response.body as HealthResponseDto;

    expect(response.status).toBe(200);
    // kafka's connect() is fire-and-forget (see KafkaEventProducer) and may not have resolved yet
    // by the time this request lands right after app.init() -- assert its shape, not its value.
    expect(body).toMatchObject({ status: 'ok', db: 'up' });
    expect(['up', 'down']).toContain(body.kafka);
  });
});
