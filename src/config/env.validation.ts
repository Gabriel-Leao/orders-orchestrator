import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);

const positiveIntegerSchema = z.coerce.number().int().positive();

const nonEmptyStringSchema = z.string().trim().min(1);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  PORT: portSchema.default(3333),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  API_KEY: nonEmptyStringSchema,

  DB_HOST: nonEmptyStringSchema,
  DB_PORT: portSchema.default(5432),
  DB_USER: nonEmptyStringSchema,
  DB_PASSWORD: z.string().min(1),
  DB_NAME: nonEmptyStringSchema,

  REDIS_HOST: nonEmptyStringSchema,
  REDIS_PORT: portSchema.default(6379),

  EXCHANGE_API_URL: z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
      },
      { message: 'Must be an HTTP or HTTPS URL' },
    ),

  TARGET_CURRENCY: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Must be a 3-letter uppercase currency code')
    .default('BRL'),

  EXTERNAL_TIMEOUT_MS: positiveIntegerSchema.default(5000),

  ENRICHMENT_MAX_ATTEMPTS: positiveIntegerSchema.default(5),

  ENRICHMENT_BACKOFF_MS: positiveIntegerSchema
    .refine((value) => value >= 100, {
      message: 'Must be at least 100 milliseconds',
    })
    .default(1000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.') || 'environment';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return result.data;
}
