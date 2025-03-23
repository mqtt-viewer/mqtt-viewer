import { z } from "zod";

const VALID_DOMAIN_REGEX = new RegExp(
  "^(?!-)[A-Za-z0-9-]{1,63}(?:(?<!-)\\.(?!-)[A-Za-z0-9-]{1,63})*(?<!-)$"
);

export const ConnectionFormValidationSchema = z
  .object({
    customIconSeed: z
      .string()
      .optional()
      .transform((val) => val ?? ""),
    name: z
      .string()
      .min(1, { message: "Name cannot be empty" })
      .max(50, { message: "This name is too long" }),
    mqttVersion: z.string().min(1, { message: "MQTT Version cannot be empty" }),
    protocol: z.string().min(1, { message: "Protocol cannot be empty" }),
    websocketPath: z
      .string()
      .optional()
      .transform((val) => val ?? ""),
    host: z
      .string()
      .min(1, { message: "Host cannot be empty" })
      .regex(VALID_DOMAIN_REGEX, "Please enter a valid host"),
    port: z
      .number({
        required_error: "Port must be a number",
        invalid_type_error: "Port must be a number",
      })
      .positive({ message: "Port cannot be negative" }),
    username: z
      .string()
      .max(50, { message: "This name is too long" })
      .optional()
      .transform((val) => val ?? ""),
    password: z
      .string()
      .max(50, { message: "This name is too long" })
      .optional()
      .transform((val) => val ?? ""),
    hasCustomClientId: z.boolean().transform((val) => !!val),
    clientId: z
      .string()
      .max(50, { message: "This name is too long" })
      .optional(),
    isCertsEnabled: z.boolean().transform((val) => !!val),
    skipCertVerification: z.boolean().transform((val) => !!val),
    certCa: z
      .string()
      .optional()
      .transform((val) => val ?? ""),
    certClient: z
      .string()
      .optional()
      .transform((val) => val ?? ""),
    certClientKey: z
      .string()
      .optional()
      .transform((val) => val ?? ""),
    resetDataOnConnect: z
      .boolean()
      .optional()
      .transform((val) => !!val),
  })
  .refine(
    (schema) =>
      !schema.hasCustomClientId ||
      (!!schema.clientId && schema.clientId?.length > 0),
    {
      message: "Please provide a Client ID",
      path: ["clientId"],
    }
  );

export type ConnectionFormValues = z.infer<
  typeof ConnectionFormValidationSchema
>;
