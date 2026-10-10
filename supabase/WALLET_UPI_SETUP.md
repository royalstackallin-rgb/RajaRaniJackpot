# TARGETORSTAKE Wallet / UPI setup

The Wallet / Buy In screen is in the frontend, but real deposits MUST remain disabled until this server-side setup is completed. Never put Razorpay secrets in Vite environment variables or frontend code.

## 1. Apply the database migration

In the Supabase SQL Editor for the SAME project configured in the Vercel deployment, run the contents of:

`supabase/migrations/20261010000000_wallet_deposits.sql`

It creates the private deposit ledger and an idempotent server-only credit function. It uses the existing `public.change_wallet_balance(uuid,bigint,text,text)` wallet ledger routine.

## 2. Configure Razorpay

Use a verified Razorpay merchant account and enable UPI/payment links in its dashboard. Start in Test Mode first.

Create these Supabase Edge Function secrets (never commit their values):

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` — generate a webhook secret specifically for this webhook
- `APP_URL` — the deployed TARGETORSTAKE origin, e.g. `https://your-app.vercel.app/`
- `APP_ORIGIN` — the same origin without the trailing slash

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not expose the service-role key to the browser.

## 3. Deploy both Edge Functions

From a trusted computer/terminal with the Supabase CLI and access to the correct project:

```sh
supabase login
supabase link --project-ref YOUR_CORRECT_PROJECT_REF
supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=... APP_URL=... APP_ORIGIN=...
supabase functions deploy create-upi-deposit
supabase functions deploy razorpay-wallet-webhook --no-verify-jwt
```

The webhook intentionally has JWT verification disabled at the gateway because Razorpay does not send a Supabase user JWT. The function verifies Razorpay's HMAC signature itself.

## 4. Register the Razorpay webhook

In Razorpay Dashboard, register:

`https://YOUR_CORRECT_PROJECT_REF.supabase.co/functions/v1/razorpay-wallet-webhook`

Subscribe to the `payment_link.paid` event and use exactly the same webhook secret as `RAZORPAY_WEBHOOK_SECRET`.

## 5. Test before going live

- Use Razorpay Test Mode and test UPI payments.
- Confirm unpaid, cancelled, wrong-amount, and invalid-signature events never increase a wallet.
- Replay a successful webhook and confirm the deposit is credited only once.
- Confirm the wallet transaction log and balance both update.
- Only after tests pass should the merchant keys/webhook be switched to Live Mode.

## Important

A return to the browser or a screenshot is never proof of payment. Wallet credit happens only inside the signed webhook after checking the payment-link reference, provider link ID, and exact amount. Do not enable real-money use until merchant compliance, payout/refund rules, and applicable local law have been reviewed.
