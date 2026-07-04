import 'dotenv/config';
import * as argon2 from 'argon2';
import AppDataSource from '../typeorm.config';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';

const ADMIN_EMAIL = 'admin@flowpay.dev';

async function seed(): Promise<void> {
  await AppDataSource.initialize();

  try {
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
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
