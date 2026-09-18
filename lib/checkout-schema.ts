import { z } from "zod";
import { MIN_DONATION_CENTS, MAX_DONATION_CENTS } from "./money";

/** The donate form's request body. Server-validated; the client copy is a convenience. */
export const CheckoutInput = z.object({
  campaignSlug: z.string().trim().min(1).max(80),
  participantSlug: z.string().trim().max(80).optional(),
  ref: z.string().trim().regex(/^[a-z0-9]{6,12}$/, "Bad ref").optional(),
  amountCents: z.number().int().min(MIN_DONATION_CENTS, "Minimum donation is $5").max(MAX_DONATION_CENTS, "That amount is above the online limit"),
  coverFee: z.boolean().default(true),
  donorName: z.string().trim().max(120).optional(),
  donorEmail: z.email("Enter a valid email for your receipt").max(200),
  message: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
  isAnonymous: z.boolean().default(false),
  turnstileToken: z.string().max(4096).optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;
