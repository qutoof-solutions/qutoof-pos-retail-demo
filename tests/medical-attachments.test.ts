import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MEDICAL_ATTACHMENT_BYTES, readRequestBodyLimited, sanitizeMedicalFileName, validateMedicalAttachment } from "../lib/records/attachments";

const asBytes = (...bytes: number[]) => new Uint8Array(bytes);

test("accepts PDF, JPEG and PNG only when extension, MIME and file signature agree", () => {
  assert.equal(validateMedicalAttachment({ fileName: "report.pdf", declaredType: "application/pdf", size: 5, bytes: asBytes(0x25, 0x50, 0x44, 0x46, 0x2d) })?.contentType, "application/pdf");
  assert.equal(validateMedicalAttachment({ fileName: "x-ray.jpeg", declaredType: "image/jpeg", size: 3, bytes: asBytes(0xff, 0xd8, 0xff) })?.extension, "jpg");
  assert.equal(validateMedicalAttachment({ fileName: "scan.png", declaredType: "image/png", size: 8, bytes: asBytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) })?.extension, "png");
  assert.equal(validateMedicalAttachment({ fileName: "scan.png", declaredType: "image/png", size: 8, bytes: asBytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) })?.safeFileName, "scan.png");
});

test("rejects unsupported extensions, spoofed MIME and mismatched file signatures", () => {
  assert.equal(validateMedicalAttachment({ fileName: "script.svg", declaredType: "image/svg+xml", size: 3, bytes: asBytes(0x3c, 0x73, 0x76) }), null);
  assert.equal(validateMedicalAttachment({ fileName: "fake.pdf", declaredType: "application/pdf", size: 3, bytes: asBytes(0x89, 0x50, 0x4e) }), null);
  assert.equal(validateMedicalAttachment({ fileName: "fake.png", declaredType: "image/jpeg", size: 3, bytes: asBytes(0xff, 0xd8, 0xff) }), null);
});

test("rejects empty, oversized and inconsistent file buffers", () => {
  assert.equal(validateMedicalAttachment({ fileName: "empty.pdf", declaredType: "application/pdf", size: 0, bytes: new Uint8Array() }), null);
  assert.equal(validateMedicalAttachment({ fileName: "large.pdf", declaredType: "application/pdf", size: MAX_MEDICAL_ATTACHMENT_BYTES + 1, bytes: asBytes(0x25, 0x50, 0x44, 0x46, 0x2d) }), null);
  assert.equal(validateMedicalAttachment({ fileName: "wrong-size.pdf", declaredType: "application/pdf", size: 7, bytes: asBytes(0x25, 0x50, 0x44, 0x46, 0x2d) }), null);
});

test("sanitizes path separators and control characters from displayed file names", () => {
  assert.equal(sanitizeMedicalFileName("../private\\report\n.pdf"), "_private_report_.pdf");
});

test("bounds the full request stream before multipart parsing even when Content-Length is absent", async () => {
  const withinLimit = new Request("https://local.test/upload", { method: "POST", body: asBytes(1, 2, 3) });
  assert.deepEqual(await readRequestBodyLimited(withinLimit, 3), asBytes(1, 2, 3));
  const overLimit = new Request("https://local.test/upload", { method: "POST", body: asBytes(1, 2, 3, 4) });
  assert.equal(await readRequestBodyLimited(overLimit, 3), null);
});
