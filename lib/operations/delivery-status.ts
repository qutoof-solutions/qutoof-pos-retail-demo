import { z } from "zod";

export const DELIVERY_STATUS_VALUES = ["preparing", "out_for_delivery", "delivered"] as const;
export type DeliveryStatus = typeof DELIVERY_STATUS_VALUES[number];

export const deliveryStatusBodySchema = z.object({ deliveryStatus: z.enum(DELIVERY_STATUS_VALUES) });

export function deliveryStatusOptions(label: (status: DeliveryStatus) => string, current: DeliveryStatus): Array<{ value: DeliveryStatus; label: string }> {
  const statuses: DeliveryStatus[] = current === "out_for_delivery" ? ["out_for_delivery", "delivered"] : ["preparing", "out_for_delivery"];
  return statuses.map((status) => ({ value: status, label: label(status) }));
}

export function deliveryStatusPayload(deliveryStatus: DeliveryStatus): { deliveryStatus: DeliveryStatus } {
  return { deliveryStatus };
}
