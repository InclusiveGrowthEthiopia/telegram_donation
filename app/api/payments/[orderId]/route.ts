import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { queryOrder } from "@/lib/telebirr";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await context.params;

    const token =
      new URL(request.url).searchParams.get("token") ?? "";

    // ------------------------------------------------------------
    // Validate required parameters
    // ------------------------------------------------------------

    if (!orderId || !token) {
      return NextResponse.json(
        {
          error: "Missing payment status credentials.",
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
          error: "Payment status not found.",
        },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------
    // Validate status token
    // ------------------------------------------------------------

    if (!cryptoSafeEqual(token, donation.statusToken)) {
      return NextResponse.json(
        {
          error: "Payment status not found.",
        },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------
    // Only query Telebirr while payment is still pending
    // ------------------------------------------------------------

    if (donation.status === "PENDING") {
      try {
        const result = await queryOrder(orderId);

        const biz =
          result?.biz_content &&
          typeof result.biz_content === "object"
            ? result.biz_content
            : {};

        // ----------------------------------------------------------
        // Read Telebirr response fields
        // ----------------------------------------------------------

        const tradeStatus = String(
          (biz as Record<string, unknown>).trade_status ?? ""
        );

        const paymentOrderId =
          (biz as Record<string, unknown>).payment_order_id != null
            ? String(
                (biz as Record<string, unknown>).payment_order_id
              )
            : null;

        const transactionId =
          (biz as Record<string, unknown>).trans_id != null
            ? String(
                (biz as Record<string, unknown>).trans_id
              )
            : null;

        const totalAmount =
          (biz as Record<string, unknown>).total_amount != null
            ? String(
                (biz as Record<string, unknown>).total_amount
              )
            : null;

        const currency =
          (biz as Record<string, unknown>).trans_currency != null
            ? String(
                (biz as Record<string, unknown>).trans_currency
              )
            : null;

        // ----------------------------------------------------------
        // Verify amount
        // ----------------------------------------------------------

        const expectedAmount = Number(
          donation.amount.toString()
        );

        const receivedAmount =
          totalAmount !== null
            ? Number(totalAmount)
            : null;

        const amountMatches =
          receivedAmount === null ||
          (
            Number.isFinite(receivedAmount) &&
            receivedAmount.toFixed(2) ===
              expectedAmount.toFixed(2)
          );

        // ----------------------------------------------------------
        // Verify currency
        // ----------------------------------------------------------

        const currencyMatches =
          currency === null ||
          currency === donation.currency;

        // ----------------------------------------------------------
        // Reject inconsistent payment information
        // ----------------------------------------------------------

        if (!amountMatches || !currencyMatches) {
          await db.donation.update({
            where: {
              id: donation.id,
            },
            data: {
              lastError:
                "QueryOrder amount/currency mismatch",
              rawQueryResponse: result,
              paymentOrderId:
                paymentOrderId ?? undefined,
              transactionId:
                transactionId ?? undefined,
            },
          });
        }

        // ----------------------------------------------------------
        // Successful payment
        // ----------------------------------------------------------

        else if (tradeStatus === "PAY_SUCCESS") {
          await db.donation.update({
            where: {
              id: donation.id,
            },
            data: {
              status: "COMPLETED",
              paymentOrderId,
              transactionId,
              rawQueryResponse: result,
              lastError: null,
              paidAt: donation.paidAt ?? new Date(),
            },
          });
        }

        // ----------------------------------------------------------
        // Failed / closed payment
        // ----------------------------------------------------------

        else if (
          [
            "PAY_FAILED",
            "ORDER_CLOSED",
            "REFUND_FAILED",
          ].includes(tradeStatus)
        ) {
          await db.donation.update({
            where: {
              id: donation.id,
            },
            data: {
              status: "FAILED",
              paymentOrderId,
              transactionId,
              rawQueryResponse: result,
            },
          });
        }

        // ----------------------------------------------------------
        // Payment still processing / waiting
        // ----------------------------------------------------------

        else {
          await db.donation.update({
            where: {
              id: donation.id,
            },
            data: {
              paymentOrderId:
                paymentOrderId ?? undefined,
              transactionId:
                transactionId ?? undefined,
              rawQueryResponse: result,
              notifyStatus:
                tradeStatus || undefined,
            },
          });
        }
      } catch (error) {
        // QueryOrder is a recovery mechanism.
        // If it fails, keep the donation pending and allow
        // the Telebirr notification callback to finalize it.
        console.error(
          "QueryOrder recovery error:",
          error
        );
      }
    }

    // ------------------------------------------------------------
    // Read the latest database state
    // ------------------------------------------------------------

    const current = await db.donation.findUnique({
      where: {
        id: donation.id,
      },
    });

    // ------------------------------------------------------------
    // Return current payment status
    // ------------------------------------------------------------

    return NextResponse.json(
      {
        status: current?.status ?? "PENDING",

        amount:
          current?.amount?.toString() ?? "",

        transactionId:
          current?.transactionId ?? "",
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error(
      "Payment status error:",
      error
    );

    return NextResponse.json(
      {
        error: "Unable to check payment status.",
      },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// Constant-time comparison for status tokens
// ------------------------------------------------------------

function cryptoSafeEqual(
  a: string,
  b: string
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return difference === 0;
}