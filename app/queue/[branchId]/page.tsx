import { QueueDisplay } from "@/components/operations/queue-display";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ branchId: string }> };

export default async function PublicQueuePage({ params }: PageProps) {
  const { branchId } = await params;
  return <QueueDisplay branchId={branchId} />;
}
