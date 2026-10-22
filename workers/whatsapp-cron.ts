interface CronInvocation { cron: string; scheduledTime: number; }
interface CronEnvironment { APP_BASE_URL?: string; WHATSAPP_CRON_SECRET?: string; BILLING_CRON_SECRET?: string; }

export default {
  async scheduled(controller: CronInvocation, env: CronEnvironment): Promise<void> {
    const target = env.APP_BASE_URL?.replace(/\/$/, "");
    if (!target || !/^https:\/\//i.test(target)) throw new Error("Set APP_BASE_URL to the deployed HTTPS Qutoof application URL");
    if (!env.WHATSAPP_CRON_SECRET || env.WHATSAPP_CRON_SECRET.length < 32) throw new Error("Set WHATSAPP_CRON_SECRET for the cron worker");
    if (!env.BILLING_CRON_SECRET || env.BILLING_CRON_SECRET.length < 32) throw new Error("Set BILLING_CRON_SECRET for the cron worker");
    const jobs = [
      { path: "/api/internal/whatsapp/dispatch", secret: env.WHATSAPP_CRON_SECRET },
      { path: "/api/internal/billing/dispatch", secret: env.BILLING_CRON_SECRET },
    ];
    if (controller.cron === "0 1 * * *") jobs.push({ path: "/api/internal/billing/reconcile", secret: env.BILLING_CRON_SECRET });
    const outcomes = await Promise.all(jobs.map(async ({ path, secret }) => {
      let status: "succeeded" | "failed" = "failed";
      let httpStatus: number | null = null;
      try {
        const response = await fetch(`${target}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "X-Qutoof-Cron": controller.cron },
          body: JSON.stringify({ scheduledAt: new Date(controller.scheduledTime).toISOString() }),
          signal: AbortSignal.timeout(30_000),
        });
        httpStatus = response.status;
        if (!response.ok) throw new Error(`Cron endpoint ${path} returned ${response.status}`);
        await response.json().catch(() => null);
        status = "succeeded";
      } catch {
        await fetch(`${target}/api/internal/worker-telemetry`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ jobName: path, status, scheduledAt: new Date(controller.scheduledTime).toISOString(), httpStatus }), signal: AbortSignal.timeout(8_000) }).catch(() => null);
        return "failed" as const;
      }
      await fetch(`${target}/api/internal/worker-telemetry`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ jobName: path, status, scheduledAt: new Date(controller.scheduledTime).toISOString(), httpStatus }), signal: AbortSignal.timeout(8_000) }).catch(() => null);
      return status;
    }));
    if (outcomes.length !== jobs.length || outcomes.includes("failed")) throw new Error("One or more scheduled tasks did not complete");
  },
};
