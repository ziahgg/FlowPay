import { BadRequestException } from '@nestjs/common';

export interface ParsedPair {
  baseCode: string;
  quoteCode: string;
}

/**
 * Splits a "BASE/QUOTE" pair string (e.g. 'BTC/USD') into its two currency codes. There is no
 * dedicated trading-pairs table -- any two distinct, existing currency codes form a valid pair
 * (see README "Trading quickstart" for this simplification); callers still need to validate both
 * codes actually exist via LedgerService.getCurrency().
 */
export function splitPair(pair: string): ParsedPair {
  const parts = pair.split('/');
  if (parts.length !== 2) {
    throw new BadRequestException(`Invalid pair "${pair}"; expected format BASE/QUOTE`);
  }

  const [baseCode, quoteCode] = parts;
  return { baseCode: baseCode.toUpperCase(), quoteCode: quoteCode.toUpperCase() };
}
