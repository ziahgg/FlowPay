import { TitleCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';

// Shared across withdrawal statuses ('pending'|'approved'|'rejected') and order statuses
// ('open'|'filled'|'cancelled') -- see status-chip.scss for the per-value color mapping.
@Component({
  selector: 'app-status-chip',
  imports: [MatChipsModule, TitleCasePipe],
  templateUrl: './status-chip.html',
  styleUrl: './status-chip.scss',
})
export class StatusChip {
  status = input.required<string>();
}
