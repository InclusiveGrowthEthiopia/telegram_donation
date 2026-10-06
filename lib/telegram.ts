import crypto from "node:crypto";
import { env } from "./env";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

function secretKey(botToken: string) {
  return crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
}

export function validateTelegramInitData(initData: string): TelegramUser | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const calculated = crypto
    .createHmac("sha256", secretKey(env().TELEGRAM_BOT_TOKEN))
    .update(dataCheckString)
    .digest("hex");

  if (calculated.length !== receivedHash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(receivedHash))) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    return JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
}
