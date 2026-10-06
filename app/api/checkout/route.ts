import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { validateTelegramInitData } from "@/lib/telegram";
import { createCheckoutOrder } from "@/lib/telebirr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const e = env();
    const telegramUser = validateTelegramInitData(String(body.initData ?? ""));
    if (!telegramUser) return NextResponse.json({ error: "Invalid Telegram session." }, { status: 401 });

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < e.MIN_DONATION_ETB || amount > e.MAX_DONATION_ETB) {
      return NextResponse.json({ error: `Donation must be between ${e.MIN_DONATION_ETB} and ${e.MAX_DONATION_ETB} ETB.` }, { status: 400 });
    }

    const normalizedAmount = amount.toFixed(2);
    const donorName = body.anonymous ? null : String(body.donorName ?? "").trim().slice(0, 120) || null;
    const message = String(body.message ?? "").trim().slice(0, 300) || null;

    const merchantOrderId = `IGD${Date.now()}${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
    const statusToken = crypto.randomBytes(32).toString("hex");
    const notifyUrl = `${e.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/telebirr/notify`;
    const redirectUrl = `${e.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/payment/result?orderId=${encodeURIComponent(merchantOrderId)}&token=${statusToken}`;
    await db.donation.create({
      data: {
        merchantOrderId,
        statusToken,
        telegramUserId: String(telegramUser.id),
        telegramUsername: telegramUser.username ?? null,
        donorName,
        message,
        anonymous: Boolean(body.anonymous),
        amount: normalizedAmount,
        currency: "ETB",
        status: "PENDING",
      },
    });

    try {
      const order = await createCheckoutOrder({
        title: `Inclusive Growth donation ${normalizedAmount} ETB`,
        amount: normalizedAmount,
        notifyUrl,
        redirectUrl,
        merchantOrderIdOverride: merchantOrderId,
      });

      await db.donation.update({
        where: { merchantOrderId },
        data: { prepayId: order.prepayId },
      });

      return NextResponse.json({ orderId: merchantOrderId, statusToken, checkoutUrl: order.checkoutUrl });
    } catch (error) {
      await db.donation.update({
        where: { merchantOrderId },
        data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 500) : "Telebirr order creation failed" },
      });
      throw error;
    }
  } catch (error) {
    console.error("checkout error", error);
    return NextResponse.json({ error: "Unable to create the Telebirr payment right now." }, { status: 500 });
  }
}
