import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { validateTelegramInitData } from "@/lib/telegram";
import { createCheckoutOrder } from "@/lib/telebirr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // ------------------------------------------------------------
    // Read request body
    // ------------------------------------------------------------

    const body = await request.json();

    const e = env();

    // ------------------------------------------------------------
    // Validate Telegram Mini App session
    // ------------------------------------------------------------

    const telegramUser = validateTelegramInitData(
      String(body.initData ?? "")
    );

    if (!telegramUser) {
      return NextResponse.json(
        {
          error: "Invalid Telegram session.",
        },
        { status: 401 }
      );
    }

    // ------------------------------------------------------------
    // Validate donation amount
    // ------------------------------------------------------------

    const amount = Number(body.amount);

    if (
      !Number.isFinite(amount) ||
      amount < e.MIN_DONATION_ETB ||
      amount > e.MAX_DONATION_ETB
    ) {
      return NextResponse.json(
        {
          error: `Donation must be between ${e.MIN_DONATION_ETB} and ${e.MAX_DONATION_ETB} ETB.`,
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Normalize amount
    // ------------------------------------------------------------

    const normalizedAmount = amount.toFixed(2);

    // ------------------------------------------------------------
    // Donor information
    // ------------------------------------------------------------

    const donorName = body.anonymous
      ? null
      : String(body.donorName ?? "")
          .trim()
          .slice(0, 120) || null;

    const message =
      String(body.message ?? "")
        .trim()
        .slice(0, 300) || null;

    // ------------------------------------------------------------
    // Create unique merchant order ID
    // ------------------------------------------------------------

    const merchantOrderId = `IGD${Date.now()}${crypto
      .randomBytes(10)
      .toString("hex")
      .toUpperCase()}`;

    // ------------------------------------------------------------
    // Create private status token
    // ------------------------------------------------------------

    const statusToken = crypto
      .randomBytes(32)
      .toString("hex");

    // ------------------------------------------------------------
    // Build public callback URL
    // ------------------------------------------------------------

    const appUrl = e.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

    const notifyUrl =
      `${appUrl}/api/telebirr/notify`;

    // ------------------------------------------------------------
    // Build payment return URL
    // ------------------------------------------------------------

    const redirectUrl =
      `${appUrl}/payment/result?orderId=${encodeURIComponent(
        merchantOrderId
      )}&token=${encodeURIComponent(statusToken)}`;

    // ------------------------------------------------------------
    // Save donation before contacting Telebirr
    // ------------------------------------------------------------

    await db.donation.create({
      data: {
        merchantOrderId,

        statusToken,

        telegramUserId: String(
          telegramUser.id
        ),

        telegramUsername:
          telegramUser.username ?? null,

        donorName,

        message,

        anonymous: Boolean(
          body.anonymous
        ),

        amount: normalizedAmount,

        // Telebirr donation currency
        currency: "ETB",

        status: "PENDING",
      },
    });

    // ------------------------------------------------------------
    // Create Telebirr checkout order
    // ------------------------------------------------------------

    try {
      const order =
        await createCheckoutOrder({
          title: `Inclusive Growth donation ${normalizedAmount} ETB`,

          amount: normalizedAmount,

          notifyUrl,

          redirectUrl,

          merchantOrderIdOverride:
            merchantOrderId,
        });

      // ----------------------------------------------------------
      // Save Telebirr prepay ID
      // ----------------------------------------------------------

      await db.donation.update({
        where: {
          merchantOrderId,
        },

        data: {
          prepayId: order.prepayId,
        },
      });

      // ----------------------------------------------------------
      // Return checkout information
      // ----------------------------------------------------------

      return NextResponse.json({
        orderId: merchantOrderId,

        statusToken,

        checkoutUrl: order.checkoutUrl,
      });
    } catch (error) {
      // ----------------------------------------------------------
      // Telebirr order creation failed
      // ----------------------------------------------------------

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Telebirr order creation failed";

      console.error(
        "Telebirr order creation failed:",
        error
      );

      // ----------------------------------------------------------
      // Mark donation as failed
      // ----------------------------------------------------------

      await db.donation.update({
        where: {
          merchantOrderId,
        },

        data: {
          status: "FAILED",

          lastError:
            errorMessage.slice(0, 500),
        },
      });

      throw error;
    }
  } catch (error) {
    // ------------------------------------------------------------
    // IMPORTANT:
    // This log lets us see the actual error in Vercel Logs.
    // It does NOT expose environment variables or private keys.
    // ------------------------------------------------------------

    console.error(
      "checkout error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to create the Telebirr payment right now.",
      },
      { status: 500 }
    );
  }
}