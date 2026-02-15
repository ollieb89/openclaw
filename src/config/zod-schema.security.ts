import { z } from "zod";

const InputSensitivitySchema = z.union([
  z.literal("lenient"),
  z.literal("moderate"),
  z.literal("strict"),
]);

const InputDetectionSchema = z
  .object({
    defaultSensitivity: InputSensitivitySchema.optional(),
    channels: z
      .record(
        z.string(),
        z
          .object({
            sensitivity: InputSensitivitySchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .optional();

export const SecurityConfigSchema = z
  .object({
    inputDetection: InputDetectionSchema,
  })
  .strict()
  .optional();
