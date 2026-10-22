import { z } from "zod";
import { appointmentStatusSchema, isoDateTimeSchema, uuidSchema } from "@/lib/operations/validation";

export const appointmentCreateSchema = z.object({ customerId: uuidSchema, serviceId: uuidSchema, branchId: uuidSchema, providerId: uuidSchema.nullable(), startsAt: isoDateTimeSchema, status: z.enum(["pending", "confirmed", "waiting"]).default("pending"), notes: z.string().trim().max(1500).nullable().optional() });
export const appointmentPatchSchema = z.object({ customerId: uuidSchema.optional(), serviceId: uuidSchema.optional(), branchId: uuidSchema.optional(), providerId: uuidSchema.nullable().optional(), startsAt: isoDateTimeSchema.optional(), status: appointmentStatusSchema.optional(), notes: z.string().trim().max(1500).nullable().optional(), cancellationReason: z.string().trim().max(300).nullable().optional() }).refine((value) => Object.keys(value).length > 0, "أرسل الحقول المطلوب تعديلها");
