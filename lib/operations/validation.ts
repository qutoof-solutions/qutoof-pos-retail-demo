import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const moneySchema = z.number().finite().min(0).max(100_000_000);
export const phoneSchema = z.string().trim().min(6).max(32).regex(/^[+0-9()\-\s]+$/);
export const isoDateTimeSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value));
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const paymentMethodSchema = z.enum(["cash", "card", "wallet", "instapay"]);
export const appointmentStatusSchema = z.enum(["pending", "confirmed", "waiting", "in_progress", "completed", "no_show", "cancelled"]);
