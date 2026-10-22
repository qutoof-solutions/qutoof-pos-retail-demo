export const MAX_MEDICAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type MedicalAttachmentType = {
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  extension: "pdf" | "jpg" | "png";
  safeFileName: string;
};

export async function readRequestBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return null;
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const supportedTypes: Record<string, { contentType: MedicalAttachmentType["contentType"]; extension: MedicalAttachmentType["extension"]; signature: number[] }> = {
  pdf: { contentType: "application/pdf", extension: "pdf", signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  jpg: { contentType: "image/jpeg", extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  jpeg: { contentType: "image/jpeg", extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  png: { contentType: "image/png", extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

export function sanitizeMedicalFileName(input: string): string {
  const normalized = input.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/\.{2,}/g, ".").trim().replace(/^\.+/, "").slice(0, 180);
  return normalized || "medical-attachment";
}

export function validateMedicalAttachment(input: {
  fileName: string;
  declaredType: string;
  size: number;
  bytes: Uint8Array;
}): MedicalAttachmentType | null {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_MEDICAL_ATTACHMENT_BYTES || input.bytes.byteLength !== input.size) return null;
  const safeFileName = sanitizeMedicalFileName(input.fileName);
  const extension = safeFileName.split(".").at(-1)?.toLowerCase() ?? "";
  const expected = supportedTypes[extension];
  if (!expected || expected.contentType !== input.declaredType) return null;
  if (expected.signature.some((byte, index) => input.bytes[index] !== byte)) return null;
  return { contentType: expected.contentType, extension: expected.extension, safeFileName };
}
