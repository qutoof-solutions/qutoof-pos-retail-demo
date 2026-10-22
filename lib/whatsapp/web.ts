export function buildWhatsAppWebUrl(phone: string | null | undefined, message: string): string | null {
  const rawDigits = (phone ?? "").replace(/\D/g, "");
  const digits = rawDigits.startsWith("00") ? rawDigits.slice(2) : rawDigits.startsWith("0") ? `20${rawDigits.slice(1)}` : rawDigits;
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
