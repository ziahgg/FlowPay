import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'entryTypeLabel' })
export class EntryTypeLabelPipe implements PipeTransform {
  transform(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}
