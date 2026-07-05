import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1751900000000 implements MigrationInterface {
  name = 'CreateOrders1751900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres allows ADD VALUE outside a transaction-committed-use restriction as long as the new
    // value isn't referenced by the same transaction that adds it (fine here -- this migration only
    // adds the values, it doesn't insert rows using them).
    await queryRunner.query(`ALTER TYPE "account_kind_enum" ADD VALUE 'trade_hold'`);
    await queryRunner.query(`ALTER TYPE "journal_entry_type_enum" ADD VALUE 'trade_hold'`);
    await queryRunner.query(`ALTER TYPE "journal_entry_type_enum" ADD VALUE 'trade_release'`);

    await queryRunner.query(`CREATE TYPE "order_side_enum" AS ENUM ('buy', 'sell')`);
    await queryRunner.query(`CREATE TYPE "order_type_enum" AS ENUM ('market', 'limit')`);
    await queryRunner.query(
      `CREATE TYPE "order_status_enum" AS ENUM ('open', 'filled', 'cancelled')`,
    );

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "pair" varchar(21) NOT NULL,
        "side" "order_side_enum" NOT NULL,
        "type" "order_type_enum" NOT NULL,
        "quantity" numeric(30,8) NOT NULL,
        "limit_price" numeric(30,8) NULL,
        "status" "order_status_enum" NOT NULL DEFAULT 'open',
        "hold_entry_id" uuid NULL,
        "fill_entry_id" uuid NULL,
        "filled_price" numeric(30,8) NULL,
        "filled_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_orders_quantity_positive" CHECK ("quantity" > 0),
        CONSTRAINT "CHK_orders_limit_price_matches_type" CHECK (
          ("type" = 'limit' AND "limit_price" IS NOT NULL AND "limit_price" > 0) OR
          ("type" = 'market' AND "limit_price" IS NULL)
        ),
        CONSTRAINT "FK_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_orders_hold_entry_id" FOREIGN KEY ("hold_entry_id") REFERENCES "journal_entries" ("id"),
        CONSTRAINT "FK_orders_fill_entry_id" FOREIGN KEY ("fill_entry_id") REFERENCES "journal_entries" ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_orders_user_id" ON "orders" ("user_id")`);
    // Partial index: the worker only ever scans open limit orders, so this is the one index that
    // matters for its query performance; filled/cancelled rows never need to be found this way.
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_open_limit" ON "orders" ("pair") WHERE "status" = 'open' AND "type" = 'limit'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_orders_open_limit"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_user_id"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "order_status_enum"`);
    await queryRunner.query(`DROP TYPE "order_type_enum"`);
    await queryRunner.query(`DROP TYPE "order_side_enum"`);

    // Postgres has no ALTER TYPE ... DROP VALUE, so reverting an added enum value means swapping
    // in a fresh type with the old value set. This assumes no existing row uses the value being
    // dropped (true for a clean rollback, which is the only scenario a down() migration promises).
    await queryRunner.query(
      `ALTER TYPE "journal_entry_type_enum" RENAME TO "journal_entry_type_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "journal_entry_type_enum" AS ENUM (
        'deposit', 'withdrawal_hold', 'withdrawal_settle', 'withdrawal_release',
        'transfer', 'fx_convert', 'trade'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries" ALTER COLUMN "type" TYPE "journal_entry_type_enum"
      USING "type"::text::"journal_entry_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "journal_entry_type_enum_old"`);

    await queryRunner.query(`ALTER TYPE "account_kind_enum" RENAME TO "account_kind_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "account_kind_enum" AS ENUM ('user_wallet', 'treasury', 'fees', 'withdrawal_pending')
    `);
    // The owner/kind CHECK constraint's expression is bound to the old type's OID; it must be
    // dropped before the column type swap and recreated after, or Postgres can't compare the
    // (now-differently-typed) column against the constraint's cached literals.
    await queryRunner.query(
      `ALTER TABLE "accounts" DROP CONSTRAINT "CHK_accounts_owner_matches_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "accounts" ALTER COLUMN "kind" TYPE "account_kind_enum"
      USING "kind"::text::"account_kind_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "accounts" ADD CONSTRAINT "CHK_accounts_owner_matches_kind" CHECK (
        (kind = 'user_wallet' AND owner_user_id IS NOT NULL) OR
        (kind != 'user_wallet' AND owner_user_id IS NULL)
      )
    `);
    await queryRunner.query(`DROP TYPE "account_kind_enum_old"`);
  }
}
