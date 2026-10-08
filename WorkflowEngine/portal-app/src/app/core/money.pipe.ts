import { Pipe, PipeTransform } from '@angular/core';
import { ErpDataService } from './erp-data.service';

/** {{ value | money }} / {{ value | money:'USD' }} / {{ value | money:'SAR':true }} (compact) - locale follows the language toggle. */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  constructor(private erp: ErpDataService) {}
  transform(value: number | null | undefined, currency?: string, compact = false): string {
    return this.erp.money(value ?? 0, currency || undefined, compact);
  }
}
