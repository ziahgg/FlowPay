import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLedgerCore1751600000000 implements MigrationInterface {
  name = 'CreateLedgerCore1751600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "currency_type_enum" AS ENUM ('fiat', 'crypto')`);
    await queryRunner.query(
      `CREATE TYPE "account_kind_enum" AS ENUM ('user_wallet', 'treasury', 'fees', 'withdrawal_pending')`,
    );
    await queryRunner.query(`
      CREATE TYPE "journal_entry_type_enum" AS ENUM (
        'deposit', 'withdrawal_hold', 'withdrawal_settle', 'withdrawal_release',
        'transfer', 'fx_convert', 'trade'
      )
    `);
    await queryRunner.query(
      `CREATE TYPE "journal_line_direction_enum" AS ENUM ('debit', 'credit')`,
    );

    await queryRunner.query(`
      CREATE TABLE "currencies" (
        "code" varchar(10) NOT NULL,
        "name" varchar(100) NOT NULL,
        "type" "currency_type_enum" NOT NULL,
        "decimals" smallint NOT NULL,
        CONSTRAINT "PK_currencies_code" PRIMARY KEY ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NULL,
        "currency_code" varchar(10) NOT NULL,
        "kind" "account_kind_enum" NOT NULL,
        CONSTRAINT "PK_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_accounts_owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_accounts_currency_code" FOREIGN KEY ("currency_code") REFERENCES "currencies" ("code"),
        CONSTRAINT "CHK_accounts_owner_matches_kind" CHECK (
          (kind = 'user_wallet' AND owner_user_id IS NOT NULL) OR
          (kind != 'user_wallet' AND owner_user_id IS NULL)
        )
      )
    `);

    // Plain UNIQUE enforces one wallet per (user, currency, kind). Postgres treats every NULL as
    // distinct, so this does NOT stop duplicate system accounts (owner_user_id is NULL for all of
    // them) -- the partial index below closes that gap.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_accounts_owner_currency_kind" ON "accounts" ("owner_user_id", "currency_code", "kind")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_accounts_system_currency_kind" ON "accounts" ("currency_code", "kind")
      WHERE "owner_user_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "journal_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" "journal_entry_type_enum" NOT NULL,
        "description" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_journal_entries_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "journal_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entry_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "direction" "journal_line_direction_enum" NOT NULL,
        "amount" numeric(30,8) NOT NULL,
        "currency_code" varchar(10) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_journal_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_journal_lines_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "FK_journal_lines_entry_id" FOREIGN KEY ("entry_id") REFERENCES "journal_entries" ("id"),
        CONSTRAINT "FK_journal_lines_account_id" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id"),
        CONSTRAINT "FK_journal_lines_currency_code" FOREIGN KEY ("currency_code") REFERENCES "currencies" ("code")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_journal_lines_account_created" ON "journal_lines" ("account_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "account_balances" (
        "account_id" uuid NOT NULL,
        "balance" numeric(30,8) NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_balances_account_id" PRIMARY KEY ("account_id"),
        CONSTRAINT "FK_account_balances_account_id" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_balances"`);
    await queryRunner.query(`DROP INDEX "IDX_journal_lines_account_created"`);
    await queryRunner.query(`DROP TABLE "journal_lines"`);
    await queryRunner.query(`DROP TABLE "journal_entries"`);
    await queryRunner.query(`DROP INDEX "UQ_accounts_system_currency_kind"`);
    await queryRunner.query(`DROP INDEX "UQ_accounts_owner_currency_kind"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TABLE "currencies"`);
    await queryRunner.query(`DROP TYPE "journal_line_direction_enum"`);
    await queryRunner.query(`DROP TYPE "journal_entry_type_enum"`);
    await queryRunner.query(`DROP TYPE "account_kind_enum"`);
    await queryRunner.query(`DROP TYPE "currency_type_enum"`);
  }
}
