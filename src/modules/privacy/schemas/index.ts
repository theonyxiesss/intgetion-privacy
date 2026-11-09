import { z } from "zod";
import { CONSENT_POLICY_VERSION, parseChoice } from "@intgetion/analytics/consent";

/** `DELETE /api/me` — the user types DELETE to confirm (D28). */
export const deleteAccountInput = z
  .object({ confirm: z.literal("DELETE") })
  .strict();

/** `POST /api/consent` — one cookie choice for the journal (D220). */
export const consentInput = z
  .object({
    id: z.uuid(),
    choice: z
      .string()
      .max(40)
      .refine((value) => parseChoice(value) !== null, "unknown choice"),
    version: z.literal(CONSENT_POLICY_VERSION),
    source: z.enum(["banner", "settings"]),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentInput>;
