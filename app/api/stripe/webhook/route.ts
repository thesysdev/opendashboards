import { logError, logRejection } from "@/lib/log";
import { getPlans } from "@/lib/plans";

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Stripe's webhook: subscriptions starting, changing, renewing, failing and
 * ending. Public (Stripe has no session), so nothing is trusted until the
 * signature on the raw body checks out, and even then only ids are read from
 * the event: each subscription is fetched back from Stripe.
 */
export async function POST(request: Request): Promise<Response> {
  const plans = getPlans();
  if (!plans) return new Response(null, { status: 404 });
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  if (!signature || Buffer.byteLength(body) > MAX_BODY_BYTES) return new Response(null, { status: 400 });
  try {
    await plans.billing.handleWebhook(body, signature);
  } catch (error) {
    // A bad signature is someone else's request; anything else Stripe retries.
    if (error instanceof Error && error.name === "StripeSignatureVerificationError") {
      logRejection("stripe.webhook_signature", error);
      return new Response(null, { status: 400 });
    }
    logError("stripe.webhook", error);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
