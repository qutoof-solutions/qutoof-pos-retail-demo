export type AppointmentReplyAction = "confirm" | "reschedule" | "cancel";

export function parseAppointmentReply(body: string): { action: AppointmentReplyAction; code: string } | null {
  const match = /^(confirm|reschedule|cancel)\s*(?::|\s)\s*([A-Z0-9_-]{8,64})$/i.exec(body.trim());
  if (!match) return null;
  return { action: match[1]!.toLowerCase() as AppointmentReplyAction, code: match[2]!.toUpperCase() };
}
