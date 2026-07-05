import { HttpStatus, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { EnvConfig } from '../common/config/env.schema';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { RunIdempotentResult } from '../common/idempotency/interfaces/run-idempotent.interface';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { Currency } from '../ledger/entities/currency.entity';
import { JournalEntryType } from '../ledger/entities/journal-entry-type.enum';
import { JournalLineDirection } from '../ledger/entities/journal-line-direction.enum';
import { PostEntryLineInput } from '../ledger/interfaces/post-entry.interface';
import { LedgerService } from '../ledger/ledger.service';
import { RatesService } from '../rates/rates.service';
import { ConvertDto } from './dto/convert.dto';
import { ConvertResponseDto } from './dto/convert-response.dto';
import { QuoteQueryDto } from './dto/quote-query.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { RatesResponseDto } from './dto/rates-response.dto';

const ENDPOINT = 'POST /api/v1/fx/convert';

interface ConversionComputation {
  fromCurrency: Currency;
  toCurrency: Currency;
  fromAmount: string;
  toAmount: string;
  rate: Decimal;
  netRate: Decimal;
  spreadBps: number;
  source: string;
  asOf: Date;
}

@Injectable()
export class FxService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly ratesService: RatesService,
    private readonly idempotencyService: IdempotencyService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async getRatesMatrix(): Promise<RatesResponseDto> {
    const [currencies, snapshot] = await Promise.all([
      this.ledgerService.listCurrencies(),
      this.ratesService.getSnapshot(),
    ]);

    const priced = currencies.filter((currency) => snapshot.prices.has(currency.code));

    const prices: Record<string, string> = {};
    for (const currency of priced) {
      prices[currency.code] = snapshot.prices.get(currency.code)!.toString();
    }

    const matrix: Record<string, Record<string, string>> = {};
    for (const from of priced) {
      const fromPrice = snapshot.prices.get(from.code)!;
      matrix[from.code] = {};
      for (const to of priced) {
        const toPrice = snapshot.prices.get(to.code)!;
        matrix[from.code][to.code] = fromPrice.dividedBy(toPrice).toString();
      }
    }

    return {
      base: 'USD',
      asOf: snapshot.asOf.toISOString(),
      source: snapshot.source,
      prices,
      matrix,
    };
  }

  async getQuote(dto: QuoteQueryDto): Promise<QuoteResponseDto> {
    const computation = await this.computeConversion(dto.from, dto.to, dto.amount);
    const quoteExpiresAt = new Date(computation.asOf.getTime() + this.ratesService.getCacheTtlMs());

    return {
      from: computation.fromCurrency.code,
      to: computation.toCurrency.code,
      amount: computation.fromAmount,
      rate: computation.rate.toString(),
      spreadBps: computation.spreadBps,
      netRate: computation.netRate.toString(),
      toAmount: computation.toAmount,
      quoteExpiresAt: quoteExpiresAt.toISOString(),
      source: computation.source,
    };
  }

  async convert(
    userId: string,
    idempotencyKey: string,
    dto: ConvertDto,
  ): Promise<RunIdempotentResult<ConvertResponseDto>> {
    return this.idempotencyService.run<ConvertResponseDto>({
      userId,
      key: idempotencyKey,
      endpoint: ENDPOINT,
      requestPayload: dto,
      successStatus: HttpStatus.CREATED,
      handler: () => this.executeConvert(userId, dto),
    });
  }

  /**
   * Posts one atomic multi-currency entry: debit user[from] / credit treasury[from] at the
   * user's original amount, then debit treasury[to] / credit user[to] at the net (spread-adjusted)
   * amount. Each currency balances independently (LedgerService enforces this). The spread is
   * never booked as a separate fee line -- it is simply the difference between what the treasury
   * receives (raw `from` amount) and what it gives up (net, spread-reduced `to` amount), so it
   * accumulates implicitly in the treasury's position over time. See README "FX conversion
   * quickstart" for the full rationale.
   */
  private async executeConvert(
    userId: string,
    dto: ConvertDto,
  ): Promise<{ body: ConvertResponseDto; entryId: string }> {
    const computation = await this.computeConversion(dto.from, dto.to, dto.amount);
    const { fromCurrency, toCurrency, fromAmount, toAmount, rate, netRate, spreadBps, source } =
      computation;

    const [fromWallet, toWallet, treasuryFrom, treasuryTo] = await Promise.all([
      this.ledgerService.ensureAccount({
        ownerUserId: userId,
        currencyCode: fromCurrency.code,
        kind: AccountKind.USER_WALLET,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: userId,
        currencyCode: toCurrency.code,
        kind: AccountKind.USER_WALLET,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: fromCurrency.code,
        kind: AccountKind.TREASURY,
      }),
      this.ledgerService.ensureAccount({
        ownerUserId: null,
        currencyCode: toCurrency.code,
        kind: AccountKind.TREASURY,
      }),
    ]);

    const lines: PostEntryLineInput[] = [
      {
        accountId: fromWallet.id,
        direction: JournalLineDirection.DEBIT,
        amount: fromAmount,
        currencyCode: fromCurrency.code,
      },
      {
        accountId: treasuryFrom.id,
        direction: JournalLineDirection.CREDIT,
        amount: fromAmount,
        currencyCode: fromCurrency.code,
      },
      {
        accountId: treasuryTo.id,
        direction: JournalLineDirection.DEBIT,
        amount: toAmount,
        currencyCode: toCurrency.code,
      },
      {
        accountId: toWallet.id,
        direction: JournalLineDirection.CREDIT,
        amount: toAmount,
        currencyCode: toCurrency.code,
      },
    ];

    const result = await this.ledgerService.postEntry({
      type: JournalEntryType.FX_CONVERT,
      description: `Converted ${fromAmount} ${fromCurrency.code} to ${toAmount} ${toCurrency.code}`,
      metadata: {
        rate: rate.toString(),
        netRate: netRate.toString(),
        spreadBps,
        rateSource: source,
      },
      lines,
    });

    const body: ConvertResponseDto = {
      entryId: result.entryId,
      from: fromCurrency.code,
      to: toCurrency.code,
      amount: fromAmount,
      toAmount,
      rate: rate.toString(),
      netRate: netRate.toString(),
      spreadBps,
      fromBalance: result.balances[fromWallet.id],
      toBalance: result.balances[toWallet.id],
    };

    return { body, entryId: result.entryId };
  }

  private async computeConversion(
    fromCode: string,
    toCode: string,
    amount: string,
  ): Promise<ConversionComputation> {
    const [fromCurrency, toCurrency] = await Promise.all([
      this.ledgerService.getCurrency(fromCode),
      this.ledgerService.getCurrency(toCode),
    ]);

    if (fromCurrency.code === toCurrency.code) {
      throw new UnprocessableEntityException('from and to currencies must differ');
    }

    const spreadBps = this.configService.get('FX_SPREAD_BPS', { infer: true });
    const { rate, source, asOf } = await this.ratesService.getRate(
      fromCurrency.code,
      toCurrency.code,
    );

    const netRate = rate.times(new Decimal(1).minus(new Decimal(spreadBps).dividedBy(10_000)));

    // All rounding to a currency's native precision uses banker's rounding (round-half-even), so
    // amounts landing exactly on the midpoint don't systematically bias in one direction across
    // many conversions.
    const fromAmount = new Decimal(amount).toDecimalPlaces(
      fromCurrency.decimals,
      Decimal.ROUND_HALF_EVEN,
    );
    const toAmount = fromAmount
      .times(netRate)
      .toDecimalPlaces(toCurrency.decimals, Decimal.ROUND_HALF_EVEN);

    return {
      fromCurrency,
      toCurrency,
      fromAmount: fromAmount.toFixed(fromCurrency.decimals),
      toAmount: toAmount.toFixed(toCurrency.decimals),
      rate,
      netRate,
      spreadBps,
      source,
      asOf,
    };
  }
}
