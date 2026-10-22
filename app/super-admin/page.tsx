import { desc } from "drizzle-orm";
import { SuperAdminConsole } from "@/components/platform/super-admin-console";
import { SuperAdminHeader, SuperAdminMonitor } from "@/components/platform/super-admin-chrome";
import { getSuperAdminPageContext } from "@/lib/server/super-admin";
import { workerHeartbeats, workerJobRuns } from "@/lib/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const context = await getSuperAdminPageContext();
  const [heartbeats, recentRuns] = await Promise.all([
    context.db.select().from(workerHeartbeats),
    context.db.select().from(workerJobRuns).orderBy(desc(workerJobRuns.createdAt)).limit(8),
  ]);
  const heartbeat = heartbeats[0] ?? null;
  const seenRecently = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() < 24 * 60 * 60 * 1000 : false;

  return <main className="min-h-screen bg-canvas">
    <SuperAdminHeader fullName={context.user.fullName} />
    <section className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-8">
      <SuperAdminMonitor heartbeat={heartbeat} recentRuns={recentRuns} seenRecently={seenRecently} />
      <SuperAdminConsole />
    </section>
  </main>;
}
