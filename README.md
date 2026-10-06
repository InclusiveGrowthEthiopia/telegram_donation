# Inclusive Growth Telegram Donation Mini App

A standalone Telegram Mini App for Inclusive Growth donations using Telebirr C2B WebCheckout.

## Architecture

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Telegram Mini App WebApp API
- Telebirr C2B WebCheckout
- Server-side Telegram `initData` validation
- Server-side Telebirr request signing
- Telebirr payment notification verification
- QueryOrder fallback for pending/failed notifications
- Idempotent payment settlement through a unique merchant order ID

## Payment flow

1. Telegram opens the Mini App.
2. The app sends Telegram `initData` and the donation amount to `/api/checkout`.
3. The backend validates the Telegram session and amount.
4. A pending donation is stored before contacting Telebirr.
5. The backend requests a Fabric Token.
6. The backend calls `payment/v1/merchant/preOrder`.
7. The backend creates the Telebirr WebCheckout URL.
8. The donor completes payment in Telebirr.
9. Telebirr calls `/api/telebirr/notify`.
10. The backend verifies the signature, merchant, amount, currency and status before marking the donation paid.
11. `/api/payments/[orderId]` can call `queryOrder` as a recovery/status path.
12. The result page polls the backend using a private status token.

## Environment setup

Copy `.env.example` to `.env.local` and provide your real values.

Never commit `.env.local` or paste private keys, app secrets, Fabric tokens, or live payment callbacks into public repositories.

### Test environment

The default test endpoints are:

- API: `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway`
- Web Checkout: `https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?`

For production, the code defaults to:

- API: `https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway`
- Web Checkout: `https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?`

If the portal gives you different current endpoints, set the explicit override environment variables instead of changing source code.

## Database

Create a PostgreSQL database, set `DATABASE_URL`, then run:

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

For Vercel, set the same environment variables in Project Settings and use a managed PostgreSQL provider such as Supabase, Neon or another PostgreSQL service.

## Telegram Bot setup

Create/configure the bot in BotFather and set the Mini App URL to the deployed HTTPS application URL. The bot token is only used by the backend to validate Telegram WebApp `initData`.

The Mini App must be opened through Telegram for `/api/checkout` to accept the request.

## Telebirr portal configuration

The following callback URL must be reachable over HTTPS and whitelisted/configured by Telebirr:

```text
https://YOUR-DOMAIN/api/telebirr/notify
```

Set the redirect URL domain used by the Mini App in your Telebirr merchant configuration as required by the portal.

You must obtain and configure the Telebirr public key used to verify notification/query signatures. The application intentionally refuses unsigned or invalidly signed callbacks.

## Important production checks

- Use production Telebirr credentials only after sandbox testing succeeds.
- Rotate any credentials that were previously exposed in the supplied demo ZIP.
- Keep the private key server-side.
- Keep the Fabric App Secret server-side.
- Do not trust browser redirects as payment confirmation.
- Do not trust a client-supplied amount after the checkout has been created; the stored donation amount is authoritative.
- Keep merchant order IDs unique.
- Keep callback processing idempotent.
- Confirm the exact production callback and checkout URLs with the Telebirr portal before go-live.
- Configure HTTPS and the Telebirr callback whitelist before the first real payment.
