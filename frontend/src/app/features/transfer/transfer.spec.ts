import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AccountsService } from '../../core/services/accounts.service';
import { ToastService } from '../../core/services/toast.service';
import { TransfersService } from '../../core/services/transfers.service';
import { Transfer } from './transfer';

describe('Transfer — Idempotency-Key retry behavior', () => {
  let fixture: ComponentFixture<Transfer>;
  let component: Transfer;
  let createSpy: ReturnType<typeof vi.fn>;

  const fillForm = (amount: string): void => {
    component['form'].setValue({
      recipientEmail: 'jane@example.com',
      currency: 'USD',
      amount,
      note: '',
    });
  };

  beforeEach(async () => {
    createSpy = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Transfer],
      providers: [
        {
          provide: AccountsService,
          useValue: {
            getBalances: () => of([{ currency: 'USD', balance: '100.00000000', decimals: 2 }]),
          },
        },
        {
          provide: TransfersService,
          useValue: {
            create: createSpy,
            listHistory: () => of({ data: [], meta: { page: 1, limit: 10, total: 0 } }),
          },
        },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Transfer);
    component = fixture.componentInstance;
    fixture.detectChanges();

    fillForm('10.00');
  });

  it('reuses the same key across a retry after a network error, then issues a fresh key after success', () => {
    createSpy.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    component['submit']();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const firstKey = createSpy.mock.calls[0]?.[1] as string;
    expect(firstKey).toBeTruthy();

    // Retrying the exact same failed attempt must reuse the same Idempotency-Key.
    createSpy.mockReturnValueOnce(
      of({ entryId: 'entry-1', currency: 'USD', amount: '10.00', balance: '90.00000000' }),
    );
    component['submit']();

    expect(createSpy).toHaveBeenCalledTimes(2);
    const secondKey = createSpy.mock.calls[1]?.[1] as string;
    expect(secondKey).toBe(firstKey);

    // A brand-new submission after a completed transfer is a new logical operation.
    fillForm('5.00');
    createSpy.mockReturnValueOnce(
      of({ entryId: 'entry-2', currency: 'USD', amount: '5.00', balance: '85.00000000' }),
    );
    component['submit']();

    expect(createSpy).toHaveBeenCalledTimes(3);
    const thirdKey = createSpy.mock.calls[2]?.[1] as string;
    expect(thirdKey).not.toBe(firstKey);
  });

  it('does not reuse the key after a definitive server error (only after a network error)', () => {
    createSpy.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { message: 'Cannot transfer to your own account' },
          }),
      ),
    );
    component['submit']();
    const firstKey = createSpy.mock.calls[0]?.[1] as string;

    createSpy.mockReturnValueOnce(
      of({ entryId: 'entry-1', currency: 'USD', amount: '10.00', balance: '90.00000000' }),
    );
    component['submit']();
    const secondKey = createSpy.mock.calls[1]?.[1] as string;

    expect(secondKey).not.toBe(firstKey);
  });
});
