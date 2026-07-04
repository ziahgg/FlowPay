import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdempotencyKeys1751800000000 implements MigrationInterface {
  name = 'CreateIdempotencyKeys1751800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "idempotency_key_status_enum" AS ENUM ('processing', 'completed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "key" varchar(255) NOT NULL,
        "user_id" uuid NOT NULL,
        "endpoint" varchar(255) NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "status" "idempotency_key_status_enum" NOT NULL DEFAULT 'processing',
        "response_body" jsonb NULL,
        "entry_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("user_id", "key"),
        CONSTRAINT "FK_idempotency_keys_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_idempotency_keys_entry_id" FOREIGN KEY ("entry_id") REFERENCES "journal_entries" ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_keys_created_at" ON "idempotency_keys" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_idempotency_keys_created_at"`);
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(`DROP TYPE "idempotency_key_status_enum"`);
  }
}
