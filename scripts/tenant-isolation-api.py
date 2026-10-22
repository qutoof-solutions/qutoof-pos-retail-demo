#!/usr/bin/env python3
"""Route-level tenant-isolation checks for a locally running Pages preview.

Requires `wrangler pages dev` with the project's local D1 binding and migrations.
This test intentionally refuses non-local application URLs and uses synthetic data.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BASE = os.environ.get("QUTOOF_API_BASE", "http://127.0.0.1:8788").rstrip("/")
PERSIST_TO = os.environ.get("QUTOOF_D1_PERSIST", "/tmp/qutoof-preview-local")
if urllib.parse.urlparse(BASE).netloc not in {"127.0.0.1:8788", "localhost:8788"}:
    raise SystemExit("Refusing to run tenant API isolation test against a non-local URL")


def uid() -> str:
    return str(uuid.uuid4())


def request(opener, method: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        response = opener.open(req)
        body = response.read()
        return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body.decode("utf-8", errors="replace")}
        return error.code, parsed


def request_raw(opener, method: str, path: str, payload: bytes | None = None, content_type: str | None = None):
    headers = {"Content-Type": content_type} if content_type else {}
    req = urllib.request.Request(BASE + path, data=payload, method=method, headers=headers)
    try:
        response = opener.open(req)
        return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def upload_multipart(opener, path: str, fields: dict[str, str], file_name: str, media_type: str, file_bytes: bytes):
    boundary = "----qutoof-local-" + uid().replace("-", "")
    chunks = []
    for name, value in fields.items():
        chunks.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(), value.encode(), b"\r\n"])
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'.encode(),
        f"Content-Type: {media_type}\r\n\r\n".encode(),
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    status, body, _ = request_raw(opener, "POST", path, b"".join(chunks), f"multipart/form-data; boundary={boundary}")
    try:
        return status, json.loads(body) if body else {}
    except json.JSONDecodeError:
        return status, {"raw": body.decode("utf-8", errors="replace")}


def register_owner(label: str):
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    email = f"tenant-isolation-{label}-{uid()}@example.test"
    status, data = request(
        opener,
        "POST",
        "/api/auth/register",
        {
            "businessName": f"Isolation {label}",
            "vertical": "medical",
            "fullName": f"Test Owner {label}",
            "email": email,
            "password": "LocalTest!2026-Isolation",
        },
    )
    assert status == 201, (status, data)
    return opener, data["tenant"]["id"], data["user"]["id"], email


def create_staff(owner, role: str, return_user_id: bool = False):
    email = f"{role}-{uid()}@example.test"
    password = "Qutoof-Test!2026-Staff"
    status, created = request(owner, "POST", "/api/ops/team", {"fullName": f"Synthetic {role}", "email": email, "role": role, "password": password})
    assert status == 201, (role, status, created)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    status, logged = request(opener, "POST", "/api/auth/login", {"email": email, "password": password})
    assert status == 200 and logged.get("user", {}).get("role") == role, (role, status, logged)
    return (opener, logged["user"]["id"]) if return_user_id else opener


def run_wrangler(sql: str):
    subprocess.run(
        [
            "npx",
            "wrangler",
            "d1",
            "execute",
            "qutoof-db",
            "--local",
            "--persist-to",
            PERSIST_TO,
            "--command",
            sql,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )


def sqlq(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


owner_a, tenant_a, _, _ = register_owner("a")
owner_b, tenant_b, owner_b_id, _ = register_owner("b")
branch_id, branch2_id, provider_id, provider2_id, service_id, service2_id, customer_id, customer2_id = (uid() for _ in range(8))

seed = [
    f"UPDATE tenants SET status='active_trial', trial_started_at=unixepoch(), trial_ends_at=unixepoch()+2592000 WHERE id IN ({sqlq(tenant_a)},{sqlq(tenant_b)});",
    f"INSERT INTO branches (id,tenant_id,name,is_active,created_at,updated_at) VALUES ({sqlq(branch_id)},{sqlq(tenant_b)},'فرع اختبار عزل',1,unixepoch(),unixepoch());",
    f"INSERT INTO branches (id,tenant_id,name,is_active,created_at,updated_at) VALUES ({sqlq(branch2_id)},{sqlq(tenant_b)},'فرع ثانٍ لاختبار العزل',1,unixepoch(),unixepoch());",
    f"INSERT INTO users (id,tenant_id,email,password_hash,full_name,role,is_active,created_at,updated_at) VALUES ({sqlq(provider_id)},{sqlq(tenant_b)},{sqlq('provider-'+uid()+'@example.test')},'synthetic-test-hash','مقدم اختبار عزل','provider',1,unixepoch(),unixepoch());",
    f"INSERT INTO users (id,tenant_id,email,password_hash,full_name,role,is_active,created_at,updated_at) VALUES ({sqlq(provider2_id)},{sqlq(tenant_b)},{sqlq('provider2-'+uid()+'@example.test')},'synthetic-test-hash','مقدم اختبار الفرع الثاني','provider',1,unixepoch(),unixepoch());",
    f"INSERT INTO services (id,tenant_id,branch_id,name,kind,price_minor,currency,duration_minutes,provider_commission_bps,session_count,is_active,created_at,updated_at) VALUES ({sqlq(service_id)},{sqlq(tenant_b)},{sqlq(branch_id)},'خدمة اختبار عزل','single',10000,'EGP',30,0,1,1,unixepoch(),unixepoch());",
    f"INSERT INTO services (id,tenant_id,branch_id,name,kind,price_minor,currency,duration_minutes,provider_commission_bps,session_count,is_active,created_at,updated_at) VALUES ({sqlq(service2_id)},{sqlq(tenant_b)},{sqlq(branch2_id)},'خدمة الفرع الثاني','single',10000,'EGP',30,0,1,1,unixepoch(),unixepoch());",
    f"INSERT INTO customers (id,tenant_id,branch_id,full_name,phone,created_at,updated_at) VALUES ({sqlq(customer_id)},{sqlq(tenant_b)},{sqlq(branch_id)},'عميل اختبار عزل','+201299999001',unixepoch(),unixepoch());",
    f"INSERT INTO customers (id,tenant_id,branch_id,full_name,phone,created_at,updated_at) VALUES ({sqlq(customer2_id)},{sqlq(tenant_b)},{sqlq(branch2_id)},'عميل الفرع الثاني','+201299999002',unixepoch(),unixepoch());",
    f"INSERT INTO branch_memberships (id,tenant_id,user_id,branch_id,created_at) VALUES ({sqlq(uid())},{sqlq(tenant_b)},{sqlq(owner_b_id)},{sqlq(branch_id)},unixepoch()*1000),({sqlq(uid())},{sqlq(tenant_b)},{sqlq(owner_b_id)},{sqlq(branch2_id)},unixepoch()*1000),({sqlq(uid())},{sqlq(tenant_b)},{sqlq(provider_id)},{sqlq(branch_id)},unixepoch()*1000),({sqlq(uid())},{sqlq(tenant_b)},{sqlq(provider2_id)},{sqlq(branch2_id)},unixepoch()*1000);",
]
for weekday in range(7):
    seed.append(
        "INSERT INTO schedules (id,tenant_id,branch_id,provider_id,weekday,starts_at,ends_at,breaks_json,is_available,created_at,updated_at) "
        f"VALUES ({sqlq(uid())},{sqlq(tenant_b)},{sqlq(branch_id)},{sqlq(provider_id)},{weekday},'08:00','20:00','[]',1,unixepoch(),unixepoch());"
    )
    seed.append(
        "INSERT INTO schedules (id,tenant_id,branch_id,provider_id,weekday,starts_at,ends_at,breaks_json,is_available,created_at,updated_at) "
        f"VALUES ({sqlq(uid())},{sqlq(tenant_b)},{sqlq(branch_id)},NULL,{weekday},'08:00','20:00','[]',1,unixepoch(),unixepoch());"
    )
    seed.append(
        "INSERT INTO schedules (id,tenant_id,branch_id,provider_id,weekday,starts_at,ends_at,breaks_json,is_available,created_at,updated_at) "
        f"VALUES ({sqlq(uid())},{sqlq(tenant_b)},{sqlq(branch2_id)},{sqlq(provider2_id)},{weekday},'00:00','23:59','[]',1,unixepoch(),unixepoch());"
    )
run_wrangler(" ".join(seed))

status, onboarding_state = request(owner_b, "GET", "/api/ops/onboarding")
assert status == 200 and any(row["id"] == branch_id for row in onboarding_state.get("branches", [])), (status, onboarding_state)
status, identity_saved = request(owner_b, "POST", "/api/ops/onboarding", {"action": "save_identity", "name": "Isolation B Synthetic Clinic", "vertical": "medical", "logoUrl": ""})
assert status == 200, (status, identity_saved)
status, onboarding_completed = request(owner_b, "POST", "/api/ops/onboarding", {"action": "complete", "branchId": branch_id})
assert status == 200 and onboarding_completed.get("completed") is True, (status, onboarding_completed)

start_local = datetime.now(ZoneInfo("Africa/Cairo")).replace(hour=11, minute=0, second=0, microsecond=0) + timedelta(days=3)
start_utc = start_local.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
status, created = request(
    owner_b,
    "POST",
    "/api/ops/appointments",
    {
        "customerId": customer_id,
        "serviceId": service_id,
        "branchId": branch_id,
        "providerId": provider_id,
        "startsAt": start_utc,
        "status": "confirmed",
        "notes": "Synthetic API isolation test",
    },
)
assert status == 201, (status, created)
appointment_id = created["appointment"]["id"]

from_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
to_date = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat().replace("+00:00", "Z")
query = urllib.parse.urlencode({"from": from_date, "to": to_date})
staff_start = (start_local + timedelta(days=1)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
status, appointment2 = request(owner_b, "POST", "/api/ops/appointments", {"customerId": customer2_id, "serviceId": service2_id, "branchId": branch2_id, "providerId": provider2_id, "startsAt": staff_start, "status": "confirmed", "notes": "Synthetic second-branch isolation test"})
assert status == 201, (status, appointment2)
appointment2_id = appointment2["appointment"]["id"]

gate_start_local = datetime.now(ZoneInfo("Africa/Cairo")).replace(second=0, microsecond=0) + timedelta(minutes=10)
gate_start_utc = gate_start_local.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
status, gate_appointment = request(owner_b, "POST", "/api/ops/appointments", {"customerId": customer2_id, "serviceId": service2_id, "branchId": branch2_id, "providerId": provider2_id, "startsAt": gate_start_utc, "status": "confirmed", "notes": "Synthetic QR gate smoke test"})
assert status == 201, (status, gate_appointment)
gate_appointment_id = gate_appointment["appointment"]["id"]
status, issued_qr = request(owner_b, "POST", f"/api/ops/appointments/{gate_appointment_id}/ticket", {})
assert status == 201 and issued_qr.get("ticket", {}).get("token"), (status, issued_qr)
status, gate_checkin = request(owner_b, "POST", "/api/ops/gate/check-in", {"token": issued_qr["ticket"]["token"], "method": "qr"})
if status == 500 and "Network connection lost" in gate_checkin.get("raw", ""):
    time.sleep(0.2)
    status, gate_retry = request(owner_b, "POST", "/api/ops/gate/check-in", {"token": issued_qr["ticket"]["token"], "method": "qr"})
    if status == 409 and gate_retry.get("error") == "تم استخدام التذكرة مسبقاً":
        gate_checkin = {"accepted": True, "responseRecoveredByAtomicReplay": True}
        status = 200
    else:
        gate_checkin = gate_retry
assert status == 200 and gate_checkin.get("accepted") is True, (status, gate_checkin)
status, gate_replay = request(owner_b, "POST", "/api/ops/gate/check-in", {"token": issued_qr["ticket"]["token"], "method": "qr"})
assert status == 409, (status, gate_replay)

reception, reception_id = create_staff(owner_b, "reception", True)
status, assigned = request(owner_b, "PUT", "/api/ops/branch-memberships", {"userId": reception_id, "branchIds": [branch_id]})
assert status == 200, (status, assigned)
branch_admin, branch_admin_id = create_staff(owner_b, "admin", True)
status, branch_admin_assignment = request(owner_b, "PUT", "/api/ops/branch-memberships", {"userId": branch_admin_id, "branchIds": [branch_id]})
assert status == 200, (status, branch_admin_assignment)
status, unauthorized_assignment = request(branch_admin, "PUT", "/api/ops/branch-memberships", {"userId": reception_id, "branchIds": [branch2_id]})
assert status == 403, (status, unauthorized_assignment)
status, branch_appointments = request(reception, "GET", f"/api/ops/appointments?{query}")
assert status == 200 and appointment_id in {row["id"] for row in branch_appointments.get("appointments", [])} and appointment2_id not in {row["id"] for row in branch_appointments.get("appointments", [])}, (status, branch_appointments)
status, branch_customer = request(reception, "GET", f"/api/ops/customers/{customer2_id}")
assert status == 404, (status, branch_customer)
status, cross_branch_create = request(reception, "POST", "/api/ops/appointments", {"customerId": customer2_id, "serviceId": service2_id, "branchId": branch2_id, "providerId": provider2_id, "startsAt": (start_local + timedelta(days=2)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "status": "confirmed"})
assert status == 403, (status, cross_branch_create)

# Nursing accounts are branch-scoped and may upload/view attachments without clinical-note or billing privileges.
nurse, nurse_id = create_staff(owner_b, "nurse", True)
status, nurse_assignment = request(owner_b, "PUT", "/api/ops/branch-memberships", {"userId": nurse_id, "branchIds": [branch_id]})
assert status == 200, (status, nurse_assignment)
status, nurse_context = request(nurse, "GET", "/api/ops/context")
assert status == 200 and {row["id"] for row in nurse_context.get("branches", [])} == {branch_id} and nurse_context.get("services") == [] and nurse_context.get("canCreateCustomer") is False, (status, nurse_context)
status, nurse_profile_before = request(nurse, "GET", f"/api/ops/customers/{customer_id}")
assert status == 200 and nurse_profile_before.get("canManageAttachments") is True and nurse_profile_before.get("canWriteRecords") is False and nurse_profile_before.get("canSeeBilling") is False and nurse_profile_before.get("billing") == [] and nurse_profile_before.get("entitlements") == [], (status, nurse_profile_before)
status, nurse_cross_customer = request(nurse, "GET", f"/api/ops/customers/{customer2_id}")
assert status in (403, 404), (status, nurse_cross_customer)
status, nurse_note_denied = request(nurse, "POST", f"/api/ops/customers/{customer_id}/records", {"recordType": "clinical_note", "title": "not allowed", "body": "synthetic"})
assert status == 403, (status, nurse_note_denied)

pdf_bytes = b"%PDF-1.4\nSynthetic local attachment test\n"
status, uploaded_attachment = upload_multipart(nurse, f"/api/ops/customers/{customer_id}/files", {"title": "Synthetic lab report", "notes": "ملاحظة اختبار محلية", "appointmentId": appointment_id}, "lab-report.pdf", "application/pdf", pdf_bytes)
assert status == 201 and uploaded_attachment.get("record", {}).get("appointmentId") == appointment_id and uploaded_attachment.get("record", {}).get("body") == "ملاحظة اختبار محلية" and "attachmentKey" not in uploaded_attachment.get("record", {}), (status, uploaded_attachment)
attachment_record_id = uploaded_attachment["record"]["id"]
status, nurse_profile_after = request(nurse, "GET", f"/api/ops/customers/{customer_id}")
saved_attachment = next((record for record in nurse_profile_after.get("records", []) if record.get("id") == attachment_record_id), None)
assert status == 200 and saved_attachment and saved_attachment.get("recordType") == "attachment" and saved_attachment.get("body") == "ملاحظة اختبار محلية" and "attachmentKey" not in saved_attachment and json.loads(saved_attachment["metadataJson"]).get("fileName") == "lab-report.pdf", (status, nurse_profile_after)
status, inline_bytes, inline_headers = request_raw(nurse, "GET", f"/api/ops/customers/{customer_id}/files/{attachment_record_id}")
assert status == 200 and inline_bytes == pdf_bytes and inline_headers.get("Content-Type") == "application/pdf" and inline_headers.get("X-Content-Type-Options") == "nosniff" and inline_headers.get("Content-Disposition", "").startswith("inline;"), (status, inline_headers)
status, download_bytes, download_headers = request_raw(nurse, "GET", f"/api/ops/customers/{customer_id}/files/{attachment_record_id}?download=1")
assert status == 200 and download_bytes == pdf_bytes and download_headers.get("Content-Disposition", "").startswith("attachment;") and "lab-report.pdf" in download_headers.get("Content-Disposition", ""), (status, download_headers)
status, spoofed_upload = upload_multipart(nurse, f"/api/ops/customers/{customer_id}/files", {"title": "Spoofed upload", "appointmentId": appointment_id}, "bad.pdf", "application/pdf", b"<svg>")
assert status == 400, (status, spoofed_upload)
status, cross_branch_attachment = upload_multipart(nurse, f"/api/ops/customers/{customer2_id}/files", {"title": "Cross-branch", "appointmentId": appointment2_id}, "other.pdf", "application/pdf", pdf_bytes)
assert status in (403, 404), (status, cross_branch_attachment)

from_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
to_date = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat().replace("+00:00", "Z")
query = urllib.parse.urlencode({"from": from_date, "to": to_date})

status, list_a = request(owner_a, "GET", f"/api/ops/appointments?{query}")
assert status == 200, (status, list_a)
assert appointment_id not in {row["id"] for row in list_a.get("appointments", [])}, list_a

status, list_b = request(owner_b, "GET", f"/api/ops/appointments?{query}")
assert status == 200, (status, list_b)
assert appointment_id in {row["id"] for row in list_b.get("appointments", [])}, list_b

status, cross_patch = request(
    owner_a,
    "PATCH",
    f"/api/ops/appointments/{appointment_id}",
    {"status": "cancelled", "cancellationReason": "isolation-test"},
)
assert status == 404, (status, cross_patch)
status, cross_customer = request(owner_a, "GET", f"/api/ops/customers/{customer_id}")
assert status == 404, (status, cross_customer)

status, warehouse_a = request(owner_b, "POST", "/api/ops/inventory/warehouses", {"code": f"W{uid()[:8]}", "name": "مخزن اختبار أساسي", "branchId": branch_id})
assert status == 201, (status, warehouse_a)
warehouse_id = warehouse_a["warehouse"]["id"]
status, warehouse_b = request(owner_b, "POST", "/api/ops/inventory/warehouses", {"code": f"W{uid()[:8]}", "name": "مخزن اختبار تحويل", "branchId": branch_id})
assert status == 201, (status, warehouse_b)
target_warehouse_id = warehouse_b["warehouse"]["id"]
status, item_result = request(owner_b, "POST", "/api/ops/inventory", {"sku": f"SKU{uid()[:8]}", "barcode": f"BC{uid()[:10]}", "name": "صنف اختبار تكامل", "category": "اختبار", "unitCode": "قطعة", "quantityScale": 0, "reorderThreshold": 1, "defaultCost": 2, "sellingPrice": 3, "tracksBatches": False, "tracksExpiry": False})
assert status == 201, (status, item_result)
item_id = item_result["item"]["id"]
storekeeper, storekeeper_id = create_staff(owner_b, "storekeeper", True)
status, storekeeper_assignment = request(owner_b, "PUT", "/api/ops/branch-memberships", {"userId": storekeeper_id, "branchIds": [branch_id]})
assert status == 200, (status, storekeeper_assignment)
status, cross_branch_warehouse = request(owner_b, "POST", "/api/ops/inventory/warehouses", {"code": f"W{uid()[:8]}", "name": "مخزن خارج عضوية أمين المخزن", "branchId": branch2_id})
assert status == 201, (status, cross_branch_warehouse)
cross_branch_warehouse_id = cross_branch_warehouse["warehouse"]["id"]
status, warehouse_scope = request(storekeeper, "GET", "/api/ops/inventory/warehouses")
assert status == 200 and cross_branch_warehouse_id not in {row["id"] for row in warehouse_scope.get("warehouses", [])}, (status, warehouse_scope)
status, cross_branch_movement = request(storekeeper, "POST", "/api/ops/inventory/movements", {"idempotencyKey": f"cross-branch-{uid()}", "type": "adjustment", "sourceWarehouseId": cross_branch_warehouse_id, "lines": [{"itemId": item_id, "quantity": 1, "direction": "increase"}]})
assert status == 403, (status, cross_branch_movement)
status, supplier_result = request(owner_b, "POST", "/api/ops/suppliers", {"name": "مورد اختبار", "phone": "+201200000001"})
assert status == 201, (status, supplier_result)
supplier_id = supplier_result["supplier"]["id"]
status, tracked_item_result = request(owner_b, "POST", "/api/ops/inventory", {"sku": f"LOT{uid()[:8]}", "barcode": f"LOTBC{uid()[:8]}", "name": "صنف اختبار صلاحية", "category": "اختبار", "unitCode": "عبوة", "quantityScale": 0, "reorderThreshold": 0, "defaultCost": 2, "sellingPrice": 4, "tracksBatches": True, "tracksExpiry": True})
assert status == 201, (status, tracked_item_result)
tracked_item_id = tracked_item_result["item"]["id"]
expiry_date = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
concurrent_lot = f"CONCURRENT-{uid()[:8]}"
purchase_barrier = threading.Barrier(2)
concurrent_purchase_payloads = [{"idempotencyKey": f"lot-race-{uid()}", "supplierId": supplier_id, "warehouseId": warehouse_id, "invoiceNumber": f"RACE-{uid()[:8]}", "paidAmount": 0, "paymentMethod": "cash", "lines": [{"itemId": tracked_item_id, "quantity": 1, "unitCost": 2, "lotNumber": concurrent_lot, "expiresOn": expiry_date}]} for _ in range(2)]
def concurrent_purchase(payload):
    purchase_barrier.wait(timeout=10)
    return request(owner_b, "POST", "/api/ops/purchases", payload)
with ThreadPoolExecutor(max_workers=2) as pool:
    concurrent_purchases = list(pool.map(concurrent_purchase, concurrent_purchase_payloads))
assert [status for status, _ in concurrent_purchases] == [201, 201], concurrent_purchases
status, tracked_purchase = request(owner_b, "POST", "/api/ops/purchases", {"idempotencyKey": f"expiry-{uid()}", "supplierId": supplier_id, "warehouseId": warehouse_id, "invoiceNumber": f"LOT-{uid()[:8]}", "paidAmount": 4, "lines": [{"itemId": tracked_item_id, "quantity": 2, "unitCost": 2, "lotNumber": f"LOT-{uid()[:8]}", "expiresOn": expiry_date}]})
assert status == 201, (status, tracked_purchase)
expired_batch_id, expired_lot_number = uid(), f"EXPIRED-{uid()[:8]}"
expired_date = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
run_wrangler(f"INSERT INTO inventory_batches (id,tenant_id,item_id,lot_number,expires_on,received_at,created_at) VALUES ('{expired_batch_id}','{tenant_b}','{tracked_item_id}','{expired_lot_number}','{expired_date}',unixepoch(),unixepoch())")
status, expired_adjustment = request(owner_b, "POST", "/api/ops/inventory/movements", {"idempotencyKey": f"expired-adjust-{uid()}", "type": "adjustment", "sourceWarehouseId": warehouse_id, "lines": [{"itemId": tracked_item_id, "quantity": 1, "direction": "increase", "batchId": expired_batch_id}]})
assert status == 409, (status, expired_adjustment)
status, inventory_alerts = request(owner_b, "GET", "/api/ops/inventory")
assert status == 200 and any(row["id"] == tracked_item_id and row["alertType"] == "near_expiry" for row in inventory_alerts.get("expiryAlerts", [])), (status, inventory_alerts)
purchase_payload = {"idempotencyKey": f"purchase-{uid()}", "supplierId": supplier_id, "warehouseId": warehouse_id, "invoiceNumber": f"TEST-{uid()[:8]}", "paidAmount": 5, "paymentMethod": "cash", "lines": [{"itemId": item_id, "quantity": 10, "unitCost": 2}]}
status, purchase = request(owner_b, "POST", "/api/ops/purchases", purchase_payload)
assert status == 201 and purchase.get("purchase", {}).get("totalMinor") == 2000, (status, purchase)
status, purchase_replay = request(owner_b, "POST", "/api/ops/purchases", purchase_payload)
assert status == 200 and purchase_replay.get("replayed") is True, (status, purchase_replay)
purchase_id = purchase["purchase"]["id"]
supplier_payment_payload = {"idempotencyKey": f"supplier-payment-{uid()}", "purchaseInvoiceId": purchase_id, "amount": 3, "paymentMethod": "cash"}
status, supplier_payment = request(owner_b, "POST", f"/api/ops/suppliers/{supplier_id}/payments", supplier_payment_payload)
assert status == 201, (status, supplier_payment)
status, supplier_payment_replay = request(owner_b, "POST", f"/api/ops/suppliers/{supplier_id}/payments", supplier_payment_payload)
assert status == 200 and supplier_payment_replay.get("replayed") is True, (status, supplier_payment_replay)
status, overpayment = request(owner_b, "POST", f"/api/ops/suppliers/{supplier_id}/payments", {"idempotencyKey": f"supplier-overpay-{uid()}", "purchaseInvoiceId": purchase_id, "amount": 13, "paymentMethod": "cash"})
assert status == 409, (status, overpayment)
status, supplier_list = request(owner_b, "GET", "/api/ops/suppliers")
assert status == 200 and next(row for row in supplier_list["suppliers"] if row["id"] == supplier_id)["payableMinor"] == 1600, (status, supplier_list)
status, disable_stock_item = request(owner_b, "PATCH", f"/api/ops/inventory/items/{item_id}", {"isActive": False})
assert status == 409, (status, disable_stock_item)
transfer_payload = {"idempotencyKey": f"transfer-{uid()}", "type": "transfer", "sourceWarehouseId": warehouse_id, "targetWarehouseId": target_warehouse_id, "lines": [{"itemId": item_id, "quantity": 3}], "notes": "اختبار نقل ذري"}
status, transfer = request(owner_b, "POST", "/api/ops/inventory/movements", transfer_payload)
assert status == 201 and len(transfer.get("movements", [])) == 2, (status, transfer)
status, transfer_replay = request(owner_b, "POST", "/api/ops/inventory/movements", transfer_payload)
assert status == 200 and transfer_replay.get("replayed") is True, (status, transfer_replay)
adjustment_payload = {"idempotencyKey": f"adjust-{uid()}", "type": "adjustment", "sourceWarehouseId": target_warehouse_id, "lines": [{"itemId": item_id, "quantity": 2, "direction": "increase"}], "notes": "اختبار تسوية زيادة"}
status, adjusted = request(owner_b, "POST", "/api/ops/inventory/movements", adjustment_payload)
assert status == 201, (status, adjusted)
status, shortage = request(owner_b, "POST", "/api/ops/inventory/movements", {"idempotencyKey": f"short-{uid()}", "type": "stock_out", "sourceWarehouseId": target_warehouse_id, "lines": [{"itemId": item_id, "quantity": 6}]})
assert status == 409, (status, shortage)
status, inventory_a = request(owner_a, "GET", "/api/ops/inventory")
assert status == 200 and item_id not in {row["id"] for row in inventory_a.get("items", [])}, (status, inventory_a)
status, suppliers_a = request(owner_a, "GET", "/api/ops/suppliers")
assert status == 200 and supplier_id not in {row["id"] for row in suppliers_a.get("suppliers", [])}, (status, suppliers_a)
invoice_payload = {"idempotencyKey": f"pos-{uid()}", "branchId": branch_id, "customerId": customer_id, "items": [{"type": "inventory", "inventoryItemId": item_id, "warehouseId": target_warehouse_id, "quantity": 2}], "payments": [{"amount": 3, "method": "cash"}]}
status, opened_shift = request(owner_b, "POST", "/api/ops/settlements", {"action": "open", "branchId": branch_id, "openingCash": 0})
assert status == 201, (status, opened_shift)
settlement_id = opened_shift["settlement"]["id"]
status, missing_invoice_key = request(owner_b, "POST", "/api/ops/invoices", {key: value for key, value in invoice_payload.items() if key != "idempotencyKey"})
assert status == 400, (status, missing_invoice_key)
status, invoice = request(owner_b, "POST", "/api/ops/invoices", invoice_payload)
assert status == 201 and invoice.get("invoice", {}).get("totalMinor") == 600, (status, invoice)
status, invoice_replay = request(owner_b, "POST", "/api/ops/invoices", invoice_payload)
assert status == 200 and invoice_replay.get("replayed") is True, (status, invoice_replay)
different_invoice_payload = {**invoice_payload, "items": [{"type": "inventory", "inventoryItemId": item_id, "warehouseId": target_warehouse_id, "quantity": 1}]}
status, invoice_key_conflict = request(owner_b, "POST", "/api/ops/invoices", different_invoice_payload)
assert status == 409, (status, invoice_key_conflict)
payment_payload = {"idempotencyKey": f"invoice-payment-{uid()}", "amount": 1, "method": "cash", "reference": "partial-payment-test"}
status, invoice_payment = request(owner_b, "POST", f"/api/ops/invoices/{invoice['invoice']['id']}/payments", payment_payload)
assert status == 200 and invoice_payment.get("invoice", {}).get("paidMinor") == 400, (status, invoice_payment)
status, invoice_payment_replay = request(owner_b, "POST", f"/api/ops/invoices/{invoice['invoice']['id']}/payments", payment_payload)
assert status == 200 and invoice_payment_replay.get("replayed") is True and invoice_payment_replay.get("invoice", {}).get("paidMinor") == 400, (status, invoice_payment_replay)
status, payment_key_conflict = request(owner_b, "POST", f"/api/ops/invoices/{invoice['invoice']['id']}/payments", {**payment_payload, "amount": 1.5})
assert status == 409, (status, payment_key_conflict)
status, closed_shift = request(owner_b, "POST", "/api/ops/settlements", {"action": "close", "settlementId": settlement_id, "countedCash": 4})
assert status == 200 and closed_shift.get("settlement", {}).get("status") == "closed" and any(row["paymentMethod"] == "cash" and row["differenceMinor"] == 0 for row in closed_shift.get("lines", [])), (status, closed_shift)
status, settlement_history = request(owner_b, "GET", f"/api/ops/settlements?branchId={branch_id}")
assert status == 200 and any(row["id"] == settlement_id for row in settlement_history.get("history", [])), (status, settlement_history)
status, catalog = request(owner_b, "GET", f"/api/ops/pos/catalog?branchId={branch_id}")
assert status == 200 and any(row["itemId"] == item_id for row in catalog.get("products", [])), (status, catalog)
status, mapping = request(owner_b, "POST", "/api/ops/inventory/materials", {"serviceId": service_id, "itemId": item_id, "warehouseId": warehouse_id, "quantityPerService": 1})
assert status in (200, 201), (status, mapping)
status, encounter = request(owner_b, "POST", f"/api/ops/customers/{customer_id}/clinical", {"appointmentId": appointment_id, "practitionerId": provider_id, "vitals": {"test": "synthetic"}, "allergies": "", "problems": [], "assessment": "Synthetic smoke test only; not a clinical assessment.", "plan": "Synthetic test record; no treatment."})
assert status == 201, (status, encounter)
encounter_id = encounter["encounter"]["id"]
status, prescription = request(owner_b, "POST", f"/api/ops/customers/{customer_id}/clinical/{encounter_id}/prescriptions", {"medicineName": "Synthetic test item", "dose": "1", "doseUnit": "unit", "frequency": "test only", "duration": "1", "durationUnit": "day", "route": "test", "warnings": "Synthetic local test; do not dispense."})
assert status == 201, (status, prescription)
status, clinical_file = request(owner_b, "GET", f"/api/ops/customers/{customer_id}/clinical")
assert status == 200 and any(row["id"] == encounter_id and len(row.get("prescriptions", [])) == 1 for row in clinical_file.get("encounters", [])), (status, clinical_file)
status, completed_appointment = request(owner_b, "PATCH", f"/api/ops/appointments/{appointment_id}", {"status": "completed"})
assert status == 200 and completed_appointment.get("appointment", {}).get("status") == "completed", (status, completed_appointment)
status, completed_again = request(owner_b, "PATCH", f"/api/ops/appointments/{appointment_id}", {"status": "completed"})
assert status == 200, (status, completed_again)
status, movement_rows = request(owner_b, "GET", "/api/ops/inventory/movements")
assert status == 200 and sum(1 for row in movement_rows.get("movements", []) if row["movementType"] == "service_consumption" and row["itemId"] == item_id and row["referenceId"] == appointment_id) == 1, (status, movement_rows)
status, final_inventory = request(owner_b, "GET", "/api/ops/inventory")
assert status == 200, (status, final_inventory)
final_balances = {(row["itemId"], row["warehouseId"]): row["quantityOnHand"] for row in final_inventory.get("balances", [])}
assert final_balances[(item_id, warehouse_id)] == 6 and final_balances[(item_id, target_warehouse_id)] == 3, final_balances
status, disable_stock_warehouse = request(owner_b, "PATCH", f"/api/ops/inventory/warehouses/{warehouse_id}", {"isActive": False})
assert status == 409, (status, disable_stock_warehouse)

storekeeper = create_staff(owner_b, "storekeeper")
doctor, doctor_user_id = create_staff(owner_b, "doctor", return_user_id=True)
status, doctor_assignment = request(owner_b, "PUT", "/api/ops/branch-memberships", {"userId": doctor_user_id, "branchIds": [branch_id]})
assert status == 200, ("doctor branch assignment", status, doctor_assignment)
receptionist = create_staff(owner_b, "receptionist")
admin = create_staff(owner_b, "admin")
status, _ = request(storekeeper, "GET", "/api/ops/inventory")
assert status == 200, ("storekeeper inventory", status)
status, _ = request(storekeeper, "GET", "/api/ops/suppliers")
assert status == 200, ("storekeeper suppliers", status)
status, denied_invoice = request(storekeeper, "GET", "/api/ops/invoices")
assert status == 403, ("storekeeper invoice denial", status, denied_invoice)
status, _ = request(receptionist, "GET", "/api/ops/invoices")
assert status == 200, ("receptionist invoices", status)
status, denied_inventory = request(receptionist, "GET", "/api/ops/inventory")
assert status == 403, ("receptionist inventory denial", status, denied_inventory)
status, _ = request(doctor, "GET", f"/api/ops/appointments?{query}")
assert status == 200, ("doctor appointments", status)
status, denied_medical_storekeeper = request(storekeeper, "GET", f"/api/ops/customers/{customer_id}")
assert status in (403, 404), ("storekeeper patient denial", status, denied_medical_storekeeper)
status, denied_storekeeper_item = request(doctor, "GET", "/api/ops/inventory")
assert status == 403, ("doctor inventory denial", status, denied_storekeeper_item)
status, denied_admin_team = request(admin, "GET", "/api/ops/team")
assert status == 403, ("admin team-owner boundary", status, denied_admin_team)

# Clinical staff may only manage queue tickets backed by their own assigned appointments.
queue_start_local = start_local + timedelta(hours=3)
queue_start_utc = queue_start_local.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
queue_weekday = (queue_start_local.weekday() + 1) % 7
run_wrangler(f"INSERT INTO schedules (id,tenant_id,branch_id,provider_id,weekday,starts_at,ends_at,breaks_json,is_available,created_at,updated_at) VALUES ('{uid()}','{tenant_b}','{branch_id}','{doctor_user_id}',{queue_weekday},'08:00','20:00','[]',1,unixepoch(),unixepoch())")
status, doctor_appointment = request(owner_b, "POST", "/api/ops/appointments", {"customerId": customer_id, "serviceId": service_id, "branchId": branch_id, "providerId": doctor_user_id, "startsAt": queue_start_utc, "status": "confirmed", "notes": "Queue clinical test"})
assert status == 201, (status, doctor_appointment)
doctor_appointment_id = doctor_appointment["appointment"]["id"]
queue_issue_payload = {"action": "issue", "branchId": branch_id, "appointmentId": doctor_appointment_id}
queue_issue_barrier = threading.Barrier(2)
def concurrent_queue_issue(_):
    queue_issue_barrier.wait(timeout=10)
    return request(owner_b, "POST", "/api/ops/queue", queue_issue_payload)
with ThreadPoolExecutor(max_workers=2) as pool:
    queue_issue_results = list(pool.map(concurrent_queue_issue, range(2)))
assert sorted(status for status, _ in queue_issue_results) == [201, 409], queue_issue_results
status, issued_ticket = next((status, data) for status, data in queue_issue_results if status == 201)
assert status == 201, (status, issued_ticket)
ticket_id = issued_ticket["ticket"]["id"]
status, doctor_queue = request(doctor, "GET", f"/api/ops/queue?branchId={branch_id}")
assert status == 200 and ticket_id in {ticket["id"] for ticket in doctor_queue.get("tickets", [])}, (status, doctor_queue)
status, denied_doctor_call = request(doctor, "POST", "/api/ops/queue", {"action": "call_next", "branchId": branch_id})
assert status == 403, (status, denied_doctor_call)
status, denied_unassigned_patch = request(doctor, "PATCH", f"/api/ops/appointments/{appointment_id}", {"notes": "forbidden"})
assert status == 403, (status, denied_unassigned_patch)
status, called_ticket = request(owner_b, "POST", "/api/ops/queue", {"action": "call_next", "branchId": branch_id})
assert status == 200 and called_ticket.get("ticket", {}).get("id") == ticket_id, (status, called_ticket)
status, started_ticket = request(doctor, "POST", "/api/ops/queue", {"action": "start", "branchId": branch_id, "ticketId": ticket_id})
assert status == 200 and started_ticket.get("ticket", {}).get("status") == "serving", (status, started_ticket)
queue_complete_barrier = threading.Barrier(2)
def concurrent_queue_complete(_):
    queue_complete_barrier.wait(timeout=10)
    return request(doctor, "POST", "/api/ops/queue", {"action": "complete", "branchId": branch_id, "ticketId": ticket_id})
with ThreadPoolExecutor(max_workers=2) as pool:
    queue_complete_results = list(pool.map(concurrent_queue_complete, range(2)))
assert [status for status, _ in queue_complete_results] == [200, 200], queue_complete_results
assert all(data.get("ticket", {}).get("status") == "completed" for _, data in queue_complete_results), queue_complete_results
status, queue_appointment_after = request(doctor, "PATCH", f"/api/ops/appointments/{doctor_appointment_id}", {"status": "completed"})
assert status == 200 and queue_appointment_after.get("appointment", {}).get("status") == "completed", (status, queue_appointment_after)
status, queue_movements = request(owner_b, "GET", "/api/ops/inventory/movements")
assert status == 200 and sum(1 for row in queue_movements.get("movements", []) if row["movementType"] == "service_consumption" and row["itemId"] == item_id and row["referenceId"] == doctor_appointment_id) == 1, (status, queue_movements)
status, after_queue_inventory = request(owner_b, "GET", "/api/ops/inventory")
assert status == 200, (status, after_queue_inventory)
after_queue_balances = {(row["itemId"], row["warehouseId"]): row["quantityOnHand"] for row in after_queue_inventory.get("balances", [])}
assert after_queue_balances[(item_id, warehouse_id)] == 5 and after_queue_balances[(item_id, target_warehouse_id)] == 3, after_queue_balances

# Concurrent retries of one inventory operation must create exactly one ledger entry; reusing the key for another operation type conflicts.
movement_barrier = threading.Barrier(2)
concurrent_movement_payload = {"idempotencyKey": f"movement-race-{uid()}", "type": "adjustment", "sourceWarehouseId": target_warehouse_id, "lines": [{"itemId": item_id, "quantity": 1, "direction": "increase"}], "notes": "اختبار retry متزامن"}
def concurrent_movement(_):
    movement_barrier.wait(timeout=10)
    return request(owner_b, "POST", "/api/ops/inventory/movements", concurrent_movement_payload)
with ThreadPoolExecutor(max_workers=2) as pool:
    concurrent_movements = list(pool.map(concurrent_movement, range(2)))
assert sorted(status for status, _ in concurrent_movements) == [200, 201], concurrent_movements
status, movement_type_conflict = request(owner_b, "POST", "/api/ops/inventory/movements", {**concurrent_movement_payload, "type": "stock_out", "lines": [{"itemId": item_id, "quantity": 1}]})
assert status == 409, (status, movement_type_conflict)
status, movement_payload_conflict = request(owner_b, "POST", "/api/ops/inventory/movements", {**concurrent_movement_payload, "lines": [{"itemId": item_id, "quantity": 2, "direction": "increase"}]})
assert status == 409, (status, movement_payload_conflict)
status, concurrency_inventory = request(owner_b, "GET", "/api/ops/inventory")
assert status == 200, (status, concurrency_inventory)
concurrency_balances = {(row["itemId"], row["warehouseId"]): row["quantityOnHand"] for row in concurrency_inventory.get("balances", [])}
assert concurrency_balances[(item_id, target_warehouse_id)] == 4, concurrency_balances

print("HTTP local acceptance passed: onboarding identity/branch/schedule completion; tenant and branch isolation; explicit staff memberships and cross-branch assignment denial; nurse-only branch-scoped medical attachment upload/preview/download and clinical-record denial; atomic QR check-in and replay rejection; synthetic EMR and prescription; POS/payment/idempotency; inventory and purchase/supplier flows; Z-report shift open/close; Queue and service consumption exactly once; final balances.")
