import { redirect } from "next/navigation";
import { DigitalPass } from "@/components/public/digital-pass";
import { getDb } from "@/lib/db/client";
import { appointments, tenants } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BookingPassPage({ params, searchParams }: Readonly<{ params: Promise<{ slug: string; code: string }>; searchParams: Promise<{ token?: string | string[] }> }>) {
  const [{ slug, code }, query] = await Promise.all([params, searchParams]);
  const [row] = await getDb().select({ slug: tenants.slug }).from(appointments).innerJoin(tenants, eq(tenants.id, appointments.tenantId)).where(and(eq(appointments.publicBookingCode, code), eq(tenants.slug, slug), eq(appointments.source, "public_portal"))).limit(1);
  if (!row) redirect("/404");
  const token = typeof query.token === "string" ? query.token : "";
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12"><DigitalPass slug={slug} code={code} token={token} googleReviewUrl={null} /></main>;
}
