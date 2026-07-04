import { Pipe, PipeTransform } from '@angular/core';
import Decimal from 'decimal.js';

/**
 * Formats a decimal-string money amount for display, honoring the currency's own decimal places
 * (2 for fiat, 8 for crypto). Never converts through a JS `number` -- matches the project-wide
 * "no floating point for money" rule even in the presentation layer.
 */
@Pipe({ name: 'currencyAmount' })
export class CurrencyAmountPipe implements PipeTransform {
  transform(value: string | null | undefined, decimals: number): string {
    if (value == null || value === '') {
      return '—';
    }

    const fixed = new Decimal(value).toFixed(decimals);
    const [whole, fraction] = fixed.split('.');
    const wholeWithSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return fraction ? `${wholeWithSeparators}.${fraction}` : wholeWithSeparators;
  }
}
