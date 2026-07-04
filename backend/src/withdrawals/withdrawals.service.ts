import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { LedgerService } from '../ledger/ledger.service';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WithdrawalRequestStatus } from './entities/withdrawal-request-status.enum';
import { WithdrawalResponseDto } from './dto/withdrawal-response.dto';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly ledgerService: LedgerService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRequestRepository: Repository<WithdrawalRequest>,
  ) {}

  async requestWithdrawal(
    userId: string,
    currencyCode: string,
    amount: string,
    destination: string,
  ): Promise<WithdrawalResponseDto> {
    const currency = await this.ledgerService.getCurrency(currencyCode);

    const [wallet, pending] = await Promise.all([
      this.ledgerService.ensureAccount({
        ownerUserId: userId,
        currencyCode: currency.code,
        kind: AccountKind.USER_WALLET,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: currency.code,
        kind: AccountKind.WITHDRAWAL_PENDING,
      }),
    ]);

    const created = await this.dataSource.transaction(async (manager) => {
      const result = await this.ledgerService.postEntry(
        {
          type: JournalEntryType.WITHDRAWAL_HOLD,
          description: `Withdrawal hold of ${amount} ${currency.code} to ${destination}`,
          metadata: { userId, currencyCode: currency.code, destination },
          lines: [
            {
              accountId: wallet.id,
              direction: JournalLineDirection.DEBIT,
              amount,
              currencyCode: currency.code,
            },
            {
              accountId: pending.id,
              direction: JournalLineDirection.CREDIT,
              amount,
              currencyCode: currency.code,
            },
          ],
        },
        manager,
      );

      const repository = manager.getRepository(WithdrawalRequest);
      const request = repository.create({
        userId,
        currencyCode: currency.code,
        amount,
        destination,
        status: WithdrawalRequestStatus.PENDING,
        holdEntryId: result.entryId,
      });

      return repository.save(request);
    });

    return this.toDto(created);
  }

  async approve(id: string, adminId: string): Promise<WithdrawalResponseDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockPendingRequest(manager, id);

      const [pending, treasury] = await Promise.all([
        this.ledgerService.ensureAccount({
          ownerUserId: null,
          currencyCode: request.currencyCode,
          kind: AccountKind.WITHDRAWAL_PENDING,
        }),
        this.ledgerService.ensureAccount({
          ownerUserId: null,
          currencyCode: request.currencyCode,
          kind: AccountKind.TREASURY,
        }),
      ]);

      const result = await this.ledgerService.postEntry(
        {
          type: JournalEntryType.WITHDRAWAL_SETTLE,
          description: `Withdrawal settle of ${request.amount} ${request.currencyCode}`,
          metadata: { withdrawalRequestId: request.id, adminId },
          lines: [
            {
              accountId: pending.id,
              direction: JournalLineDirection.DEBIT,
              amount: request.amount,
              currencyCode: request.currencyCode,
            },
            {
              accountId: treasury.id,
              direction: JournalLineDirection.CREDIT,
              amount: request.amount,
              currencyCode: request.currencyCode,
            },
          ],
        },
        manager,
      );

      request.status = WithdrawalRequestStatus.APPROVED;
      request.decidedBy = adminId;
      request.decidedAt = new Date();
      request.settleEntryId = result.entryId;

      return manager.save(request);
    });

    return this.toDto(updated);
  }

  async reject(id: string, adminId: string): Promise<WithdrawalResponseDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockPendingRequest(manager, id);

      const [pending, wallet] = await Promise.all([
        this.ledgerService.ensureAccount({
          ownerUserId: null,
          currencyCode: request.currencyCode,
          kind: AccountKind.WITHDRAWAL_PENDING,
        }),
        this.ledgerService.ensureAccount({
          ownerUserId: request.userId,
          currencyCode: request.currencyCode,
          kind: AccountKind.USER_WALLET,
        }),
      ]);

      const result = await this.ledgerService.postEntry(
        {
          type: JournalEntryType.WITHDRAWAL_RELEASE,
          description: `Withdrawal release of ${request.amount} ${request.currencyCode}`,
          metadata: { withdrawalRequestId: request.id, adminId },
          lines: [
            {
              accountId: pending.id,
              direction: JournalLineDirection.DEBIT,
              amount: request.amount,
              currencyCode: request.currencyCode,
            },
            {
              accountId: wallet.id,
              direction: JournalLineDirection.CREDIT,
              amount: request.amount,
              currencyCode: request.currencyCode,
            },
          ],
        },
        manager,
      );

      request.status = WithdrawalRequestStatus.REJECTED;
      request.decidedBy = adminId;
      request.decidedAt = new Date();
      request.settleEntryId = result.entryId;

      return manager.save(request);
    });

    return this.toDto(updated);
  }

  async listForUser(
    userId: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResponseDto<WithdrawalResponseDto>> {
    const [items, total] = await this.withdrawalRequestRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return {
      data: items.map((item) => this.toDto(item)),
      meta: { page: pagination.page, limit: pagination.limit, total },
    };
  }

  async listForAdmin(
    filter: { status?: WithdrawalRequestStatus },
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResponseDto<WithdrawalResponseDto>> {
    const [items, total] = await this.withdrawalRequestRepository.findAndCount({
      where: filter.status ? { status: filter.status } : {},
      order: { createdAt: 'DESC' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });

    return {
      data: items.map((item) => this.toDto(item)),
      meta: { page: pagination.page, limit: pagination.limit, total },
    };
  }

  /**
   * Locks the request row for the duration of the caller's transaction so that two concurrent
   * decisions on the same request serialize: the second to acquire the lock re-reads the
   * already-decided row and hits the pending-status guard below.
   */
  private async lockPendingRequest(manager: EntityManager, id: string): Promise<WithdrawalRequest> {
    const request = await manager.findOne(WithdrawalRequest, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (request.status !== WithdrawalRequestStatus.PENDING) {
      throw new ConflictException(`Withdrawal request is already ${request.status}`);
    }

    return request;
  }

  private toDto(entity: WithdrawalRequest): WithdrawalResponseDto {
    return {
      id: entity.id,
      currency: entity.currencyCode,
      amount: entity.amount,
      destination: entity.destination,
      status: entity.status,
      holdEntryId: entity.holdEntryId,
      settleEntryId: entity.settleEntryId,
      decidedBy: entity.decidedBy,
      decidedAt: entity.decidedAt,
      createdAt: entity.createdAt,
    };
  }
}
