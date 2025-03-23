import { z } from "zod";

export const PublishHeadersValidationSchema = z.object({
  contentType: z
    .string()
    .optional()
    .transform((val) => val ?? undefined),
  payloadFormatIndicator: z.boolean().default(false),
  messageExpiryInterval: z
    .number()
    .optional()
    .transform((val) => val ?? undefined),
  topicAlias: z
    .number()
    .optional()
    .transform((val) => val ?? undefined),
  responseTopic: z
    .string()
    .optional()
    .transform((val) => val ?? undefined),
  correlationData: z
    .string()
    .optional()
    .transform((val) => val ?? undefined),
  subscriptionIdentifier: z
    .number()
    .optional()
    .transform((val) => val ?? undefined),
});

export type PublishHeaderValues = z.infer<
  typeof PublishHeadersValidationSchema
>;
