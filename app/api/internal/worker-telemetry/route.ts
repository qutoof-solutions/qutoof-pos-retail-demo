import { lt } from "drizzle-orm";
import { getDb, getRuntimeEnv } from "@/lib/db/client";
import { workerHeartbeats, workerJobRuns } from "@/lib/db/schema";

export const runtime = "edge";
const allowedJobs = new Set(["/api/internal/whatsapp/dispatch", "/api/internal/billing/dispatch", "/api/internal/billing/reconcile"]);
function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

export async function POST(request: Request): Promise<Response> {
  const env = getRuntimeEnv();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secrets = [env.WHATSAPP_CRON_SECRET, env.BILLING_CRON_SECRET].filter((value): value is string => Boolean(value && value.length >= 32));
  if (!secrets.length) return Response.json({ error: "المراقبة غير مهيأة" }, { status: 503 });
  if (!secrets.some((secret) => constantTimeEqual(secret, bearer))) return Response.json({ error: "غير مصرح" }, { status: 401 });
  try {
    const body = await request.json() as { jobName?: unknown; status?: unknown; scheduledAt?: unknown; httpStatus?: unknown };
    if (typeof body.jobName !== "string" || !allowedJobs.has(body.jobName) || !["succeeded", "failed"].includes(String(body.status))) return Response.json({ error: "بيانات التشغيل غير صالحة" }, { status: 400 });
    const scheduledAt = typeof body.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
    if (scheduledAt && !Number.isFinite(scheduledAt.getTime())) return Response.json({ error: "وقت التشغيل غير صالح" }, { status: 400 });
    const httpStatus = typeof body.httpStatus === "number" && Number.isInteger(body.httpStatus) && body.httpStatus >= 100 && body.httpStatus <= 599 ? body.httpStatus : null;
    const db = getDb();
    const now = new Date();
    const runId = crypto.randomUUID();
    const workerName = "qutoof-cron";
    await db.insert(workerJobRuns).values({ id: runId, workerName, jobName: body.jobName, status: body.status as "succeeded" | "failed", scheduledAt, httpStatus, createdAt: now }).run();
    await db.insert(workerHeartbeats).values({ workerName, lastSeenAt: now, lastStatus: body.status as "succeeded" | "failed", lastJobName: body.jobName, lastRunId: runId, updatedAt: now }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: now, lastStatus: body.status as "succeeded" | "failed", lastJobName: body.jobName, lastRunId: runId, updatedAt: now } }).run();
    await db.delete(workerJobRuns).where(lt(workerJobRuns.createdAt, new Date(now.getTime() - 90 * 86_400_000))).run();
    return Response.json({ recorded: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر تسجيل نتيجة التشغيل" }, { status: 400 });
  }
}
