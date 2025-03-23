import { z } from "zod";

export const SubscriptionFormSchema = z.object({
  isProtoEnabled: z.boolean(),
  protoRegDir: z
    .string()
    .optional()
    .transform((val) => val ?? ""),
});

export type SubscriptionFormValues = z.infer<typeof SubscriptionFormSchema>;
