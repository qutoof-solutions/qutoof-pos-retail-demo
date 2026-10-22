export type AddonReviewDecision = "approve" | "reject";
export type AddonReviewResult = { outcome: "approved" | "rejected" | "already_processed" | "expired" | "not_found"; invoiceNumber?: string };

export async function reviewAddonRequest(database: D1Database, requestId: string, ownerId: string, decision: AddonReviewDecision): Promise<AddonReviewResult> {
  const current = await database.prepare(`
    SELECT r.id, r.tenant_id, r.requested_by, r.plan_id, r.resource_type, r.addon_name_snapshot,
      r.billing_cycle_snapshot, r.quantity, r.amount_minor, r.currency, r.payment_method,
      r.subscription_end_snapshot, r.status, t.status AS tenant_status, t.subscription_ends_at
    FROM platform_addon_requests r
    JOIN tenants t ON t.id = r.tenant_id
    WHERE r.id = ? LIMIT 1
  `).bind(requestId).first<{
    id: string; tenant_id: string; requested_by: string; plan_id: string; resource_type: "warehouse" | "branch" | "user" | "doctor";
    addon_name_snapshot: string; billing_cycle_snapshot: string; quantity: number; amount_minor: number; currency: string;
    payment_method: string; subscription_end_snapshot: number; status: string; tenant_status: string; subscription_ends_at: number | null;
  }>();
  if (!current) return { outcome: "not_found" };
  if (current.status !== "pending_review") return { outcome: "already_processed" };

  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomUUID();
  const metadata = JSON.stringify({ tenantId: current.tenant_id, requestId, resourceType: current.resource_type, quantity: current.quantity, amountMinor: current.amount_minor, currency: current.currency, decision });

  if (decision === "reject") {
    const reason = "تعذر اعتماد الإيصال؛ ارفع صورة واضحة أو تواصل مع الدعم";
    const results = await database.batch([
      database.prepare("UPDATE platform_addon_requests SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = unixepoch(), approval_token = ?, telegram_lease_until = NULL, updated_at = unixepoch() WHERE id = ? AND status = 'pending_review'").bind(reason, ownerId, token, requestId),
      database.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, NULL, ?, 'billing.addon_request_rejected', 'platform_addon_request', ?, ?, ?, ?, unixepoch() WHERE EXISTS (SELECT 1 FROM platform_addon_requests WHERE id = ? AND status = 'rejected' AND approval_token = ?)").bind(crypto.randomUUID(), ownerId, requestId, null, null, metadata, requestId, token),
    ]);
    if (!results[0]?.success) throw new Error("Addon request rejection could not be saved");
    return Number(results[0].meta?.changes ?? 0) > 0 ? { outcome: "rejected" } : { outcome: "already_processed" };
  }

  const subscriptionIsCurrent = current.tenant_status === "active"
    && current.subscription_ends_at !== null
    && current.subscription_ends_at > now
    && current.subscription_ends_at === current.subscription_end_snapshot;
  if (!subscriptionIsCurrent) {
    const reason = "انتهت دورة الاشتراك أو تغيرت قبل اعتماد الإضافة؛ جدّد الاشتراك ثم أرسل طلبًا جديدًا.";
    const results = await database.batch([
      database.prepare("UPDATE platform_addon_requests SET status = 'expired', rejection_reason = ?, reviewed_by = ?, reviewed_at = unixepoch(), approval_token = ?, telegram_lease_until = NULL, updated_at = unixepoch() WHERE id = ? AND status = 'pending_review'").bind(reason, ownerId, token, requestId),
      database.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, NULL, ?, 'billing.addon_request_expired', 'platform_addon_request', ?, NULL, NULL, ?, unixepoch() WHERE EXISTS (SELECT 1 FROM platform_addon_requests WHERE id = ? AND status = 'expired' AND approval_token = ?)").bind(crypto.randomUUID(), ownerId, requestId, metadata, requestId, token),
    ]);
    if (!results[0]?.success) throw new Error("Expired addon request could not be recorded");
    return Number(results[0].meta?.changes ?? 0) > 0 ? { outcome: "expired" } : { outcome: "already_processed" };
  }

  const invoiceNumber = `QA-${new Date().getUTCFullYear()}-${requestId.slice(0, 8).toUpperCase()}`;
  const approvedMetadata = JSON.stringify({ ...JSON.parse(metadata) as Record<string, unknown>, invoiceNumber, subscriptionEnd: new Date(current.subscription_end_snapshot * 1000).toISOString() });
  const results = await database.batch([
    database.prepare("UPDATE platform_addon_requests SET status = 'approved', reviewed_by = ?, reviewed_at = unixepoch(), approval_token = ?, invoice_number = ?, rejection_reason = NULL, updated_at = unixepoch() WHERE id = ? AND status = 'pending_review' AND subscription_end_snapshot = (SELECT subscription_ends_at FROM tenants WHERE id = platform_addon_requests.tenant_id AND status = 'active' AND subscription_ends_at > unixepoch())").bind(ownerId, token, invoiceNumber, requestId),
    database.prepare(`
      INSERT INTO tenant_resource_addons (id, tenant_id, request_id, resource_type, quantity, baseline_count, baseline_user_count, starts_at, ends_at, created_at)
      SELECT ?, r.tenant_id, r.id, r.resource_type, r.quantity,
        CASE r.resource_type
          WHEN 'branch' THEN (SELECT COUNT(*) FROM branches WHERE tenant_id = r.tenant_id)
          WHEN 'warehouse' THEN (SELECT COUNT(*) FROM inventory_warehouses WHERE tenant_id = r.tenant_id)
          WHEN 'doctor' THEN (SELECT COUNT(*) FROM users WHERE tenant_id = r.tenant_id AND role IN ('provider', 'doctor', 'specialist'))
          ELSE (SELECT COUNT(*) FROM users WHERE tenant_id = r.tenant_id AND role <> 'super_admin')
        END,
        CASE WHEN r.resource_type IN ('user', 'doctor') THEN (SELECT COUNT(*) FROM users WHERE tenant_id = r.tenant_id AND role <> 'super_admin') ELSE 0 END,
        unixepoch(), r.subscription_end_snapshot, unixepoch()
      FROM platform_addon_requests r
      WHERE r.id = ? AND r.status = 'approved' AND r.approval_token = ?
    `).bind(crypto.randomUUID(), requestId, token),
    database.prepare("INSERT INTO audit_logs (id, tenant_id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata_json, created_at) SELECT ?, NULL, ?, 'billing.addon_request_approved', 'platform_addon_request', ?, NULL, NULL, ?, unixepoch() WHERE EXISTS (SELECT 1 FROM tenant_resource_addons WHERE request_id = ?)").bind(crypto.randomUUID(), ownerId, requestId, approvedMetadata, requestId),
  ]);
  if (!results[0]?.success) throw new Error("Addon request approval could not be saved");
  if (Number(results[0].meta?.changes ?? 0) === 0) return { outcome: "already_processed" };
  if (!results[1]?.success || Number(results[1].meta?.changes ?? 0) !== 1) throw new Error("Addon entitlement could not be activated");
  return { outcome: "approved", invoiceNumber };
}
