import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { AccountKind } from '../ledger/entities/account-kind.enum';
import { Currency } from '../ledger/entities/currency.entity';
import { CurrencyType } from '../ledger/entities/currency-type.enum';
import { LedgerService } from '../ledger/ledger.service';
import AppDataSource from '../typeorm.config';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';

const ADMIN_EMAIL = 'admin@flowpay.dev';

const CURRENCIES: Array<{ code: string; name: string; type: CurrencyType; decimals: number }> = [
  { code: 'USD', name: 'US Dollar', type: CurrencyType.FIAT, decimals: 2 },
  { code: 'EUR', name: 'Euro', type: CurrencyType.FIAT, decimals: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', type: CurrencyType.FIAT, decimals: 2 },
  { code: 'BTC', name: 'Bitcoin', type: CurrencyType.CRYPTO, decimals: 8 },
  { code: 'ETH', name: 'Ethereum', type: CurrencyType.CRYPTO, decimals: 8 },
];

const SYSTEM_ACCOUNT_KINDS = [
  AccountKind.TREASURY,
  AccountKind.FEES,
  AccountKind.WITHDRAWAL_PENDING,
];

async function seedAdmin(): Promise<void> {
  const repository = AppDataSource.getRepository(User);
  const existing = await repository.findOne({ where: { email: ADMIN_EMAIL } });

  if (existing) {
    console.log(`Seed: admin user "${ADMIN_EMAIL}" already exists, skipping.`);
    return;
  }

  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await argon2.hash(password);
  const admin = repository.create({ email: ADMIN_EMAIL, passwordHash, role: UserRole.ADMIN });
  await repository.save(admin);
  console.log(`Seed: created admin user "${ADMIN_EMAIL}".`);
}

async function seedCurrencies(): Promise<void> {
  const repository = AppDataSource.getRepository(Currency);
  await repository.upsert(CURRENCIES, ['code']);
  console.log(`Seed: ensured ${CURRENCIES.length} currencies.`);
}

// Goes through LedgerService.ensureAccount (not a direct insert) so system accounts are created
// via the same, tested code path as everything else -- per the "ledger writes only through
// LedgerService" rule in CLAUDE.md.
async function seedSystemAccounts(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const ledgerService = app.get(LedgerService);

    for (const currency of CURRENCIES) {
      for (const kind of SYSTEM_ACCOUNT_KINDS) {
        await ledgerService.ensureAccount({ ownerUserId: null, currencyCode: currency.code, kind });
      }
    }

    console.log(`Seed: ensured system accounts for ${CURRENCIES.length} currencies.`);
  } finally {
    await app.close();
  }
}

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  try {
    await seedAdmin();
    await seedCurrencies();
  } finally {
    await AppDataSource.destroy();
  }

  await seedSystemAccounts();
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
