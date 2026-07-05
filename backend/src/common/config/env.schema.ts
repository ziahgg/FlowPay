import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USERNAME: z.string().min(1).default('flowpay'),
  DB_PASSWORD: z.string().min(1).default('flowpay'),
  DB_NAME: z.string().min(1).default('flowpay'),
  JWT_SECRET: z.string().min(32).default('dev-only-insecure-secret-change-me-please-32chars'),
  JWT_EXPIRES_IN: z.string().min(1).default('15m'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  DEPOSIT_MAX_AMOUNT: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'DEPOSIT_MAX_AMOUNT must be a positive decimal string')
    .default('50000'),
  TRANSFER_FEE_FLAT: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, 'TRANSFER_FEE_FLAT must be a non-negative decimal string')
    .default('0'),
  IDEMPOTENCY_STALE_MS: z.coerce.number().int().positive().default(30_000),
  FX_SPREAD_BPS: z.coerce.number().int().nonnegative().default(50),
  RATE_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
});

export type EnvConfig = z.infer<typeof envSchema>;
