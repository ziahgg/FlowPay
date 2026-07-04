import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { Account } from './entities/account.entity';
import { Currency } from './entities/currency.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryType } from './entities/journal-entry-type.enum';
import { JournalLine } from './entities/journal-line.entity';
import { JournalLineDirection } from './entities/journal-line-direction.enum';
import { InsufficientFundsException } from './exceptions/insufficient-funds.exception';
import { InvalidLedgerEntryException } from './exceptions/invalid-ledger-entry.exception';
import { EnsureAccountInput } from './interfaces/ensure-account.interface';
import { PostEntryInput, PostEntryResult } from './interfaces/post-entry.interface';
import { validateEntryLines } from './ledger-entry-validator';

interface LockedAccountRow {
  accountId: string;
  balance: string;
  ownerUserId: string | null;
  currencyCode: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

@Injectable()
export class LedgerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Currency) private readonly currencyRepository: Repository<Currency>,
    @InjectRepository(JournalLine) private readonly journalLineRepository: Repository<JournalLine>,
  ) {}

  /**
   * Posts a balanced journal entry. Runs in its own transaction unless an existing `manager` is
   * supplied, in which case the entry participates in the caller's transaction -- required
   * whenever another table must be written atomically alongside the entry (e.g. a withdrawal
   * request row locked in the same transaction).
   */
  async postEntry(input: PostEntryInput, manager?: EntityManager): Promise<PostEntryResult> {
    validateEntryLines(input.lines);

    if (manager) {
      return this.postEntryWithManager(input, manager);
    }

    return this.dataSource.transaction((trxManager) =>
      this.postEntryWithManager(input, trxManager),
    );
  }

  private async postEntryWithManager(
    input: PostEntryInput,
    manager: EntityManager,
  ): Promise<PostEntryResult> {
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))].sort();

    const rows = await manager.query<LockedAccountRow[]>(
      `SELECT ab.account_id AS "accountId", ab.balance AS "balance",
              a.owner_user_id AS "ownerUserId", a.currency_code AS "currencyCode"
       FROM account_balances ab
       JOIN accounts a ON a.id = ab.account_id
       WHERE ab.account_id = ANY($1::uuid[])
       ORDER BY ab.account_id
       FOR UPDATE OF ab`,
      [accountIds],
    );

    if (rows.length !== accountIds.length) {
      throw new InvalidLedgerEntryException(
        'one or more accounts referenced by this entry do not exist',
      );
    }

    const rowsByAccountId = new Map(rows.map((row) => [row.accountId, row]));

    for (const inputLine of input.lines) {
      const row = rowsByAccountId.get(inputLine.accountId);
      if (row && row.currencyCode !== inputLine.currencyCode) {
        throw new InvalidLedgerEntryException(
          `line currency ${inputLine.currencyCode} does not match account ${inputLine.accountId} currency ${row.currencyCode}`,
        );
      }
    }

    const deltasByAccountId = new Map<string, Decimal>();
    for (const inputLine of input.lines) {
      const sign = inputLine.direction === JournalLineDirection.CREDIT ? 1 : -1;
      const delta = new Decimal(inputLine.amount).times(sign);
      deltasByAccountId.set(
        inputLine.accountId,
        (deltasByAccountId.get(inputLine.accountId) ?? new Decimal(0)).plus(delta),
      );
    }

    const newBalancesByAccountId = new Map<string, Decimal>();
    for (const accountId of accountIds) {
      const row = rowsByAccountId.get(accountId)!;
      const newBalance = new Decimal(row.balance).plus(
        deltasByAccountId.get(accountId) ?? new Decimal(0),
      );

      if (row.ownerUserId !== null && newBalance.isNegative()) {
        throw new InsufficientFundsException(accountId);
      }

      newBalancesByAccountId.set(accountId, newBalance);
    }

    const entryRepository = manager.getRepository(JournalEntry);
    const entry = await entryRepository.save(
      entryRepository.create({
        type: input.type,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
      }),
    );

    const lineRepository = manager.getRepository(JournalLine);
    await lineRepository.save(
      input.lines.map((inputLine) =>
        lineRepository.create({
          entryId: entry.id,
          accountId: inputLine.accountId,
          direction: inputLine.direction,
          amount: inputLine.amount,
          currencyCode: inputLine.currencyCode,
        }),
      ),
    );

    const balances: Record<string, string> = {};
    for (const [accountId, balance] of newBalancesByAccountId) {
      const formatted = balance.toFixed(8);
      await manager.query(
        `UPDATE account_balances SET balance = $1, updated_at = now() WHERE account_id = $2`,
        [formatted, accountId],
      );
      balances[accountId] = formatted;
    }

    return { entryId: entry.id, balances };
  }

  /**
   * Idempotently returns the account for (owner, currency, kind), creating it (with a zero
   * account_balances row) on first use. Safe under concurrent first-touch calls.
   */
  async ensureAccount(params: EnsureAccountInput): Promise<Account> {
    const where: FindOptionsWhere<Account> = {
      ownerUserId: params.ownerUserId === null ? IsNull() : params.ownerUserId,
      currencyCode: params.currencyCode,
      kind: params.kind,
    };

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Account, { where });
      if (existing) {
        return existing;
      }

      const inserted = await manager.query<Account[]>(
        `INSERT INTO accounts (owner_user_id, currency_code, kind)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id, owner_user_id AS "ownerUserId", currency_code AS "currencyCode", kind`,
        [params.ownerUserId, params.currencyCode, params.kind],
      );

      if (inserted.length > 0) {
        const [account] = inserted;
        await manager.query(
          `INSERT INTO account_balances (account_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
          [account.id],
        );
        return account;
      }

      // Lost the race to a concurrent caller; their insert has since committed (or is about to).
      const created = await manager.findOne(Account, { where });
      if (!created) {
        throw new Error(
          `Failed to create or find account for ${params.currencyCode}/${params.kind}`,
        );
      }
      return created;
    });
  }

  async listCurrencies(): Promise<Currency[]> {
    return this.currencyRepository.find({ order: { code: 'ASC' } });
  }

  async getCurrency(code: string): Promise<Currency> {
    const currency = await this.currencyRepository.findOne({ where: { code: code.toUpperCase() } });
    if (!currency) {
      throw new NotFoundException(`Unknown currency ${code}`);
    }
    return currency;
  }

  async getBalance(
    accountId: string,
  ): Promise<{ accountId: string; currencyCode: string; balance: string }> {
    const rows = await this.dataSource.query<
      { accountId: string; currencyCode: string; balance: string }[]
    >(
      `SELECT ab.account_id AS "accountId", ab.balance AS "balance", a.currency_code AS "currencyCode"
       FROM account_balances ab
       JOIN accounts a ON a.id = ab.account_id
       WHERE ab.account_id = $1`,
      [accountId],
    );

    if (rows.length === 0) {
      throw new NotFoundException(`Unknown account ${accountId}`);
    }

    return rows[0];
  }

  async listJournalLines(
    accountId: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<JournalLine>> {
    const [items, total] = await this.journalLineRepository.findAndCount({
      where: { accountId },
      relations: { entry: true },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return { items, total };
  }

  /**
   * Generic read across every account owned by a user (all currencies, all kinds owned by them --
   * in practice just their wallets), optionally filtered by entry type. Lets feature modules (e.g.
   * transfers) build an activity view without holding their own repository over ledger tables.
   */
  async listJournalLinesForOwner(
    ownerUserId: string,
    filter: { type?: JournalEntryType },
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<JournalLine>> {
    const query = this.journalLineRepository
      .createQueryBuilder('line')
      .innerJoin('line.account', 'account')
      .innerJoinAndSelect('line.entry', 'entry')
      .where('account.ownerUserId = :ownerUserId', { ownerUserId });

    if (filter.type) {
      query.andWhere('entry.type = :type', { type: filter.type });
    }

    const [items, total] = await query
      .orderBy('line.createdAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit)
      .getManyAndCount();

    return { items, total };
  }
}
