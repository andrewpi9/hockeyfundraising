import Stripe from "stripe";
import { isProductionDeploy } from "./site";

let client: Stripe | null = null;

/**
 * Lazy on purpose: constructing at import time would make every page that so
 * much as imports this module demand a Stripe key just to build.
 *
 * Key policy, enforced at first use in every environment:
 *   - Must be a RESTRICTED key (rk_). The org grants us Checkout Sessions: Write
 *     and Payment Intents: Read and nothing else. An unrestricted sk_ that could
 *     move money or read customers is refused outright.
 *   - In the deployed production environment it must also be a live key.
 */
export function getStripe(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (!key.startsWith("rk_")) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a RESTRICTED key (rk_...). Refusing an unrestricted secret key.",
    );
  }
  if (isProductionDeploy() && !key.startsWith("rk_live_")) {
    throw new Error("Production must use a live restricted key (rk_live_...).");
  }

  // No apiVersion pin: the SDK's default is what its types are generated
  // against, so upgrading the package upgrades both together.
  client = new Stripe(key);
  return client;
}
