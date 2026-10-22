export type WeightedBarcodeValueMode = "weight" | "price";

export type WeightedScaleBarcode = {
  raw: string;
  prefix: string;
  itemCode: string;
  value: number;
  valueDigits: string;
  mode: WeightedBarcodeValueMode;
  quantity: number | null;
  quantityScale: number;
  priceMinor: number | null;
};

function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const checksum = code.slice(0, 12).split("").reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === Number(code[12]);
}

/**
 * Parses the common supermarket scale format: 2-digit prefix, 5-digit PLU,
 * 5-digit weight/price payload, then the EAN-13 check digit.
 */
export function parseWeightedScaleBarcode(
  input: string,
  options: { prefixes?: readonly string[]; mode?: WeightedBarcodeValueMode; weightScale?: number } = {},
): WeightedScaleBarcode | null {
  const raw = input.trim();
  const prefixes = options.prefixes ?? ["20", "21", "22"];
  const mode = options.mode ?? "weight";
  const weightScale = options.weightScale ?? 3;
  if (!isValidEan13(raw) || !prefixes.includes(raw.slice(0, 2))) return null;
  if (!Number.isInteger(weightScale) || weightScale < 0 || weightScale > 6) throw new RangeError("weightScale must be between 0 and 6");
  const valueDigits = raw.slice(7, 12);
  const value = Number(valueDigits);
  return {
    raw,
    prefix: raw.slice(0, 2),
    itemCode: raw.slice(2, 7),
    value,
    valueDigits,
    mode,
    quantity: mode === "weight" ? value / 10 ** weightScale : null,
    quantityScale: mode === "weight" ? weightScale : 0,
    priceMinor: mode === "price" ? value : null,
  };
}

export function buildEan13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new TypeError("EAN-13 body must contain 12 digits");
  const checksum = first12.split("").reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (checksum % 10)) % 10);
}
