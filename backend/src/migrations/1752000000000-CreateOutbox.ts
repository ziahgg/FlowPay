import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutbox1752000000000 implements MigrationInterface {
  name = 'CreateOutbox1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "topic" varchar(255) NOT NULL,
        "event_type" varchar(100) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz NULL,
        CONSTRAINT "PK_outbox_events_id" PRIMARY KEY ("id")
      )
    `);

    // Partial: the poller only ever queries unpublished rows -- once published_at is set, a row
    // never needs this index again (same reasoning as the open-limit-orders index in the trading
    // migration).
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_events_unpublished" ON "outbox_events" ("created_at")
      WHERE "published_at" IS NULL
    `);

    // The dedupe table for the notifications consumer. A plain PK on event_id gives an atomic
    // "INSERT ... ON CONFLICT DO NOTHING" claim -- the same idiom idempotency_keys already uses
    // for exactly the same reason: at-least-once delivery needs a fast, race-safe "have I already
    // handled this?" check.
    await queryRunner.query(`
      CREATE TABLE "processed_events" (
        "event_id" uuid NOT NULL,
        "processed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_events_event_id" PRIMARY KEY ("event_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP INDEX "IDX_outbox_events_unpublished"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
