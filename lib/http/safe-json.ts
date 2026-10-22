export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;
  if (raw.trim()) {
    try { payload = JSON.parse(raw) as unknown; } catch { throw new Error(fallbackMessage); }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : fallbackMessage;
    throw new Error(message);
  }
  if (payload === null || typeof payload !== "object") throw new Error(fallbackMessage);
  return payload as T;
}
