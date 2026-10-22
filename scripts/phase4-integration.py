from __future__ import annotations

from pathlib import Path
import sqlite3
import time
import uuid
from d1_drift_recovery import run_drift_recovery_fixture

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "drizzle" / "migrations"


def fail(message: str) -> None:
    raise AssertionError(message)


def run() -> None:
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        fail("No SQL migrations found")
    membership_fixture = None
    for path in files:
        if path.name == "0020_branch_memberships.sql":
            now = int(time.time())
            tenant_id, branch_id = str(uuid.uuid4()), str(uuid.uuid4())
            owner_id, reception_id, provider_id, unassigned_provider_id, storekeeper_id = (str(uuid.uuid4()) for _ in range(5))
            db.execute("INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (tenant_id, "Branch Membership Migration Test", f"branch-migration-{tenant_id[:8]}", "medical", "active", "UTC", "{}", now, now))
            db.execute("INSERT INTO branches (id, tenant_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", (branch_id, tenant_id, "Branch Membership Test", now, now))
            for user_id, role in ((owner_id, "business_admin"), (reception_id, "reception"), (provider_id, "provider"), (unassigned_provider_id, "provider"), (storekeeper_id, "storekeeper")):
                db.execute("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", (user_id, tenant_id, f"{role}-{user_id[:8]}@example.invalid", "test-hash", role, role, now, now))
            db.execute("INSERT INTO schedules (id, tenant_id, branch_id, provider_id, weekday, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, '08:00', '17:00', ?, ?)", (str(uuid.uuid4()), tenant_id, branch_id, provider_id, now, now))
            membership_fixture = (tenant_id, owner_id, reception_id, provider_id, unassigned_provider_id, storekeeper_id, branch_id)
        sql = path.read_text(encoding="utf-8").replace("--> statement-breakpoint", ";")
        try:
            db.executescript(sql)
        except sqlite3.Error as error:
            fail(f"Migration {path.name} failed: {error}")
        db.execute("PRAGMA foreign_keys = ON")

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    required = {"tenants", "users", "branches", "branch_memberships", "platform_plans", "platform_settings", "platform_feature_flags", "platform_billing_requests", "platform_invoices", "telegram_webhook_events", "audit_logs", "auth_login_attempts", "auth_recovery_codes", "whatsapp_settings"}
    missing = required - tables
    if missing:
        fail(f"Missing Phase 4 tables: {sorted(missing)}")
    whatsapp_settings_columns = {row["name"] for row in db.execute("PRAGMA table_info(whatsapp_settings)")}
    if not {"tenant_id", "mode", "basic_phone_number"}.issubset(whatsapp_settings_columns):
        fail("WhatsApp Basic/Advanced settings columns are missing")
    whatsapp_settings_indexes = {row["name"] for row in db.execute("PRAGMA index_list(whatsapp_settings)")}
    if "whatsapp_settings_tenant_uq" not in whatsapp_settings_indexes:
        fail("WhatsApp settings are not unique per tenant")
    flags = {row["key"]: row["enabled"] for row in db.execute("SELECT key, enabled FROM platform_feature_flags")}
    for key, expected in {"maintenance_mode": 0, "public_booking": 1, "whatsapp": 1, "tenant_registration": 1, "subscription_billing": 1}.items():
        if flags.get(key) != expected:
            fail(f"Unexpected seeded feature flag {key}: {flags.get(key)}")
    settings = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM platform_settings")}
    if settings.get("trial_days") != "30" or settings.get("grace_days") != "3":
        fail("Trial/grace defaults are missing")

    if membership_fixture:
        tenant_id, owner_id, reception_id, provider_id, unassigned_provider_id, storekeeper_id, branch_id = membership_fixture
        assigned = {row["user_id"] for row in db.execute("SELECT user_id FROM branch_memberships WHERE tenant_id = ? AND branch_id = ?", (tenant_id, branch_id))}
        if assigned != {owner_id, provider_id}:
            fail(f"Branch membership backfill included unexpected users: {assigned}")
        try:
            db.execute("INSERT INTO branch_memberships (id, tenant_id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), tenant_id, owner_id, branch_id, int(time.time()) * 1000))
        except sqlite3.IntegrityError:
            pass
        else:
            fail("Duplicate branch membership was accepted")

    # Synthetic signup fixture: the new tenant, owner, first branch, and membership
    # are created together, and a failed membership FK must leave no partial tenant.
    signup_tenant_id, signup_owner_id, signup_branch_id = (str(uuid.uuid4()) for _ in range(3))
    signup_now_ms = int(time.time() * 1000)
    try:
        with db:
            db.execute("INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (signup_tenant_id, "Synthetic Retail Signup", f"signup-{signup_tenant_id[:8]}", "retail", "pending_trial", "Africa/Cairo", "{}", signup_now_ms, signup_now_ms))
            db.execute("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", (signup_owner_id, signup_tenant_id, f"owner-{signup_owner_id[:8]}@example.invalid", "synthetic-test-hash", "Synthetic Owner", "business_admin", signup_now_ms, signup_now_ms))
            db.execute("INSERT INTO branches (id, tenant_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", (signup_branch_id, signup_tenant_id, "الفرع الرئيسي", signup_now_ms, signup_now_ms))
            db.execute("INSERT INTO branch_memberships (id, tenant_id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), signup_tenant_id, signup_owner_id, signup_branch_id, signup_now_ms))
    except sqlite3.Error as error:
        fail(f"Synthetic initial-branch signup failed: {error}")
    owner_membership = db.execute("SELECT u.role, b.name, b.is_active FROM branch_memberships m JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id JOIN branches b ON b.id = m.branch_id AND b.tenant_id = m.tenant_id WHERE m.tenant_id = ? AND m.user_id = ? AND m.branch_id = ?", (signup_tenant_id, signup_owner_id, signup_branch_id)).fetchone()
    if not owner_membership or owner_membership["role"] != "business_admin" or owner_membership["name"] != "الفرع الرئيسي" or owner_membership["is_active"] != 1:
        fail("New signup owner was not assigned to the active initial branch")

    rollback_tenant_id, rollback_owner_id = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with db:
            db.execute("INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (rollback_tenant_id, "Rollback Signup Fixture", f"rollback-{rollback_tenant_id[:8]}", "restaurant", "pending_trial", "Africa/Cairo", "{}", signup_now_ms, signup_now_ms))
            db.execute("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)", (rollback_owner_id, rollback_tenant_id, f"owner-{rollback_owner_id[:8]}@example.invalid", "synthetic-test-hash", "Synthetic Owner", "business_admin", signup_now_ms, signup_now_ms))
            db.execute("INSERT INTO branch_memberships (id, tenant_id, user_id, branch_id, created_at) VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), rollback_tenant_id, rollback_owner_id, str(uuid.uuid4()), signup_now_ms))
    except sqlite3.IntegrityError:
        pass
    else:
        fail("Signup with an invalid initial branch membership unexpectedly succeeded")
    if db.execute("SELECT 1 FROM tenants WHERE id = ?", (rollback_tenant_id,)).fetchone():
        fail("Failed initial membership left a partially created tenant")

    now = int(time.time())
    tenant_id = str(uuid.uuid4())
    owner_id = str(uuid.uuid4())
    plan_id = str(uuid.uuid4())
    db.execute("INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (tenant_id, "Integration Clinic", f"integration-{tenant_id[:8]}", "medical", "pending_trial", "Africa/Cairo", "{}", now, now))
    db.execute("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (owner_id, tenant_id, f"owner-{tenant_id[:8]}@example.invalid", "test-hash", "Integration Owner", "business_admin", 1, now, now))
    db.execute("INSERT INTO platform_plans (id, name_ar, name_en, billing_cycle, custom_days, price_minor, currency, features_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (plan_id, "الخطة الأساسية", f"integration_{tenant_id[:8]}", "monthly", None, 125000, "EGP", '{"calendar":true}', 1, now, now))

    activated = db.execute("UPDATE tenants SET status = 'active_trial', trial_started_at = ?, trial_ends_at = ? WHERE id = ? AND status = 'pending_trial' AND trial_started_at IS NULL", (now, now + 30 * 86400, tenant_id))
    if activated.rowcount != 1:
        fail("Manual trial activation did not update a pending tenant")
    replay = db.execute("UPDATE tenants SET status = 'active_trial' WHERE id = ? AND status = 'pending_trial' AND trial_started_at IS NULL", (tenant_id,))
    if replay.rowcount != 0:
        fail("Trial activation was not idempotent")

    request_id = str(uuid.uuid4())
    fields = (request_id, tenant_id, owner_id, plan_id, "الخطة الأساسية", "monthly", 30, 125000, "EGP", "pending_review", "instapay", f"platform-receipts/{tenant_id}/{request_id}.png", "image/png", 1024, "a" * 64, now, now)
    db.execute("INSERT INTO platform_billing_requests (id, tenant_id, requested_by, plan_id, plan_name_snapshot, billing_cycle_snapshot, duration_days_snapshot, amount_minor, currency, status, payment_method, receipt_object_key, receipt_content_type, receipt_size, receipt_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", fields)
    try:
        second = (str(uuid.uuid4()), *fields[1:])
        db.execute("INSERT INTO platform_billing_requests (id, tenant_id, requested_by, plan_id, plan_name_snapshot, billing_cycle_snapshot, duration_days_snapshot, amount_minor, currency, status, payment_method, receipt_object_key, receipt_content_type, receipt_size, receipt_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", second)
    except sqlite3.IntegrityError:
        pass
    else:
        fail("More than one pending billing request was accepted for a tenant")

    approval_token = str(uuid.uuid4())
    invoice_id = str(uuid.uuid4())
    invoice_number = f"QF-{time.gmtime().tm_year}-{request_id[:8].upper()}"
    changed = db.execute("UPDATE platform_billing_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?, approval_token = ? WHERE id = ? AND status = 'pending_review'", (owner_id, now, approval_token, request_id)).rowcount
    if changed != 1:
        fail("Billing request could not be approved")
    db.execute("INSERT INTO platform_invoices (id, tenant_id, request_id, plan_id, invoice_number, plan_name_snapshot, payment_method, amount_minor, currency, period_start, period_end, status, paid_at, created_at) SELECT ?, tenant_id, id, plan_id, ?, plan_name_snapshot, payment_method, amount_minor, currency, ?, ?, 'paid', ?, ? FROM platform_billing_requests WHERE id = ? AND status = 'approved' AND approval_token = ?", (invoice_id, invoice_number, now, now + 30 * 86400, now, now, request_id, approval_token))
    db.execute("UPDATE tenants SET platform_plan_id = ?, subscription_ends_at = ?, status = 'active' WHERE id = ? AND EXISTS (SELECT 1 FROM platform_billing_requests WHERE id = ? AND status = 'approved' AND approval_token = ?)", (plan_id, now + 30 * 86400, tenant_id, request_id, approval_token))
    duplicate_change = db.execute("UPDATE platform_billing_requests SET status = 'approved' WHERE id = ? AND status = 'pending_review'", (request_id,)).rowcount
    if duplicate_change != 0:
        fail("An already approved payment request was not protected from replay")
    invoice = db.execute("SELECT status, amount_minor FROM platform_invoices WHERE request_id = ?", (request_id,)).fetchone()
    tenant = db.execute("SELECT platform_plan_id, status FROM tenants WHERE id = ?", (tenant_id,)).fetchone()
    if not invoice or invoice["status"] != "paid" or invoice["amount_minor"] != 125000:
        fail("Approved payment did not produce the expected paid invoice")
    if tenant["platform_plan_id"] != plan_id or tenant["status"] != "active":
        fail("Approved payment did not activate the tenant subscription")

    owner_security = db.execute("SELECT totp_enabled, totp_secret_encrypted, totp_pending_secret_encrypted FROM users WHERE id = ?", (owner_id,)).fetchone()
    if owner_security["totp_enabled"] != 0 or owner_security["totp_secret_encrypted"] is not None or owner_security["totp_pending_secret_encrypted"] is not None:
        fail("New users must start with optional 2FA disabled and no TOTP secret")

    # Login-failure counters are opaque keyed hashes, fixed-window, and reset after 15 minutes.
    attempt_key = "hmac-only-test-key"
    attempt_sql = """INSERT INTO auth_login_attempts (attempt_key, window_started_at, attempts, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
          window_started_at = CASE WHEN auth_login_attempts.window_started_at <= ? THEN ? ELSE auth_login_attempts.window_started_at END,
          attempts = CASE WHEN auth_login_attempts.window_started_at <= ? THEN 1 ELSE auth_login_attempts.attempts + 1 END,
          updated_at = excluded.updated_at"""
    for _ in range(8):
        db.execute(attempt_sql, (attempt_key, now, now, now - 900, now, now - 900))
    limited = db.execute("SELECT attempts FROM auth_login_attempts WHERE attempt_key = ? AND window_started_at > ? AND attempts >= 8", (attempt_key, now - 900)).fetchone()
    if not limited or limited["attempts"] != 8 or "@" in attempt_key:
        fail("Authentication failed-attempt limit was not persisted without raw identifiers")
    db.execute(attempt_sql, (attempt_key, now + 900, now + 900, now, now + 900, now))
    reset_attempts = db.execute("SELECT attempts FROM auth_login_attempts WHERE attempt_key = ?", (attempt_key,)).fetchone()["attempts"]
    if reset_attempts != 1:
        fail("Authentication attempt counter did not reset after its time window")

    # Tenant-scoped API access and WhatsApp appointment actions must never cross workspace boundaries.
    other_tenant_id = str(uuid.uuid4())
    other_branch_id = str(uuid.uuid4())
    other_customer_id = str(uuid.uuid4())
    other_service_id = str(uuid.uuid4())
    other_appointment_id = str(uuid.uuid4())
    cancel_appointment_id = str(uuid.uuid4())
    confirm_appointment_id = str(uuid.uuid4())
    db.execute("INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (other_tenant_id, "Other Tenant", f"other-{other_tenant_id[:8]}", "beauty", "active", "UTC", "{}", now, now))
    db.execute("INSERT INTO branches (id, tenant_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", (other_branch_id, other_tenant_id, "Other branch", now, now))
    db.execute("INSERT INTO customers (id, tenant_id, branch_id, full_name, phone, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (other_customer_id, other_tenant_id, other_branch_id, "Other Customer", "+201000000002", "unspecified", now, now))
    db.execute("INSERT INTO services (id, tenant_id, branch_id, name, kind, price_minor, duration_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (other_service_id, other_tenant_id, other_branch_id, "Other Session", "single", 10000, 30, now, now))
    db.execute("INSERT INTO appointments (id, tenant_id, branch_id, customer_id, service_id, starts_at, ends_at, status, source, public_booking_code, whatsapp_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'public_portal', ?, 1, ?, ?)", (other_appointment_id, other_tenant_id, other_branch_id, other_customer_id, other_service_id, now - 3600, now - 1800, f"CODE{other_appointment_id[:8].upper()}", now, now))
    for action_appointment_id in (cancel_appointment_id, confirm_appointment_id):
        db.execute("INSERT INTO appointments (id, tenant_id, branch_id, customer_id, service_id, starts_at, ends_at, status, source, public_booking_code, whatsapp_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'public_portal', ?, 1, ?, ?)", (action_appointment_id, other_tenant_id, other_branch_id, other_customer_id, other_service_id, now + 3600, now + 5400, f"CODE{action_appointment_id[:8].upper()}", now, now))
    cross_tenant_read = db.execute("SELECT id FROM appointments WHERE id = ? AND tenant_id = ?", (other_appointment_id, tenant_id)).fetchone()
    if cross_tenant_read is not None:
        fail("Tenant-scoped appointment API query exposed another tenant's appointment")
    cross_tenant_cancel = db.execute("UPDATE appointments SET status = 'cancelled' WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'confirmed')", (cancel_appointment_id, tenant_id)).rowcount
    if cross_tenant_cancel != 0:
        fail("Tenant-scoped WhatsApp cancellation modified another tenant's appointment")
    marked_no_show = db.execute("UPDATE appointments SET status = 'no_show' WHERE id = ? AND tenant_id = ? AND ends_at <= ? AND status IN ('pending', 'confirmed')", (other_appointment_id, other_tenant_id, now)).rowcount
    if marked_no_show != 1:
        fail("Overdue appointment was not transitioned to no_show")
    db.execute("UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Customer cancelled by WhatsApp' WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'confirmed')", (other_appointment_id, other_tenant_id))
    cancelled = db.execute("SELECT status, cancellation_reason FROM appointments WHERE id = ? AND tenant_id = ?", (other_appointment_id, other_tenant_id)).fetchone()
    if cancelled["status"] != "no_show":
        fail("A terminal no_show appointment was incorrectly changed by a late cancellation reply")
    cancellation_rows = db.execute("UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Customer cancelled by WhatsApp' WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'confirmed')", (cancel_appointment_id, other_tenant_id)).rowcount
    cancellation_state = db.execute("SELECT status, cancellation_reason FROM appointments WHERE id = ? AND tenant_id = ?", (cancel_appointment_id, other_tenant_id)).fetchone()
    if cancellation_rows != 1 or cancellation_state["status"] != "cancelled" or not cancellation_state["cancellation_reason"]:
        fail("WhatsApp cancellation did not persist cancelled status/reason")
    confirmation_rows = db.execute("UPDATE appointments SET status = 'confirmed' WHERE id = ? AND tenant_id = ? AND status = 'pending'", (confirm_appointment_id, other_tenant_id)).rowcount
    confirmation_state = db.execute("SELECT status FROM appointments WHERE id = ? AND tenant_id = ?", (confirm_appointment_id, other_tenant_id)).fetchone()
    if confirmation_rows != 1 or confirmation_state["status"] != "confirmed":
        fail("WhatsApp confirmation did not persist confirmed status")

    # Manual collection is tenant-scoped, records each payment once, and cannot overpay an invoice.
    payment_invoice_id = str(uuid.uuid4())
    payment_invoice_number = f"QT-{tenant_id[:8]}"
    db.execute("INSERT INTO invoices (id, tenant_id, branch_id, customer_id, appointment_id, issued_by, invoice_number, subtotal_minor, discount_minor, total_minor, paid_minor, currency, payment_method, status, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, 10000, 0, 10000, 0, 'EGP', 'unpaid', 'issued', NULL, ?, ?)", (payment_invoice_id, other_tenant_id, other_branch_id, other_customer_id, payment_invoice_number, now, now))

    def record_test_payment(amount: int, tenant: str, method: str = "instapay") -> int:
        changed = db.execute("UPDATE invoices SET paid_minor = paid_minor + ?, payment_method = CASE WHEN paid_minor = 0 THEN ? WHEN payment_method = ? THEN payment_method ELSE 'mixed' END, status = CASE WHEN paid_minor + ? >= total_minor THEN 'paid' ELSE 'partially_paid' END, paid_at = CASE WHEN paid_minor + ? >= total_minor THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('issued', 'partially_paid') AND paid_minor + ? <= total_minor", (amount, method, method, amount, amount, now, now, payment_invoice_id, tenant, amount)).rowcount
        db.execute("INSERT INTO invoice_payments (id, tenant_id, invoice_id, received_by, amount_minor, payment_method, reference, created_at) SELECT ?, ?, ?, NULL, ?, ?, NULL, ? WHERE changes() = 1", (str(uuid.uuid4()), tenant, payment_invoice_id, amount, method, now))
        return changed

    if record_test_payment(4000, other_tenant_id) != 1:
        fail("Manual payment did not update a tenant-owned invoice")
    partial = db.execute("SELECT paid_minor, status FROM invoices WHERE id = ? AND tenant_id = ?", (payment_invoice_id, other_tenant_id)).fetchone()
    if partial["paid_minor"] != 4000 or partial["status"] != "partially_paid":
        fail("Partial manual payment was not reflected on the invoice")
    if record_test_payment(7000, other_tenant_id) != 0:
        fail("Invoice accepted a payment above its remaining balance")
    if db.execute("SELECT COUNT(*) FROM invoice_payments WHERE invoice_id = ?", (payment_invoice_id,)).fetchone()[0] != 1:
        fail("Rejected overpayment produced a payment record")
    if record_test_payment(6000, other_tenant_id) != 1:
        fail("The remaining invoice balance could not be settled")
    settled = db.execute("SELECT paid_minor, status FROM invoices WHERE id = ? AND tenant_id = ?", (payment_invoice_id, other_tenant_id)).fetchone()
    if settled["paid_minor"] != 10000 or settled["status"] != "paid":
        fail("Fully collected invoice was not marked paid")
    if record_test_payment(1, tenant_id) != 0:
        fail("Cross-tenant payment changed an unrelated invoice")

    # Webhook event IDs are idempotent within a tenant but cannot collide across workspaces.
    webhook_event_id = f"event-{uuid.uuid4()}"
    db.execute("INSERT INTO whatsapp_webhook_events (id, tenant_id, provider_event_id, event_type, processed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), other_tenant_id, webhook_event_id, "messages", now, now))
    try:
        db.execute("INSERT INTO whatsapp_webhook_events (id, tenant_id, provider_event_id, event_type, processed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), other_tenant_id, webhook_event_id, "messages", now, now))
    except sqlite3.IntegrityError:
        pass
    else:
        fail("A duplicate provider webhook event was processed twice for one tenant")

    super_admin_id = str(uuid.uuid4())
    db.execute("INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, totp_enabled, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, 'super_admin', 1, 1, ?, ?)", (super_admin_id, f"super-admin-{tenant_id[:8]}@example.invalid", "test-hash", "Integration Super Admin", now, now))
    recovery_code_id = str(uuid.uuid4())
    recovery_code_hash = "b" * 64
    db.execute("INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)", (recovery_code_id, super_admin_id, recovery_code_hash, now))
    consume_id = str(uuid.uuid4())
    consumed = db.execute("UPDATE auth_recovery_codes SET used_at = ?, consumption_id = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", (now, consume_id, super_admin_id, recovery_code_hash)).rowcount
    replayed = db.execute("UPDATE auth_recovery_codes SET used_at = ?, consumption_id = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", (now, str(uuid.uuid4()), super_admin_id, recovery_code_hash)).rowcount
    if consumed != 1 or replayed != 0:
        fail("Recovery code was not strictly one-time-use")
    integrity = db.execute("PRAGMA foreign_key_check").fetchall()
    if integrity:
        fail(f"Foreign key check failed: {integrity}")
    run_drift_recovery_fixture()
    print(f"SQLite integration passed: {len(files)} migrations, billing/trial, login-failure windows, one-time recovery codes, tenant-isolated appointments and invoice payments, overpayment rejection, idempotent WhatsApp webhook events, cancellation/no-show transitions, worker telemetry schema, and foreign keys.")


if __name__ == "__main__":
    run()
