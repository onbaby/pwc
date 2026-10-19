import { z } from "zod";

export const SourceSchema = z.enum(["in_cafe", "website", "social", "gift", "referral"]);
export type Source = z.infer<typeof SourceSchema>;
export const SOURCE_LIST = SourceSchema.options;

export const PolicySchema = z.enum(["fixed", "quiz", "rule", "naive", "paced", "ceiling"]);
export type PolicyName = z.infer<typeof PolicySchema>;

/** A whole day since 1970-01-01 (UTC). */
export const DaySchema = z.number().int();

export const ConfidenceSchema = z.enum(["High", "Medium", "Not yet sure"]);
export type ConfidenceLabel = z.infer<typeof ConfidenceSchema>;

export const DirectionSchema = z.enum(["later", "sooner", "none"]);
