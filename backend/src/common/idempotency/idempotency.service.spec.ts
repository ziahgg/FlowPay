import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { IdempotencyPayloadMismatchException } from './exceptions/idempotency-payload-mismatch.exception';
import { hashPayload } from './hash-payload';
import { IdempotencyService } from './idempotency.service';
import { RunIdempotentParams } from './interfaces/run-idempotent.interface';

type QueryMock = jest.Mock<Promise<unknown>, [sql: string, params?: unknown[]]>;

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let query: QueryMock;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    query = jest.fn() as QueryMock;
    configService = { get: jest.fn().mockReturnValue(30_000) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: getDataSourceToken(), useValue: { query } },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  const baseParams = <T>(
    overrides: Partial<RunIdempotentParams<T>> = {},
  ): RunIdempotentParams<T> => ({
    userId: 'user-1',
    key: 'key-1',
    endpoint: 'POST /api/v1/transfers',
    requestPayload: { amount: '10.00' },
    successStatus: 201,
    handler: jest.fn(),
    ...overrides,
  });

  it('runs the handler and marks the key completed on success', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([{ key: 'key-1' }]);
      if (sql.startsWith('UPDATE')) return Promise.resolve([]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const handler = jest.fn().mockResolvedValue({ body: { ok: true }, entryId: 'entry-1' });

    const result = await service.run(baseParams({ handler }));

    expect(result).toEqual({ body: { ok: true }, statusCode: 201, replayed: false });
    expect(handler).toHaveBeenCalledTimes(1);

    const updateCall = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
    expect(updateCall?.[1]).toEqual([
      'completed',
      JSON.stringify({ statusCode: 201, body: { ok: true } }),
      'entry-1',
      'user-1',
      'key-1',
    ]);
  });

  it('caches an HttpException outcome and rethrows it to the current caller', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([{ key: 'key-1' }]);
      if (sql.startsWith('UPDATE')) return Promise.resolve([]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const handler = jest.fn().mockRejectedValue(new NotFoundException('no such recipient'));

    await expect(service.run(baseParams({ handler }))).rejects.toBeInstanceOf(NotFoundException);

    const updateCall = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
    expect(updateCall).toBeDefined();
  });

  it('deletes the row on an unexpected error instead of caching it', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([{ key: 'key-1' }]);
      if (sql.startsWith('DELETE')) return Promise.resolve([]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const handler = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(service.run(baseParams({ handler }))).rejects.toThrow('boom');

    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('replays the cached response for a completed key with a matching payload', async () => {
    const payload = { amount: '10.00' };
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([]);
      if (sql.startsWith('SELECT')) {
        return Promise.resolve([
          {
            status: 'completed',
            requestHash: hashPayload(payload),
            responseBody: { statusCode: 201, body: { ok: true } },
            createdAt: new Date(),
          },
        ]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const handler = jest.fn();

    const result = await service.run(baseParams({ requestPayload: payload, handler }));

    expect(result).toEqual({ body: { ok: true }, statusCode: 201, replayed: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 409 for a still-processing key within the staleness window', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([]);
      if (sql.startsWith('SELECT')) {
        return Promise.resolve([
          {
            status: 'processing',
            requestHash: hashPayload({ amount: '10.00' }),
            responseBody: null,
            createdAt: new Date(),
          },
        ]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(service.run(baseParams())).rejects.toBeInstanceOf(IdempotencyConflictException);
  });

  it('returns 422 when the same key is reused with a different payload', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) return Promise.resolve([]);
      if (sql.startsWith('SELECT')) {
        return Promise.resolve([
          {
            status: 'completed',
            requestHash: hashPayload({ amount: 'DIFFERENT' }),
            responseBody: { statusCode: 201, body: {} },
            createdAt: new Date(),
          },
        ]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(service.run(baseParams())).rejects.toBeInstanceOf(
      IdempotencyPayloadMismatchException,
    );
  });

  it('reclaims a stale processing key past the threshold and retries as fresh', async () => {
    configService.get.mockReturnValue(1_000);
    let insertCallCount = 0;

    query.mockImplementation((sql: string) => {
      if (sql.startsWith('INSERT')) {
        insertCallCount += 1;
        return Promise.resolve(insertCallCount === 1 ? [] : [{ key: 'key-1' }]);
      }
      if (sql.startsWith('SELECT')) {
        return Promise.resolve([
          {
            status: 'processing',
            requestHash: hashPayload({ amount: '10.00' }),
            responseBody: null,
            createdAt: new Date(Date.now() - 5_000),
          },
        ]);
      }
      if (sql.startsWith('DELETE')) return Promise.resolve([{ key: 'key-1' }]);
      if (sql.startsWith('UPDATE')) return Promise.resolve([]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const handler = jest.fn().mockResolvedValue({ body: { ok: true } });

    const result = await service.run(baseParams({ handler }));

    expect(result).toEqual({ body: { ok: true }, statusCode: 201, replayed: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(insertCallCount).toBe(2);
  });
});
