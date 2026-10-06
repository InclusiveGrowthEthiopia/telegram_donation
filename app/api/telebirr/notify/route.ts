import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyResponse } from "@/lib/telebirr";

export const runtime = "nodejs";

function text(value: unknown) {
  return typeof value === "string"
    ? value
    : value == null
      ? ""
      : String(value);
}

export async function POST(request: Request) {
  try {
    // ------------------------------------------------------------
    // Read Telebirr callback
    // ------------------------------------------------------------

    const body = (await request.json()) as Record<string, unknown>;

    const signature = text(body.sign);
    const signType = text(body.sign_type);

    // ------------------------------------------------------------
    // Validate signature metadata
    // ------------------------------------------------------------

    if (!signature || signType !== "SHA256WithRSA") {
      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Invalid signature metadata",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Verify Telebirr signature
    // ------------------------------------------------------------

    if (!verifyResponse(body, signature)) {
      console.error(
        "Rejected Telebirr callback: signature verification failed"
      );

      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Invalid signature",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Environment / merchant information
    // ------------------------------------------------------------

    const e = env();

    const appid = text(body.appid);
    const merchCode = text(body.merch_code);
    const orderId = text(body.merch_order_id);

    const currency = text(body.trans_currency);
    const tradeStatus = text(body.trade_status);
    const amount = text(body.total_amount);

    // ------------------------------------------------------------
    // Prisma JSON value
    //
    // Prisma Json fields require a JSON-compatible value.
    // The Telebirr callback has already been parsed with
    // request.json(), so it is safe to store as JSON.
    // ------------------------------------------------------------

    const rawNotification =
      body as Prisma.InputJsonValue;

    // ------------------------------------------------------------
    // Verify merchant
    // ------------------------------------------------------------

    if (
      appid !== e.TELEBIRR_MERCHANT_APP_ID ||
      merchCode !== e.TELEBIRR_MERCHANT_CODE
    ) {
      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Merchant mismatch",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Validate merchant order ID
    // ------------------------------------------------------------

    if (!orderId) {
      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Missing merchant order ID",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Find donation
    // ------------------------------------------------------------

    const donation = await db.donation.findUnique({
      where: {
        merchantOrderId: orderId,
      },
    });

    if (!donation) {
      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Unknown merchant order ID",
        },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------
    // Verify currency
    // ------------------------------------------------------------

    if (currency && currency !== donation.currency) {
      await db.donation.update({
        where: {
          id: donation.id,
        },
        data: {
          notifyStatus: tradeStatus,
          lastError: "Callback currency mismatch",
          rawNotification,
        },
      });

      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Currency mismatch",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Verify payment amount
    // ------------------------------------------------------------

    const callbackAmount = Number(amount);

    const expectedAmount = Number(
      donation.amount.toString()
    );

    if (
      !Number.isFinite(callbackAmount) ||
      callbackAmount.toFixed(2) !==
        expectedAmount.toFixed(2)
    ) {
      await db.donation.update({
        where: {
          id: donation.id,
        },
        data: {
          notifyStatus: tradeStatus,
          lastError: "Callback amount mismatch",
          rawNotification,
        },
      });

      return NextResponse.json(
        {
          result: "FAIL",
          msg: "Amount mismatch",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // Payment identifiers
    // ------------------------------------------------------------

    const paymentOrderId =
      text(body.payment_order_id) || null;

    const transactionId =
      text(body.trans_id) || null;

    // ------------------------------------------------------------
    // Completed payment
    //
    // Telebirr callback:
    // Completed
    //
    // Our database:
    // COMPLETED
    // ------------------------------------------------------------

    const completed = tradeStatus === "Completed";

    if (completed) {
      await db.donation.update({
        where: {
          id: donation.id,
        },
        data: {
          status: "COMPLETED",

          paymentOrderId,

          transactionId,

          notifyStatus: tradeStatus,

          rawNotification,

          lastError: null,

          paidAt: donation.paidAt ?? new Date(),
        },
      });
    }

    // ------------------------------------------------------------
    // Failed / expired / still-processing payment
    // ------------------------------------------------------------

    else {
      const nextStatus =
        tradeStatus === "Failure" ||
        tradeStatus === "Expired"
          ? "FAILED"
          : "PENDING";

      await db.donation.update({
        where: {
          id: donation.id,
        },
        data: {
          // Never downgrade a completed donation.
          status:
            donation.status === "COMPLETED"
              ? "COMPLETED"
              : nextStatus,

          paymentOrderId:
            paymentOrderId ??
            donation.paymentOrderId,

          transactionId:
            transactionId ??
            donation.transactionId,

          notifyStatus: tradeStatus,

          rawNotification,
        },
      });
    }

    // ------------------------------------------------------------
    // Telebirr expects HTTP 200 after successful processing
    // ------------------------------------------------------------

    return NextResponse.json({
      result: "SUCCESS",
      code: "0",
      msg: "success",
    });
  } catch (error) {
    console.error(
      "Telebirr notify error:",
      error
    );

    return NextResponse.json(
      {
        result: "FAIL",
        msg: "Callback processing failed",
      },
      { status: 500 }
    );
  }
}