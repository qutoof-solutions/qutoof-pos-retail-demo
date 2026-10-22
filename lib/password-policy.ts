import { z } from "zod";

export const strongPasswordSchema = z.string()
  .min(12, "كلمة المرور يجب أن تتكون من 12 حرفاً على الأقل")
  .max(128, "كلمة المرور طويلة جداً")
  .regex(/[a-z]/, "أضف حرفاً إنجليزياً صغيراً")
  .regex(/[A-Z]/, "أضف حرفاً إنجليزياً كبيراً")
  .regex(/[0-9]/, "أضف رقماً من 0 إلى 9");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
  confirmPassword: z.string().min(1).max(128),
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "تأكيد كلمة المرور غير مطابق" });
  }
  if (value.newPassword === value.currentPassword) {
    context.addIssue({ code: "custom", path: ["newPassword"], message: "اختر كلمة مرور مختلفة عن الحالية" });
  }
});
