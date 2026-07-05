import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { EnvConfig } from '../common/config/env.schema';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { RunIdempotentParams } from '../common/idempotency/interfaces/run-idempotent.interface';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { EnsureAccountInput } from '../ledger/interfaces/ensure-account.interface';
import { LedgerService } from '../ledger/ledger.service';
import { RatesService } from '../rates/rates.service';
import { FxService } from './fx.service';

const CURRENCIES: Record<
  string,
  { code: string; name: string; type: CurrencyType; decimals: number }
> = {
  USD: { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
  EUR: { code: 'EUR', name: 'Euro', type: CurrencyType.FIAT, decimals: 2 },
  BTC: { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
};

describe('FxService', () => {
  let service: FxService;
  let ledgerService: jest.Mocked<
    Pick<LedgerService, 'getCurrency' | 'ensureAccount' | 'postEntry' | 'listCurrencies'>
  >;
  let ratesService: jest.Mocked<Pick<RatesService, 'getRate' | 'getSnapshot' | 'getCacheTtlMs'>>;
  let idempotencyService: { run: jest.Mock };
  let configService: { get: jest.Mock };

  const userId = 'user-1';

  beforeEach(() => {
    ledgerService = {
      getCurrency: jest
        .fn()
        .mockImplementation((code: string) => Promise.resolve(CURRENCIES[code])),
      ensureAccount: jest
        .fn()
        .mockImplementation(({ ownerUserId, currencyCode, kind }: EnsureAccountInput) =>
          Promise.resolve({
            id: `${kind}-${currencyCode}-${ownerUserId ?? 'system'}`,
            ownerUserId,
            currencyCode,
            kind,
          }),
        ),
      postEntry: jest.fn().mockResolvedValue({
        entryId: 'entry-1',
        balances: {
          [`${AccountKind.USER_WALLET}-USD-${userId}`]: '900.00',
          [`${AccountKind.USER_WALLET}-BTC-${userId}`]: '0.00199000',
        },
      }),
      listCurrencies: jest.fn(),
    };

    ratesService = {
      getRate: jest.fn(),
      getSnapshot: jest.fn(),
      getCacheTtlMs: jest.fn().mockReturnValue(30_000),
    };

    idempotencyService = {
      run: jest.fn(async (params: RunIdempotentParams<unknown>) => {
        const { body } = await params.handler();
        return { body, statusCode: params.successStatus, replayed: false };
      }),
    };

    configService = { get: jest.fn().mockReturnValue(50) };

    service = new FxService(
      ledgerService as unknown as LedgerService,
      ratesService as unknown as RatesService,
      idempotencyService as unknown as IdempotencyService,
      configService as unknown as ConfigService<EnvConfig, true>,
    );
  });

  describe('getRatesMatrix', () => {
    it('builds a USD-anchored price list and a full pairwise matrix', async () => {
      ledgerService.listCurrencies.mockResolvedValue([CURRENCIES.USD, CURRENCIES.BTC] as never);
      ratesService.getSnapshot.mockResolvedValue({
        prices: new Map([
          ['USD', new Decimal(1)],
          ['BTC', new Decimal(50_000)],
        ]),
        source: 'coingecko',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.getRatesMatrix();

      expect(result.base).toBe('USD');
      expect(result.source).toBe('coingecko');
      expect(result.prices).toEqual({ USD: '1', BTC: '50000' });
      expect(result.matrix.USD.BTC).toBe('0.00002');
      expect(result.matrix.BTC.USD).toBe('50000');
    });
  });

  describe('getQuote', () => {
    it('applies the configured spread and rounds toAmount half-even', async () => {
      configService.get.mockReturnValue(0); // isolate rounding from spread math
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('2.125'),
        source: 'static-fallback',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });

      const quote = await service.getQuote({ from: 'USD', to: 'EUR', amount: '1' });

      // 1.00 * 2.125 = 2.125, exactly at the rounding midpoint -- half-even rounds to the
      // neighbor with an even last digit (2.12, not 2.13).
      expect(quote.toAmount).toBe('2.12');
      expect(quote.rate).toBe('2.125');
      expect(quote.netRate).toBe('2.125');
      expect(quote.quoteExpiresAt).toBe(new Date('2026-01-01T00:00:30.000Z').toISOString());
    });

    it('rounds the other half-even direction when the preceding digit is odd', async () => {
      configService.get.mockReturnValue(0);
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('2.135'),
        source: 'static-fallback',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });

      const quote = await service.getQuote({ from: 'USD', to: 'EUR', amount: '1' });

      expect(quote.toAmount).toBe('2.14');
    });

    it('reduces the raw rate by the configured spread', async () => {
      configService.get.mockReturnValue(50); // 0.50%
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('100'),
        source: 'coingecko',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });

      const quote = await service.getQuote({ from: 'USD', to: 'EUR', amount: '10' });

      expect(quote.netRate).toBe('99.5');
      expect(quote.toAmount).toBe('995.00');
      expect(quote.spreadBps).toBe(50);
    });

    it('rejects converting a currency to itself', async () => {
      await expect(
        service.getQuote({ from: 'USD', to: 'USD', amount: '10' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('convert', () => {
    it('posts one atomic 4-line entry: debit/credit from, then debit/credit to at the net rate', async () => {
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('0.00002'),
        source: 'coingecko',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.convert(userId, 'idem-key-1', {
        from: 'USD',
        to: 'BTC',
        amount: '100',
      });

      expect(idempotencyService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          key: 'idem-key-1',
          endpoint: 'POST /api/v1/fx/convert',
          successStatus: 201,
        }),
      );

      const postedEntry = ledgerService.postEntry.mock.calls[0][0];
      expect(postedEntry.lines).toEqual([
        {
          accountId: `${AccountKind.USER_WALLET}-USD-${userId}`,
          direction: JournalLineDirection.DEBIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
        {
          accountId: `${AccountKind.TREASURY}-USD-system`,
          direction: JournalLineDirection.CREDIT,
          amount: '100.00',
          currencyCode: 'USD',
        },
        {
          accountId: `${AccountKind.TREASURY}-BTC-system`,
          direction: JournalLineDirection.DEBIT,
          amount: '0.00199000',
          currencyCode: 'BTC',
        },
        {
          accountId: `${AccountKind.USER_WALLET}-BTC-${userId}`,
          direction: JournalLineDirection.CREDIT,
          amount: '0.00199000',
          currencyCode: 'BTC',
        },
      ]);

      expect(result.body).toEqual({
        entryId: 'entry-1',
        from: 'USD',
        to: 'BTC',
        amount: '100.00',
        toAmount: '0.00199000',
        rate: '0.00002',
        netRate: '0.0000199',
        spreadBps: 50,
        fromBalance: '900.00',
        toBalance: '0.00199000',
      });
    });

    it('rejects converting a currency to itself before touching the ledger', async () => {
      await expect(
        service.convert(userId, 'idem-key-2', { from: 'USD', to: 'USD', amount: '10' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ledgerService.postEntry).not.toHaveBeenCalled();
    });

    it('propagates a ledger rejection (e.g. insufficient funds) unchanged', async () => {
      ratesService.getRate.mockResolvedValue({
        rate: new Decimal('0.00002'),
        source: 'coingecko',
        asOf: new Date('2026-01-01T00:00:00.000Z'),
      });
      const error = new Error('insufficient funds');
      ledgerService.postEntry.mockRejectedValue(error);

      await expect(
        service.convert(userId, 'idem-key-3', { from: 'USD', to: 'BTC', amount: '100' }),
      ).rejects.toBe(error);
    });
  });
});
