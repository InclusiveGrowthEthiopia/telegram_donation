import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEBIRR_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
  TELEBIRR_FABRIC_APP_ID: z.string().min(1),
  TELEBIRR_APP_SECRET: z.string().min(1),
  TELEBIRR_MERCHANT_APP_ID: z.string().min(1),
  TELEBIRR_MERCHANT_CODE: z.string().min(1),
  TELEBIRR_PRIVATE_KEY: z.string().min(1),
  TELEBIRR_PUBLIC_KEY: z.string().min(1),
  TELEBIRR_API_BASE_URL: z.string().url().optional(),
  TELEBIRR_WEB_CHECKOUT_BASE_URL: z.string().url().optional(),
  MIN_DONATION_ETB: z.coerce.number().positive().default(10),
  MAX_DONATION_ETB: z.coerce.number().positive().default(100000),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
