import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (digest.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signature = req.headers.get("x-razorpay-signature");
  if (!webhookSecret || !supabaseUrl || !serviceKey || !signature) {
    return json({ error: "Webhook is not configured" }, 503);
  }

  const rawBody = await req.text();
  if (!(await verifySignature(rawBody, signature, webhookSecret))) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Only a provider-signed paid event can trigger a credit.
  if (event.event !== "payment_link.paid") return json({ received: true });

  const link = event.payload?.payment_link?.entity;
  const payment = event.payload?.payment?.entity;
  const depositId = link?.reference_id;
  const paymentLinkId = link?.id;
  const amountPaid = Number(link?.amount_paid);
  const paymentId = payment?.id ?? null;

  if (!depositId || !paymentLinkId || !Number.isSafeInteger(amountPaid) || amountPaid <= 0) {
    return json({ error: "Missing payment details" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("credit_verified_wallet_deposit", {
    p_deposit_id: depositId,
    p_payment_link_id: paymentLinkId,
    p_amount_paid_paise: amountPaid,
    p_payment_id: paymentId,
  });

  if (error) {
    // Non-2xx response makes Razorpay retry; never credit from client-side callback.
    console.error("Verified deposit credit failed", error.message);
    return json({ error: "Could not finalize deposit" }, 500);
  }

  return json({ received: true, result: data });
});
