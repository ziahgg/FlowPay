import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { AccountBalance } from '../../../core/models/account.model';
import { CurrencyAmountPipe } from '../../pipes/currency-amount.pipe';

@Component({
  selector: 'app-balance-card',
  imports: [MatCardModule, CurrencyAmountPipe],
  templateUrl: './balance-card.html',
  styleUrl: './balance-card.scss',
})
export class BalanceCard {
  balance = input.required<AccountBalance>();
}
