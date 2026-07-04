import { TitleCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { WithdrawalRequestStatus } from '../../../core/models/withdrawal.model';

@Component({
  selector: 'app-status-chip',
  imports: [MatChipsModule, TitleCasePipe],
  templateUrl: './status-chip.html',
  styleUrl: './status-chip.scss',
})
export class StatusChip {
  status = input.required<WithdrawalRequestStatus>();
}
