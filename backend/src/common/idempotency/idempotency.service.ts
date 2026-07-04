import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EnvConfig } from '../config/env.schema';
import { IdempotencyKeyStatus } from './entities/idempotency-key-status.enum';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { IdempotencyPayloadMismatchException } from './exceptions/idempotency-payload-mismatch.exception';
import { hashPayload } from './hash-payload';
import { RunIdempotentParams, RunIdempotentResult } from './interfaces/run-idempotent.interface';

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

interface IdempotencyKeyRow {
  status: IdempotencyKeyStatus;
  requestHash: string;
  responseBody: StoredResponse | null;
  createdAt: Date;
}

/**
 * Reusable idempotency-key infrastructure (also intended for FX conversion later). See the
 * "Payments: idempotency & concurrency" section of README.md for the full design rationale.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async run<T>(params: RunIdempotentParams<T>): Promise<RunIdempotentResult<T>> {
    const requestHash = hashPayload(params.requestPayload);

    const inserted = await this.dataSource.query<{ key: string }[]>(
      `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING key`,
      [params.key, params.userId, params.endpoint, requestHash, IdempotencyKeyStatus.PROCESSING],
    );

    if (inserted.length === 0) {
      return this.handleExistingKey(params, requestHash);
    }

    return this.runHandlerAndFinalize(params);
  }

  private async runHandlerAndFinalize<T>(
    params: RunIdempotentParams<T>,
  ): Promise<RunIdempotentResult<T>> {
    try {
      const { body, entryId } = await params.handler();

      await this.dataSource.query(
        `UPDATE idempotency_keys SET status = $1, response_body = $2, entry_id = $3
         WHERE user_id = $4 AND key = $5`,
        [
          IdempotencyKeyStatus.COMPLETED,
          JSON.stringify({ statusCode: params.successStatus, body }),
          entryId ?? null,
          params.userId,
          params.key,
        ],
      );

      return { body, statusCode: params.successStatus, replayed: false };
    } catch (error) {
      if (error instanceof HttpException) {
        // A deterministic business rejection (e.g. unknown recipient, insufficient funds) is
        // cached like any other outcome: retrying with the same key + payload replays it.
        await this.dataSource.query(
          `UPDATE idempotency_keys SET status = $1, response_body = $2
           WHERE user_id = $3 AND key = $4`,
          [
            IdempotencyKeyStatus.COMPLETED,
            JSON.stringify({ statusCode: error.getStatus(), body: error.getResponse() }),
            params.userId,
            params.key,
          ],
        );
      } else {
        // Unexpected/infra failure: don't poison the key. Clear it so a genuine retry can
        // actually re-attempt the operation.
        await this.dataSource.query(
          `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
          [params.userId, params.key],
        );
      }

      throw error;
    }
  }

  private async handleExistingKey<T>(
    params: RunIdempotentParams<T>,
    requestHash: string,
  ): Promise<RunIdempotentResult<T>> {
    const rows = await this.dataSource.query<IdempotencyKeyRow[]>(
      `SELECT status, request_hash AS "requestHash", response_body AS "responseBody", created_at AS "createdAt"
       FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
      [params.userId, params.key],
    );

    const existing = rows[0];
    if (!existing) {
      // Row vanished between our failed insert and this select (e.g. a concurrent staleness
      // reclaim). Retry as a fresh attempt.
      return this.run(params);
    }

    if (existing.requestHash !== requestHash) {
      throw new IdempotencyPayloadMismatchException();
    }

    if (existing.status === IdempotencyKeyStatus.PROCESSING) {
      const staleMs = this.configService.get('IDEMPOTENCY_STALE_MS', { infer: true });
      const ageMs = Date.now() - existing.createdAt.getTime();

      if (ageMs < staleMs) {
        throw new IdempotencyConflictException();
      }

      const reclaimed = await this.dataSource.query<{ key: string }[]>(
        `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status = $3 RETURNING key`,
        [params.userId, params.key, IdempotencyKeyStatus.PROCESSING],
      );

      if (reclaimed.length === 0) {
        // Someone else reclaimed or completed it first between our SELECT and this DELETE.
        return this.handleExistingKey(params, requestHash);
      }

      return this.run(params);
    }

    const cached = existing.responseBody as StoredResponse;
    return { body: cached.body as T, statusCode: cached.statusCode, replayed: true };
  }
}
