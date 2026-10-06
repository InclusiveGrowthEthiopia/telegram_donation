import crypto from "node:crypto";
import { env } from "./env";

const EXCLUDED = new Set([
  "sign",
  "sign_type",
  "header",
  "refund_info",
  "openType",
  "raw_request",
  "biz_content",
  "wallet_reference_data",
]);

type AnyRecord = Record<string, unknown>;

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

export function timestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

export function nonce() {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

function signingPairs(input: AnyRecord) {
  const pairs: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(input)) {
    if (!EXCLUDED.has(key)) {
      pairs.push([key, value]);
    }
  }

  if (
    input.biz_content &&
    typeof input.biz_content === "object" &&
    !Array.isArray(input.biz_content)
  ) {
    for (const [key, value] of Object.entries(
      input.biz_content as AnyRecord
    )) {
      if (!EXCLUDED.has(key)) {
        pairs.push([key, value]);
      }
    }
  }

  return pairs.sort(([a], [b]) => {
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function canonicalize(input: AnyRecord) {
  return signingPairs(input)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .join("&");
}

/**
 * Telebirr's Node.js signing implementation uses:
 * SHA256withRSAandMGF1
 *
 * This corresponds to RSA-PSS with SHA-256.
 */
export function signRequest(input: AnyRecord) {
  const privateKey = normalizePem(env().TELEBIRR_PRIVATE_KEY);

  const signer = crypto.createSign("sha256");
  signer.update(canonicalize(input), "utf8");
  signer.end();

  return signer
    .sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString("base64");
}

export function verifyResponse(
  input: AnyRecord,
  signature: string
) {
  const publicKey = normalizePem(env().TELEBIRR_PUBLIC_KEY);

  const verifier = crypto.createVerify("sha256");
  verifier.update(canonicalize(input), "utf8");
  verifier.end();

  return verifier.verify(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    },
    Buffer.from(signature, "base64")
  );
}

function apiBase() {
  const e = env();

  if (e.TELEBIRR_API_BASE_URL) {
    return e.TELEBIRR_API_BASE_URL.replace(/\/$/, "");
  }

  if (e.TELEBIRR_ENVIRONMENT === "production") {
    return "https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway";
  }

  return "https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway";
}

function webBase() {
  const e = env();

  if (e.TELEBIRR_WEB_CHECKOUT_BASE_URL) {
    return e.TELEBIRR_WEB_CHECKOUT_BASE_URL.replace(/\?$/, "");
  }

  if (e.TELEBIRR_ENVIRONMENT === "production") {
    return "https://superapp.ethiomobilemoney.et:38443/payment/web/paygate";
  }

  return "https://developerportal.ethiotelebirr.et:38443/payment/web/paygate";
}

let tokenCache: {
  token: string;
  expiresAt: number;
} | null = null;

async function applyFabricToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const e = env();

  const response = await fetch(
    `${apiBase()}/payment/v1/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-Key": e.TELEBIRR_FABRIC_APP_ID,
      },
      body: JSON.stringify({
        appSecret: e.TELEBIRR_APP_SECRET,
      }),
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.token) {
    throw new Error(
      `Telebirr token request failed: ${
        data?.msg ?? `HTTP ${response.status}`
      }`
    );
  }

  const expiresIn = Number(
    data.expires_in ??
      data.expire_in ??
      data.expiresIn ??
      300
  );

  tokenCache = {
    token: String(data.token),
    expiresAt:
      Date.now() +
      Math.max(30, expiresIn - 30) * 1000,
  };

  return tokenCache.token;
}

function generateMerchantOrderId() {
  return `IGD${Date.now()}${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export async function createCheckoutOrder(input: {
  title: string;
  amount: string;
  notifyUrl: string;
  redirectUrl: string;
  merchantOrderIdOverride?: string;
}) {
  const e = env();

  const orderId =
    input.merchantOrderIdOverride ??
    generateMerchantOrderId();

  const request: AnyRecord = {
    timestamp: timestamp(),
    nonce_str: nonce(),
    method: "payment.preorder",
    version: "1.0",

    biz_content: {
      notify_url: input.notifyUrl,
      appid: e.TELEBIRR_MERCHANT_APP_ID,
      merch_code: e.TELEBIRR_MERCHANT_CODE,
      merch_order_id: orderId,
      trade_type: "Checkout",
      title: input.title,
      total_amount: input.amount,
      trans_currency: "ETB",
      timeout_express: "120m",
      business_type: "BuyGoods",
      payee_identifier: e.TELEBIRR_MERCHANT_CODE,
      payee_identifier_type: "04",
      payee_type: "5000",
      redirect_url: input.redirectUrl,
      callback_info:
        "Inclusive Growth Telegram Donation",
    },
  };

  request.sign = signRequest(request);
  request.sign_type = "SHA256WithRSA";

  const fabricToken = await applyFabricToken();

  const response = await fetch(
    `${apiBase()}/payment/v1/merchant/preOrder`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-Key": e.TELEBIRR_FABRIC_APP_ID,
        Authorization: fabricToken,
      },
      body: JSON.stringify(request),
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.biz_content?.prepay_id) {
    throw new Error(
      `Telebirr preOrder failed: ${
        data?.msg ?? `HTTP ${response.status}`
      }`
    );
  }

  const prepayId = String(
    data.biz_content.prepay_id
  );

  /*
   * Telebirr C2B WebCheckout raw request.
   *
   * These fields are signed separately from the
   * preOrder request.
   */
  const checkoutRequest: AnyRecord = {
    appid: e.TELEBIRR_MERCHANT_APP_ID,
    merch_code: e.TELEBIRR_MERCHANT_CODE,
    nonce_str: nonce(),
    prepay_id: prepayId,
    timestamp: timestamp(),
  };

  const checkoutSign =
    signRequest(checkoutRequest);

  const checkoutParams = new URLSearchParams({
    appid: checkoutRequest.appid as string,
    merch_code: checkoutRequest.merch_code as string,
    nonce_str: checkoutRequest.nonce_str as string,
    prepay_id: checkoutRequest.prepay_id as string,
    timestamp: checkoutRequest.timestamp as string,
    sign: checkoutSign,
    sign_type: "SHA256WithRSA",
    version: "1.0",
    trade_type: "Checkout",
  });

  const checkoutUrl =
    `${webBase()}?${checkoutParams.toString()}`;

  return {
    merchantOrderId: orderId,
    prepayId,
    checkoutUrl,
    rawResponse: data,
  };
}

export async function queryOrder(
  merchantOrderId: string
) {
  const e = env();

  const request: AnyRecord = {
    timestamp: timestamp(),
    nonce_str: nonce(),
    method: "payment.queryorder",
    version: "1.0",

    biz_content: {
      appid: e.TELEBIRR_MERCHANT_APP_ID,
      merch_code: e.TELEBIRR_MERCHANT_CODE,
      merch_order_id: merchantOrderId,
    },
  };

  request.sign = signRequest(request);
  request.sign_type = "SHA256WithRSA";

  const fabricToken = await applyFabricToken();

  const response = await fetch(
    `${apiBase()}/payment/v1/merchant/queryOrder`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-Key": e.TELEBIRR_FABRIC_APP_ID,
        Authorization: fabricToken,
      },
      body: JSON.stringify(request),
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Telebirr queryOrder failed: ${
        data?.msg ?? `HTTP ${response.status}`
      }`
    );
  }

  if (
    data?.sign &&
    !verifyResponse(
      data,
      String(data.sign)
    )
  ) {
    throw new Error(
      "Telebirr queryOrder signature verification failed"
    );
  }

  return data;
}