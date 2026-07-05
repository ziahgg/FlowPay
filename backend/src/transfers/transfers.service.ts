import {
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { EnvConfig } from '../common/config/env.schema';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { RunIdempotentResult } from '../common/idempotency/interfaces/run-idempotent.interface';
import { DomainEventType } from '../common/outbox/domain-event-type.enum';
import { OutboxService } from '../common/outbox/outbox.service';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { PostEntryLineInput } from '../ledger/interfaces/post-entry.interface';
import { LedgerService } from '../ledger/ledger.service';
import { UsersService } from '../users/users.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferHistoryItemDto } from './dto/transfer-history-item.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';

const ENDPOINT = 'POST /api/v1/transfers';

@Injectable()
export class TransfersService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly usersService: UsersService,
    private readonly idempotencyService: IdempotencyService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(
    senderId: string,
    idempotencyKey: string,
    dto: CreateTransferDto,
  ): Promise<RunIdempotentResult<TransferResponseDto>> {
    return this.idempotencyService.run<TransferResponseDto>({
      userId: senderId,
      key: idempotencyKey,
      endpoint: ENDPOINT,
      requestPayload: dto,
      successStatus: HttpStatus.CREATED,
      handler: () => this.executeTransfer(senderId, dto),
    });
  }

  private async executeTransfer(
    senderId: string,
    dto: CreateTransferDto,
  ): Promise<{ body: TransferResponseDto; entryId: string }> {
    const currency = await this.ledgerService.getCurrency(dto.currency);

    const [sender, recipient] = await Promise.all([
      this.usersService.findById(senderId),
      this.usersService.findByEmail(dto.recipientEmail),
    ]);

    if (!recipient) {
      throw new NotFoundException(`No user found with email ${dto.recipientEmail}`);
    }
    if (recipient.id === senderId) {
      throw new UnprocessableEntityException('Cannot transfer to your own account');
    }

    const feeFlat = this.configService.get('TRANSFER_FEE_FLAT', { infer: true });
    const fee = new Decimal(feeFlat);
    const hasFee = fee.greaterThan(0);

    const [senderWallet, recipientWallet, feesAccount] = await Promise.all([
      this.ledgerService.ensureAccount({
        ownerUserId: senderId,
        currencyCode: currency.code,
        kind: AccountKind.USER_WALLET,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: recipient.id,
        currencyCode: currency.code,
        kind: AccountKind.USER_WALLET,
      }),
      hasFee
        ? this.ledgerService.ensureAccount({
            ownerUserId: null,
            currencyCode: currency.code,
            kind: AccountKind.FEES,
          })
        : Promise.resolve(null),
    ]);

    const debitAmount = new Decimal(dto.amount).plus(fee).toFixed(8);

    const lines: PostEntryLineInput[] = [
      {
        accountId: senderWallet.id,
        direction: JournalLineDirection.DEBIT,
        amount: debitAmount,
        currencyCode: currency.code,
      },
      {
        accountId: recipientWallet.id,
        direction: JournalLineDirection.CREDIT,
        amount: dto.amount,
        currencyCode: currency.code,
      },
    ];

    if (hasFee && feesAccount) {
      lines.push({
        accountId: feesAccount.id,
        direction: JournalLineDirection.CREDIT,
        amount: fee.toFixed(8),
        currencyCode: currency.code,
      });
    }

    // The outbox row is appended in the SAME transaction as the ledger entry -- see
    // common/outbox/outbox.service.ts and README "Event-driven architecture" for why that
    // atomicity is the entire point of the pattern.
    const result = await this.dataSource.transaction(async (manager) => {
      const postResult = await this.ledgerService.postEntry(
        {
          type: JournalEntryType.TRANSFER,
          description:
            dto.note ?? `Transfer of ${dto.amount} ${currency.code} to ${recipient.email}`,
          metadata: {
            senderId,
            senderEmail: sender?.email ?? null,
            recipientId: recipient.id,
            recipientEmail: recipient.email,
            note: dto.note ?? null,
          },
          lines,
        },
        manager,
      );

      await this.outboxService.append(
        {
          eventType: DomainEventType.TRANSFER_COMPLETED,
          aggregateId: postResult.entryId,
          payload: {
            recipientEmail: recipient.email,
            senderEmail: sender?.email ?? null,
            currency: currency.code,
            amount: dto.amount,
            note: dto.note ?? null,
          },
        },
        manager,
      );

      return postResult;
    });

    const body: TransferResponseDto = {
      entryId: result.entryId,
      currency: currency.code,
      amount: dto.amount,
      balance: result.balances[senderWallet.id],
    };

    return { body, entryId: result.entryId };
  }

  async listHistory(
    userId: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResponseDto<TransferHistoryItemDto>> {
    const { items, total } = await this.ledgerService.listJournalLinesForOwner(
      userId,
      { type: JournalEntryType.TRANSFER },
      pagination,
    );

    const data: TransferHistoryItemDto[] = items.map((line) => {
      const metadata = line.entry.metadata ?? {};
      const isSender = line.direction === JournalLineDirection.DEBIT;

      return {
        entryId: line.entry.id,
        direction: isSender ? 'sent' : 'received',
        currency: line.currencyCode,
        amount: line.amount,
        counterpartyEmail:
          ((isSender ? metadata.recipientEmail : metadata.senderEmail) as string | undefined) ??
          null,
        note: (metadata.note as string | undefined) ?? null,
        createdAt: line.createdAt,
      };
    });

    return { data, meta: { page: pagination.page, limit: pagination.limit, total } };
  }
}
