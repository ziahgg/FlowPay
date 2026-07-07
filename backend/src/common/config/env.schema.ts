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
  KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().min(1).default('flowpay-backend'),
  NOTIFICATIONS_CONSUMER_GROUP_ID: z.string().min(1).default('flowpay-notifications'),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().email().default('no-reply@flowpay.dev'),
  // Comma-separated allowlist of origins allowed to call this API cross-origin (e.g. a frontend
  // served from a different host/port than this API, such as the K8s deployment). The Angular dev
  // server itself never needs an entry here -- its dev proxy makes every browser request
  // same-origin, so no CORS headers are involved at all (see README "Quickstart").
  CORS_ORIGIN: z.string().min(1).default('http://localhost:4200'),
});

export type EnvConfig = z.infer<typeof envSchema>;
