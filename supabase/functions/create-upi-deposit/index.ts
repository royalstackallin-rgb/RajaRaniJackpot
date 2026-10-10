import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const razorpayKey = Deno.env.get("RAZORPAY_KEY_ID");
  const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const appUrl = Deno.env.get("APP_URL");

  if (!supabaseUrl || !anonKey || !serviceKey || !razorpayKey || !razorpaySecret || !appUrl) {
    return respond({ error: "UPI payment setup is incomplete. Please contact support." }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return respond({ error: "Please sign in first." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return respond({ error: "Your session has expired. Sign in again." }, 401);

  let amount: number;
  try {
    const body = await req.json();
    amount = Number(body.amount);
  } catch {
    return respond({ error: "Invalid request." }, 400);
  }
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 50000) {
    return respond({ error: "Deposit must be a whole amount between ₹10 and ₹50,000." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: deposit, error: insertError } = await admin
    .from("wallet_deposits")
    .insert({
      user_id: user.id,
      amount_rupees: amount,
      amount_paise: amount * 100,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !deposit) {
    console.error("Could not create deposit record", insertError?.message);
    return respond({ error: "Could not prepare your deposit. Please try again." }, 500);
  }

  try {
    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(razorpayKey + ":" + razorpaySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount * 100,
        currency: "INR",
        accept_partial: false,
        reference_id: deposit.id,
        description: "TARGETORSTAKE wallet deposit",
        customer: user.email ? { email: user.email } : undefined,
        notify: { sms: false, email: false },
        reminder_enable: false,
        callback_url: appUrl,
        callback_method: "get",
        notes: { deposit_id: deposit.id, user_id: user.id },
      }),
    });

    const paymentLink = await response.json();
    if (!response.ok || !paymentLink.short_url || !paymentLink.id) {
      console.error("Razorpay payment link creation failed", paymentLink?.error?.code || response.status);
      await admin.from("wallet_deposits").update({ status: "failed" }).eq("id", deposit.id);
      return respond({ error: "The payment provider could not create a payment link. No money was added." }, 502);
    }

    const { error: updateError } = await admin
      .from("wallet_deposits")
      .update({ provider_payment_link_id: paymentLink.id })
      .eq("id", deposit.id)
      .eq("status", "pending");

    if (updateError) {
      console.error("Could not store payment link id", updateError.message);
      return respond({ error: "Could not safely prepare payment. Please do not pay; contact support." }, 500);
    }

    return respond({ payment_url: paymentLink.short_url, deposit_id: deposit.id });
  } catch (error) {
    console.error("Payment provider request failed", String(error));
    await admin.from("wallet_deposits").update({ status: "failed" }).eq("id", deposit.id);
    return respond({ error: "Could not reach the payment provider. Please try again later." }, 502);
  }
});
