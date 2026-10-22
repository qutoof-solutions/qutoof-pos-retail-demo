import { z } from "zod";
import { moneySchema, uuidSchema } from "@/lib/operations/validation";

export const serviceInput = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).nullable().optional(), kind: z.enum(["single", "package", "subscription"]), price: moneySchema.max(10_000_000), durationMinutes: z.number().int().min(5).max(1440), providerCommissionMode: z.enum(["percentage", "fixed"]).default("percentage"), providerCommissionPercent: z.number().min(0).max(100).default(0), providerCommissionFixed: moneySchema.max(10_000_000).default(0), sessionCount: z.number().int().min(1).max(1000), validityDays: z.number().int().min(1).max(3650).nullable(), branchId: uuidSchema.nullable() });
