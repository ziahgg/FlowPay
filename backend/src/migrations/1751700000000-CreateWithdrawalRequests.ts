import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWithdrawalRequests1751700000000 implements MigrationInterface {
  name = 'CreateWithdrawalRequests1751700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "withdrawal_request_status_enum" AS ENUM ('pending', 'approved', 'rejected')`,
    );

    await queryRunner.query(`
      CREATE TABLE "withdrawal_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "currency_code" varchar(10) NOT NULL,
        "amount" numeric(30,8) NOT NULL,
        "destination" varchar(255) NOT NULL,
        "status" "withdrawal_request_status_enum" NOT NULL DEFAULT 'pending',
        "decided_by" uuid NULL,
        "decided_at" timestamptz NULL,
        "hold_entry_id" uuid NOT NULL,
        "settle_entry_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_withdrawal_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_withdrawal_requests_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "FK_withdrawal_requests_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_withdrawal_requests_currency_code" FOREIGN KEY ("currency_code") REFERENCES "currencies" ("code"),
        CONSTRAINT "FK_withdrawal_requests_decided_by" FOREIGN KEY ("decided_by") REFERENCES "users" ("id"),
        CONSTRAINT "FK_withdrawal_requests_hold_entry_id" FOREIGN KEY ("hold_entry_id") REFERENCES "journal_entries" ("id"),
        CONSTRAINT "FK_withdrawal_requests_settle_entry_id" FOREIGN KEY ("settle_entry_id") REFERENCES "journal_entries" ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_withdrawal_requests_user_id" ON "withdrawal_requests" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_withdrawal_requests_status" ON "withdrawal_requests" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_withdrawal_requests_status"`);
    await queryRunner.query(`DROP INDEX "IDX_withdrawal_requests_user_id"`);
    await queryRunner.query(`DROP TABLE "withdrawal_requests"`);
    await queryRunner.query(`DROP TYPE "withdrawal_request_status_enum"`);
  }
}
