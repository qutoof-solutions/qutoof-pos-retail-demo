import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { platformSettings } from "@/lib/db/schema";
import { safeTrialDays } from "@/lib/platform/billing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [row] = await getDb()
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, "trial_days"))
      .limit(1);
    return Response.json(
      { trialDays: safeTrialDays(row?.value) },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch {
    return Response.json(
      { error: "تعذر تحميل إعداد التجربة حاليًا" },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
