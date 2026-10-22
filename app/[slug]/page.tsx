import { redirect } from "next/navigation";
import { BookingPortal } from "@/components/public/booking-portal";
import { loadPublicTenant } from "@/lib/server/public-booking";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/brand";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  const context = await loadPublicTenant(slug);
  return { title: context ? `${context.tenant.name} | حجز موعد` : `حجز موعد | ${PRODUCT_NAME}`, manifest: `/${encodeURIComponent(slug)}/manifest.webmanifest` };
}

export default async function PublicVenuePage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const context = await loadPublicTenant(slug);
  if (!context) redirect("/404");
  return <BookingPortal slug={slug} />;
}
