#!/usr/bin/env python3
"""Isolated SQLite integration tests for the inventory migrations and invariants."""
from __future__ import annotations
import pathlib
import sqlite3
import uuid
from datetime import date, timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "drizzle/migrations").glob("*.sql"))
conn = sqlite3.connect(":memory:")
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA foreign_keys = ON")
for migration in MIGRATIONS:
    conn.executescript(migration.read_text())

# Verify the upgrade migration preserves the existing retail price in the new tiers.
backfill_db = sqlite3.connect(":memory:")
backfill_db.execute("PRAGMA foreign_keys = ON")
backfill_migration = next(path for path in MIGRATIONS if path.name == "0024_uneven_agent_zero.sql")
backfill_index = MIGRATIONS.index(backfill_migration)
for migration in MIGRATIONS[:backfill_index]:
    backfill_db.executescript(migration.read_text())
backfill_tenant, backfill_item = str(uuid.uuid4()), str(uuid.uuid4())
backfill_db.execute("INSERT INTO tenants (id,name,slug,vertical,status,timezone,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (backfill_tenant, "Tier Backfill", f"tier-{backfill_tenant[:8]}", "retail", "active", "UTC", "{}", 1, 1))
backfill_db.execute("INSERT INTO inventory_items (id,tenant_id,sku,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,selling_price_minor,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1250,0,0,1,1,1)", (backfill_item, backfill_tenant, "OLD-PRICE", "Legacy item", "retail", "piece", 0, 0, 500))
backfill_db.executescript(backfill_migration.read_text())
for migration in MIGRATIONS[backfill_index + 1:]:
    backfill_db.executescript(migration.read_text())
backfilled = backfill_db.execute("SELECT wholesale_price_minor, distributor_price_minor FROM inventory_items WHERE id=?", (backfill_item,)).fetchone()
assert tuple(backfilled) == (1250, 1250), tuple(backfilled)

# The bilingual branch migration preserves Arabic names and never exposes them as English labels.
branch_backfill_db = sqlite3.connect(":memory:")
branch_backfill_db.row_factory = sqlite3.Row
branch_backfill_db.execute("PRAGMA foreign_keys = ON")
branch_migration = next(path for path in MIGRATIONS if path.name == "0041_material_lady_vermin.sql")
branch_migration_index = MIGRATIONS.index(branch_migration)
for migration in MIGRATIONS[:branch_migration_index]:
    branch_backfill_db.executescript(migration.read_text())
branch_tenant = str(uuid.uuid4())
branch_backfill_db.execute("INSERT INTO tenants (id,name,slug,vertical,status,timezone,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (branch_tenant, "Branch Backfill", f"branch-{branch_tenant[:8]}", "retail", "active", "UTC", "{}", 1, 1))
arabic_branch_id, english_branch_id = str(uuid.uuid4()), str(uuid.uuid4())
branch_backfill_db.execute("INSERT INTO branches (id,tenant_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,1,1)", (arabic_branch_id, branch_tenant, "الفرع الرئيسي"))
branch_backfill_db.execute("INSERT INTO branches (id,tenant_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,1,1)", (english_branch_id, branch_tenant, "Central branch"))
for migration in MIGRATIONS[branch_migration_index:]:
    branch_backfill_db.executescript(migration.read_text())
localized_rows = {row["id"]: row for row in branch_backfill_db.execute("SELECT id,name,name_ar,name_en FROM branches WHERE tenant_id=?", (branch_tenant,))}
assert localized_rows[arabic_branch_id]["name_ar"] == "الفرع الرئيسي"
assert localized_rows[arabic_branch_id]["name_en"] == f"Branch {arabic_branch_id}"
assert localized_rows[english_branch_id]["name_ar"] == "Central branch"
assert localized_rows[english_branch_id]["name_en"] == "Central branch"

def uid() -> str:
    return str(uuid.uuid4())

def must_fail(fn, fragment: str) -> None:
    try:
        fn()
    except sqlite3.IntegrityError as exc:
        assert fragment in str(exc), (fragment, str(exc))
    else:
        raise AssertionError(f"expected IntegrityError containing {fragment}")

tenants = [uid(), uid()]
users = [uid(), uid()]
for index, tenant in enumerate(tenants):
    conn.execute("INSERT INTO tenants (id,name,slug,vertical,status,timezone,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (tenant, f"Test {index}", f"test-{index}-{uid()[:6]}", "medical", "active_trial", "Africa/Cairo", "{}", 1, 1))
    conn.execute("INSERT INTO users (id,tenant_id,email,password_hash,full_name,role,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (users[index], tenant, f"test{index}@example.test", "synthetic", f"Test {index}", "business_admin", 1, 1, 1))
warehouses = [uid(), uid(), uid()]
for wh, tenant, code in ((warehouses[0], tenants[0], "MAIN"), (warehouses[1], tenants[0], "BRANCH"), (warehouses[2], tenants[1], "OTHER")):
    conn.execute("INSERT INTO inventory_warehouses (id,tenant_id,code,name,is_active,created_at,updated_at) VALUES (?,?,?,?,1,1,1)", (wh, tenant, code, code))
item = uid()
conn.execute("INSERT INTO inventory_items (id,tenant_id,sku,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,0,1,1,1)", (item, tenants[0], "SKU-001", "Gauze", "consumable", "piece", 0, 2, 250))
supplier = uid()
conn.execute("INSERT INTO suppliers (id,tenant_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,1,1)", (supplier, tenants[0], "Synthetic supplier"))

def add_operation(tenant: str, key: str, kind: str = "adjustment", reference_type: str = "test") -> str:
    op = uid()
    conn.execute("INSERT INTO stock_operations (id,tenant_id,operation_type,idempotency_key,reference_type,reference_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,1)", (op, tenant, kind, key, reference_type, key, users[tenants.index(tenant)]))
    return op

def ensure_balance(tenant: str, stock_item: str, wh: str, batch: str | None = None) -> None:
    conn.execute("INSERT INTO inventory_balances (id,tenant_id,item_id,warehouse_id,batch_id,batch_key,quantity_on_hand,updated_at) VALUES (?,?,?,?,?,?,0,1) ON CONFLICT (tenant_id,item_id,warehouse_id,batch_key) DO NOTHING", (uid(), tenant, stock_item, wh, batch, batch or ""))

def movement(op: str, tenant: str, stock_item: str, wh: str, delta: int, kind: str = "adjustment", batch: str | None = None, cost: int = 250) -> None:
    conn.execute("INSERT INTO stock_movements (id,tenant_id,operation_id,item_id,warehouse_id,batch_id,movement_type,quantity_delta,unit_cost_minor,reference_type,reference_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'test',?,?,1)", (uid(), tenant, op, stock_item, wh, batch, kind, delta, cost, op, users[tenants.index(tenant)]))

# A receipt updates the derived balance, and the ledger is append-only.
op = add_operation(tenants[0], "receipt-1", "purchase_receipt")
ensure_balance(tenants[0], item, warehouses[0])
movement(op, tenants[0], item, warehouses[0], 10, "purchase_receipt")
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=?", (item, warehouses[0])).fetchone()[0] == 10
conn.commit()
must_fail(lambda: conn.execute("UPDATE stock_movements SET quantity_delta=999 WHERE operation_id=?", (op,)), "INVENTORY_LEDGER_IMMUTABLE")
must_fail(lambda: conn.execute("DELETE FROM stock_movements WHERE operation_id=?", (op,)), "INVENTORY_LEDGER_IMMUTABLE")
conn.commit()

# A failed multi-statement operation rolls back both its operation and any balances/movements.
failed_key = "attempt-overdraw"
try:
    conn.execute("BEGIN")
    failed_op = add_operation(tenants[0], failed_key, "stock_out")
    ensure_balance(tenants[0], item, warehouses[0])
    movement(failed_op, tenants[0], item, warehouses[0], -11, "stock_out")
    conn.commit()
    raise AssertionError("negative stock unexpectedly committed")
except sqlite3.IntegrityError as exc:
    assert "INVENTORY_INSUFFICIENT_STOCK" in str(exc)
    conn.rollback()
assert conn.execute("SELECT COUNT(*) FROM stock_operations WHERE idempotency_key=?", (failed_key,)).fetchone()[0] == 0
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=?", (item, warehouses[0])).fetchone()[0] == 10

# Transfer is represented as paired out/in movements and conserves the tenant's total stock.
transfer = add_operation(tenants[0], "transfer-1", "transfer")
ensure_balance(tenants[0], item, warehouses[0]); ensure_balance(tenants[0], item, warehouses[1])
movement(transfer, tenants[0], item, warehouses[0], -3, "transfer_out")
movement(transfer, tenants[0], item, warehouses[1], 3, "transfer_in")
assert sorted(r[0] for r in conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? ORDER BY warehouse_id", (item,))) == [3, 7]

# Supplier invoice and payment triggers maintain bounded outstanding payables.
po = add_operation(tenants[0], "purchase-1", "purchase_receipt", "purchase_invoice")
invoice = uid()
conn.execute("INSERT INTO purchase_invoices (id,tenant_id,supplier_id,warehouse_id,operation_id,invoice_number,total_minor,paid_minor,status,created_at) VALUES (?,?,?,?,?,?,10000,0,'received',1)", (invoice, tenants[0], supplier, warehouses[0], po, "INV-001"))
line_id = uid()
conn.execute("INSERT INTO purchase_invoice_lines (id,tenant_id,purchase_invoice_id,item_id,quantity,unit_cost_minor,line_total_minor,created_at) VALUES (?,?,?,?,20,500,10000,1)", (line_id, tenants[0], invoice, item))
payment_id = uid()
conn.execute("INSERT INTO supplier_payments (id,tenant_id,supplier_id,purchase_invoice_id,idempotency_key,amount_minor,payment_method,created_at) VALUES (?,?,?,?,?,4000,'cash',1)", (payment_id, tenants[0], supplier, invoice, "payment-1"))
assert conn.execute("SELECT paid_minor FROM purchase_invoices WHERE id=?", (invoice,)).fetchone()[0] == 4000
must_fail(lambda: conn.execute("INSERT INTO supplier_payments (id,tenant_id,supplier_id,purchase_invoice_id,idempotency_key,amount_minor,payment_method,created_at) VALUES (?,?,?,?,?,7000,'cash',1)", (uid(), tenants[0], supplier, invoice, "payment-too-large")), "SUPPLIER_PAYMENT_EXCEEDS_BALANCE")
assert conn.execute("SELECT paid_minor FROM purchase_invoices WHERE id=?", (invoice,)).fetchone()[0] == 4000

# Tenant A cannot use tenant B's warehouse/item pair, even if the referenced IDs exist.
foreign_op = add_operation(tenants[1], "cross-tenant", "stock_out")
ensure_balance(tenants[1], item, warehouses[2])
must_fail(lambda: movement(foreign_op, tenants[1], item, warehouses[2], 1, "adjustment"), "INVENTORY_ITEM_SCOPE_OR_INACTIVE")

# Expiry-tracked items require batches with expiry; FEFO orders valid lots by soonest expiry.
exp_item = uid()
conn.execute("INSERT INTO inventory_items (id,tenant_id,sku,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,1,1,1)", (exp_item, tenants[0], "SKU-EXP", "Expiring test", "consumable", "piece", 0, 0, 100))
lot_bad = uid()
conn.execute("INSERT INTO inventory_batches (id,tenant_id,item_id,lot_number,expires_on,received_at,created_at) VALUES (?,?,?,?,NULL,1,1)", (lot_bad, tenants[0], exp_item, "LOT-NODATE"))
exp_op = add_operation(tenants[0], "expiry-missing", "purchase_receipt")
ensure_balance(tenants[0], exp_item, warehouses[0], lot_bad)
must_fail(lambda: movement(exp_op, tenants[0], exp_item, warehouses[0], 2, "purchase_receipt", lot_bad), "INVENTORY_EXPIRY_REQUIRED")
lots = [(uid(), (date.today() + timedelta(days=30)).isoformat(), "LOT-FEFO-30"), (uid(), (date.today() + timedelta(days=10)).isoformat(), "LOT-FEFO-10")]
for lot_id, expiry, lot_no in lots:
    conn.execute("INSERT INTO inventory_batches (id,tenant_id,item_id,lot_number,expires_on,received_at,created_at) VALUES (?,?,?,?,?,1,1)", (lot_id, tenants[0], exp_item, lot_no, expiry))
    receipt = add_operation(tenants[0], f"expiry-receipt-{lot_no}", "purchase_receipt")
    ensure_balance(tenants[0], exp_item, warehouses[0], lot_id)
    movement(receipt, tenants[0], exp_item, warehouses[0], 2, "purchase_receipt", lot_id)
ordered = [row[0] for row in conn.execute("SELECT b.lot_number FROM inventory_batches b JOIN inventory_balances q ON q.batch_id=b.id WHERE b.tenant_id=? AND b.item_id=? AND q.warehouse_id=? AND q.quantity_on_hand>0 AND b.expires_on>=? ORDER BY b.expires_on,b.received_at", (tenants[0], exp_item, warehouses[0], date.today().isoformat()))]
assert ordered[:2] == ["LOT-FEFO-10", "LOT-FEFO-30"], ordered
conn.commit()

# A concurrent lot creator may lose ON CONFLICT; balances and movements must resolve the persisted canonical lot ID by its scoped lot key.
canonical_lot = conn.execute("SELECT id FROM inventory_batches WHERE tenant_id=? AND item_id=? AND lot_number=?", (tenants[0], exp_item, "LOT-FEFO-30")).fetchone()[0]
losing_candidate = uid()
conn.execute("BEGIN")
race_op = add_operation(tenants[0], "lot-conflict-resolution", "adjustment")
conn.execute("INSERT INTO inventory_batches (id,tenant_id,item_id,lot_number,expires_on,received_at,created_at) VALUES (?,?,?,?,?,1,1) ON CONFLICT (tenant_id,item_id,lot_number) DO NOTHING", (losing_candidate, tenants[0], exp_item, "LOT-FEFO-30", lots[0][1]))
conn.execute("INSERT INTO inventory_balances (id,tenant_id,item_id,warehouse_id,batch_id,batch_key,quantity_on_hand,updated_at) SELECT ?, ?, ?, ?, b.id, b.id, 0, 1 FROM inventory_batches b WHERE b.tenant_id=? AND b.item_id=? AND b.lot_number=? ON CONFLICT (tenant_id,item_id,warehouse_id,batch_key) DO NOTHING", (uid(), tenants[0], exp_item, warehouses[1], tenants[0], exp_item, "LOT-FEFO-30"))
conn.execute("INSERT INTO stock_movements (id,tenant_id,operation_id,item_id,warehouse_id,batch_id,movement_type,quantity_delta,unit_cost_minor,reference_type,reference_id,created_by,created_at) SELECT ?, ?, ?, ?, ?, b.id, 'adjustment', 1, 100, 'test', ?, ?, 1 FROM inventory_batches b WHERE b.tenant_id=? AND b.item_id=? AND b.lot_number=?", (uid(), tenants[0], race_op, exp_item, warehouses[1], race_op, users[0], tenants[0], exp_item, "LOT-FEFO-30"))
conn.commit()
assert conn.execute("SELECT id FROM inventory_batches WHERE tenant_id=? AND item_id=? AND lot_number=?", (tenants[0], exp_item, "LOT-FEFO-30")).fetchone()[0] == canonical_lot
assert conn.execute("SELECT COUNT(*) FROM inventory_balances WHERE batch_id=?", (losing_candidate,)).fetchone()[0] == 0
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_id=?", (exp_item, warehouses[1], canonical_lot)).fetchone()[0] == 1

# Service material is scoped to the tenant and to a warehouse; valid mappings are retained.
branch = uid(); service = uid()
conn.execute("INSERT INTO branches (id,tenant_id,name,name_ar,name_en,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,1)", (branch, tenants[0], "Branch", "Branch", "Branch"))
conn.execute("INSERT INTO services (id,tenant_id,branch_id,name,kind,price_minor,currency,duration_minutes,provider_commission_bps,is_active,created_at,updated_at,session_count) VALUES (?,?,?,'Service','single',1000,'EGP',30,0,1,1,1,1)", (service, tenants[0], branch))
material = uid()
conn.execute("INSERT INTO service_materials (id,tenant_id,service_id,item_id,warehouse_id,quantity_per_service,is_active,created_at,updated_at) VALUES (?,?,?,?,?,2,1,1,1)", (material, tenants[0], service, item, warehouses[0]))
assert conn.execute("SELECT COUNT(*) FROM service_materials WHERE id=?", (material,)).fetchone()[0] == 1
must_fail(lambda: conn.execute("INSERT INTO service_materials (id,tenant_id,service_id,item_id,warehouse_id,quantity_per_service,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,1,1)", (uid(), tenants[1], service, item, warehouses[2])), "SERVICE_MATERIAL_SERVICE_SCOPE")
must_fail(lambda: conn.execute("INSERT INTO service_materials (id,tenant_id,service_id,item_id,warehouse_id,quantity_per_service,is_active,created_at,updated_at) VALUES (?,?,?,?,NULL,1,1,1,1)", (uid(), tenants[0], service, item)), "SERVICE_MATERIAL_WAREHOUSE_REQUIRED")

# POS item sale is linked to the invoice and deducts stock in the same transaction.
conn.execute("UPDATE inventory_items SET selling_price_minor=500 WHERE id=?", (item,))
invoice_id = uid(); invoice_key = "pos-idempotency-test"
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1000,0,1000,0,'EGP','unpaid','issued',1,1)", (invoice_id, tenants[0], branch, None, users[0], invoice_key, "POS-001"))
invoice_line = uid()
conn.execute("INSERT INTO invoice_items (id,tenant_id,invoice_id,service_id,provider_id,inventory_item_id,stock_warehouse_id,quantity_scale,description,quantity,unit_price_minor,line_total_minor,commission_bps,created_at) VALUES (?,?,?,NULL,NULL,?,?,0,'Gauze',2,500,1000,0,1)", (invoice_line, tenants[0], invoice_id, item, warehouses[0]))
pos_op = add_operation(tenants[0], f"pos-invoice:{invoice_id}", "point_of_sale", "invoice")
conn.execute("UPDATE stock_operations SET reference_id=?,notes='POS sale' WHERE id=?", (invoice_id, pos_op))
movement(pos_op, tenants[0], item, warehouses[0], -2, "pos_deduction")
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0] == 5
assert conn.execute("SELECT COUNT(*) FROM stock_movements WHERE operation_id=? AND movement_type='pos_deduction'", (pos_op,)).fetchone()[0] == 1
must_fail(lambda: conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1000,0,1000,0,'EGP','unpaid','issued',1,1)", (uid(), tenants[0], branch, None, users[0], invoice_key, "POS-DUPLICATE")), "UNIQUE constraint failed")
payment_key = "payment-idempotency-test"
conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,idempotency_key,idempotency_payload_hash,created_at) VALUES (?,?,?,?,100,'cash',?,?,?,1)", (uid(), tenants[0], invoice_id, users[0], "test", payment_key, "payload-hash"))
must_fail(lambda: conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,idempotency_key,idempotency_payload_hash,created_at) VALUES (?,?,?,?,100,'cash',?,?,?,1)", (uid(), tenants[0], invoice_id, users[0], "test", payment_key, "payload-hash")), "UNIQUE constraint failed")
conn.commit()
overdraw_invoice = uid()
try:
    conn.execute("BEGIN")
    conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,50000,0,50000,0,'EGP','unpaid','issued',1,1)", (overdraw_invoice, tenants[0], branch, None, users[0], "pos-overdraw-key", "POS-OVERDRAW"))
    bad_op = add_operation(tenants[0], f"pos-invoice:{overdraw_invoice}", "point_of_sale", "invoice")
    conn.execute("UPDATE stock_operations SET reference_id=? WHERE id=?", (overdraw_invoice, bad_op))
    conn.execute("INSERT INTO invoice_items (id,tenant_id,invoice_id,inventory_item_id,stock_warehouse_id,quantity_scale,description,quantity,unit_price_minor,line_total_minor,commission_bps,created_at) VALUES (?,?,?, ?,?,0,'Gauze',100,500,50000,0,1)", (uid(), tenants[0], overdraw_invoice, item, warehouses[0]))
    movement(bad_op, tenants[0], item, warehouses[0], -100, "pos_deduction")
    conn.commit()
    raise AssertionError("overdrawn POS invoice unexpectedly committed")
except sqlite3.IntegrityError as exc:
    assert "INVENTORY_INSUFFICIENT_STOCK" in str(exc)
    conn.rollback()
assert conn.execute("SELECT COUNT(*) FROM invoices WHERE id=?", (overdraw_invoice,)).fetchone()[0] == 0
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0] == 5

# Offline POS sync preserves the local serial, records a shortage for review, and never makes stock negative.
offline_invoice_id = uid()
offline_local_number = "OFF-0123456789ABCDEF-0000001"
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,sync_status,offline_local_number,offline_created_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1000,0,1000,1000,'EGP','cash','paid','synced',?,1,2,2)", (offline_invoice_id, tenants[0], branch, None, users[0], offline_invoice_id, "QT-OFFLINE-SYNC-001", offline_local_number))
conflict_id = uid()
conn.execute("INSERT INTO offline_stock_conflicts (id,tenant_id,branch_id,invoice_id,item_id,warehouse_id,requested_quantity,available_quantity,shortage_quantity,quantity_scale,created_by,created_at) VALUES (?,?,?,?,?,?,4,1,3,0,?,2)", (conflict_id, tenants[0], branch, offline_invoice_id, item, warehouses[0], users[0]))
assert conn.execute("SELECT sync_status,offline_local_number FROM invoices WHERE id=?", (offline_invoice_id,)).fetchone()[:] == ("synced", offline_local_number)
assert conn.execute("SELECT shortage_quantity,acknowledged_at FROM offline_stock_conflicts WHERE id=?", (conflict_id,)).fetchone()[:] == (3, None)
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0] == 5
conn.execute("UPDATE offline_stock_conflicts SET acknowledged_at=3,acknowledged_by=? WHERE id=?", (users[0], conflict_id))
assert conn.execute("SELECT acknowledged_at FROM offline_stock_conflicts WHERE id=?", (conflict_id,)).fetchone()[0] == 3
conn.commit()

# Prescription dispensing persists the stock linkage once and protects the invoice/stock batch from a duplicate dispense race.
patient_id = uid(); encounter_id = uid(); prescription_id = uid(); rx_invoice_id = uid()
conn.execute("INSERT INTO customers (id,tenant_id,branch_id,full_name,phone,gender,created_at,updated_at) VALUES (?,?,?,?,?,'unspecified',1,1)", (patient_id, tenants[0], branch, "Synthetic patient", "01000000000"))
conn.execute("INSERT INTO clinical_encounters (id,tenant_id,customer_id,appointment_id,practitioner_id,author_id,vitals_json,allergies_text,problems_json,assessment,plan,follow_up,version,created_at,updated_at) VALUES (?,?,?,NULL,?,?,'{}','','[]','Assessment','Plan',NULL,1,1,1)", (encounter_id, tenants[0], patient_id, users[0], users[0]))
conn.execute("INSERT INTO clinical_prescriptions (id,tenant_id,encounter_id,customer_id,author_id,medicine_name,dose,dose_unit,frequency,duration,duration_unit,route,warnings,status,inventory_item_id,warehouse_id,dispense_quantity,dispense_quantity_scale,created_at,updated_at) VALUES (?,?,?,?,?,'Gauze','1','piece','as needed','1','day','topical','', 'active',?,?,2,0,1,1)", (prescription_id, tenants[0], encounter_id, patient_id, users[0], item, warehouses[0]))
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1000,0,1000,0,'EGP','unpaid','issued',1,1)", (rx_invoice_id, tenants[0], branch, patient_id, users[0], "rx-dispense-key", "RX-INV-001"))
conn.execute("INSERT INTO prescription_dispenses (id,tenant_id,prescription_id,invoice_id,inventory_item_id,warehouse_id,quantity,quantity_scale,unit_price_minor,line_total_minor,dispensed_by,created_at) VALUES (?,?,?,?,?,?,2,0,500,1000,?,1)", (uid(), tenants[0], prescription_id, rx_invoice_id, item, warehouses[0], users[0]))
assert conn.execute("SELECT COUNT(*) FROM prescription_dispenses WHERE tenant_id=? AND prescription_id=?", (tenants[0], prescription_id)).fetchone()[0] == 1
must_fail(lambda: conn.execute("INSERT INTO prescription_dispenses (id,tenant_id,prescription_id,invoice_id,inventory_item_id,warehouse_id,quantity,quantity_scale,unit_price_minor,line_total_minor,dispensed_by,created_at) VALUES (?,?,?,?,?,?,1,0,500,500,?,1)", (uid(), tenants[0], prescription_id, rx_invoice_id, item, warehouses[0], users[0])), "UNIQUE constraint failed: prescription_dispenses.tenant_id, prescription_dispenses.prescription_id")
conn.commit()
second_rx_invoice = uid()
try:
    conn.execute("BEGIN")
    conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,500,0,500,0,'EGP','unpaid','issued',1,1)", (second_rx_invoice, tenants[0], branch, patient_id, users[0], "rx-race-key", "RX-INV-002"))
    race_op = add_operation(tenants[0], f"pos-invoice:{second_rx_invoice}", "point_of_sale", "invoice")
    movement(race_op, tenants[0], item, warehouses[0], -1, "pos_deduction")
    conn.execute("INSERT INTO prescription_dispenses (id,tenant_id,prescription_id,invoice_id,inventory_item_id,warehouse_id,quantity,quantity_scale,unit_price_minor,line_total_minor,dispensed_by,created_at) VALUES (?,?,?,?,?,?,1,0,500,500,?,1)", (uid(), tenants[0], prescription_id, second_rx_invoice, item, warehouses[0], users[0]))
    conn.commit()
    raise AssertionError("duplicate prescription dispense unexpectedly committed")
except sqlite3.IntegrityError as exc:
    assert "prescription_dispenses.tenant_id, prescription_dispenses.prescription_id" in str(exc)
    conn.rollback()
assert conn.execute("SELECT COUNT(*) FROM invoices WHERE id=?", (second_rx_invoice,)).fetchone()[0] == 0
assert conn.execute("SELECT COUNT(*) FROM stock_operations WHERE idempotency_key=?", (f"pos-invoice:{second_rx_invoice}",)).fetchone()[0] == 0
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0] == 5
conn.commit()

# Product variants retain tenant-scoped unique SKU/barcodes and independent price tiers.
variant_group = uid(); variant_a = uid(); variant_b = uid()
conn.execute("INSERT INTO inventory_items (id,tenant_id,sku,barcode,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,selling_price_minor,wholesale_price_minor,distributor_price_minor,variant_group_id,variant_size,variant_color,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'retail','piece',0,0,100,1500,1200,1100,?,'M','Blue',0,0,1,1,1)", (variant_a, tenants[0], "TEE-M-BL", "BC-TEE-M-BL", "T-shirt", variant_group))
must_fail(lambda: conn.execute("INSERT INTO inventory_items (id,tenant_id,sku,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,'Duplicate','retail','piece',0,0,0,0,0,1,1,1)", (uid(), tenants[0], "TEE-M-BL")), "UNIQUE constraint failed")
conn.execute("INSERT INTO inventory_items (id,tenant_id,sku,barcode,name,category,unit_code,quantity_scale,reorder_threshold,default_cost_minor,selling_price_minor,wholesale_price_minor,distributor_price_minor,variant_group_id,variant_size,variant_color,tracks_batches,tracks_expiry,is_active,created_at,updated_at) VALUES (?,?,?,?,?,'retail','piece',0,0,100,1600,1250,1150,?,'L','Blue',0,0,1,1,1)", (variant_b, tenants[0], "TEE-L-BL", "BC-TEE-L-BL", "T-shirt", variant_group))
assert conn.execute("SELECT COUNT(*) FROM inventory_items WHERE tenant_id=? AND variant_group_id=?", (tenants[0], variant_group)).fetchone()[0] == 2
assert tuple(conn.execute("SELECT selling_price_minor, wholesale_price_minor, distributor_price_minor FROM inventory_items WHERE id=?", (variant_a,)).fetchone()) == (1500, 1200, 1100)

# Quotes are immutable snapshots that do not deduct stock until conversion creates an invoice.
customer_id, quote_id, quote_item_id = uid(), uid(), uid()
now_ms = int(__import__("time").time() * 1000)
conn.execute("INSERT INTO customers (id,tenant_id,branch_id,full_name,phone,gender,created_at,updated_at) VALUES (?,?,?,?,?,'unspecified',?,?)", (customer_id, tenants[0], branch, "Quote customer", "+201000000000", now_ms, now_ms))
balance_before_quote = conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0]
conn.execute("INSERT INTO quotations (id,tenant_id,branch_id,customer_id,created_by,idempotency_key,payload_hash,quote_number,status,subtotal_minor,discount_minor,total_minor,currency,valid_until,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'issued',1500,0,1500,'EGP',?,'snapshot',?,?)", (quote_id, tenants[0], branch, customer_id, users[0], "quote-key-1", "hash-1", "QT-001", now_ms + 86400000, now_ms, now_ms))
conn.execute("INSERT INTO quotation_items (id,tenant_id,quotation_id,inventory_item_id,warehouse_id,description,quantity,quantity_scale,unit_price_minor,line_total_minor,price_tier,created_at) VALUES (?,?,?,?,?,'Legacy item',1,0,1500,1500,'wholesale',?)", (quote_item_id, tenants[0], quote_id, item, warehouses[0], now_ms))
assert conn.execute("SELECT status, total_minor FROM quotations WHERE id=?", (quote_id,)).fetchone()["status"] == "issued"
assert tuple(conn.execute("SELECT price_tier, unit_price_minor FROM quotation_items WHERE id=?", (quote_item_id,)).fetchone()) == ("wholesale", 1500)
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE item_id=? AND warehouse_id=? AND batch_key=''", (item, warehouses[0])).fetchone()[0] == balance_before_quote

# Gym membership freezes extend expiry and the unique idempotency index prevents replay.
membership_id, freeze_id = uid(), uid()
start_ms, old_end_ms = now_ms - 1000, now_ms + 10 * 86400000
conn.execute("INSERT INTO customer_memberships (id,tenant_id,branch_id,customer_id,plan_name_snapshot,price_minor_snapshot,starts_at,ends_at,status,frozen_days_total,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',0,?,?,?)", (membership_id, tenants[0], branch, customer_id, "Gym 10-day", 5000, start_ms, old_end_ms, users[0], now_ms, now_ms))
new_end_ms = old_end_ms + 3 * 86400000
conn.execute("UPDATE customer_memberships SET ends_at=?,frozen_days_total=frozen_days_total+3,updated_at=? WHERE id=? AND tenant_id=? AND ends_at=?", (new_end_ms, now_ms, membership_id, tenants[0], old_end_ms))
conn.execute("INSERT INTO membership_freezes (id,tenant_id,membership_id,idempotency_key,payload_hash,days,old_ends_at,new_ends_at,reason,created_by,created_at) VALUES (?,?,?,?,?,3,?,?,?,?,?)", (freeze_id, tenants[0], membership_id, "freeze-key-1", "freeze-hash-1", old_end_ms, new_end_ms, "test pause", users[0], now_ms))
assert tuple(conn.execute("SELECT ends_at,frozen_days_total FROM customer_memberships WHERE id=?", (membership_id,)).fetchone()) == (new_end_ms, 3)
assert tuple(conn.execute("SELECT days,old_ends_at,new_ends_at FROM membership_freezes WHERE id=?", (freeze_id,)).fetchone()) == (3, old_end_ms, new_end_ms)
must_fail(lambda: conn.execute("INSERT INTO membership_freezes (id,tenant_id,membership_id,idempotency_key,payload_hash,days,old_ends_at,new_ends_at,created_at) VALUES (?,?,?,?,?,3,?,?,?)", (uid(), tenants[0], membership_id, "freeze-key-1", "different-hash", old_end_ms, new_end_ms, now_ms)), "UNIQUE constraint failed")


print("Inventory SQLite integration passed: migrations 0000–0041; atomic no-negative stock; append-only ledger; transfer conservation; supplier/payment idempotency; tenant scope; expiry/FEFO; service-material guard; offline sync and shortage alerts; prescription dispense atomicity; unique product variants and pricing tiers; quotation stock isolation; gym freeze date/idempotency invariants.")


# Customer and supplier cheques reserve balances while pending and post exactly once when cleared.
check_due = date.today().isoformat()
supplier_check_id = uid()
conn.execute("INSERT INTO supplier_cheques (id,tenant_id,supplier_id,purchase_invoice_id,cheque_number,bank_name,due_date,amount_minor,status,issued_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,2500,'pending',?,?,?)", (supplier_check_id, tenants[0], supplier, invoice, "SUP-CHK-001", "Test Bank", check_due, users[0], now_ms, now_ms))
assert conn.execute("SELECT paid_minor FROM purchase_invoices WHERE id=?", (invoice,)).fetchone()[0] == 4000
must_fail(lambda: conn.execute("INSERT INTO supplier_cheques (id,tenant_id,supplier_id,purchase_invoice_id,cheque_number,bank_name,due_date,amount_minor,status,issued_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,3600,'pending',?,?,?)", (uid(), tenants[0], supplier, invoice, "SUP-CHK-OVER", "Test Bank", check_due, users[0], now_ms, now_ms)), "SUPPLIER_CHECK_EXCEEDS_BALANCE")
must_fail(lambda: conn.execute("INSERT INTO supplier_payments (id,tenant_id,supplier_id,purchase_invoice_id,idempotency_key,amount_minor,payment_method,created_at) VALUES (?,?,?,?,?,4000,'cash',?)", (uid(), tenants[0], supplier, invoice, "payment-reserved-by-cheque", now_ms)), "SUPPLIER_PAYMENT_RESERVED_FOR_CHECK")
returned_supplier_check = uid()
conn.execute("INSERT INTO supplier_cheques (id,tenant_id,supplier_id,purchase_invoice_id,cheque_number,bank_name,due_date,amount_minor,status,issued_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1000,'pending',?,?,?)", (returned_supplier_check, tenants[0], supplier, invoice, "SUP-CHK-002", "Test Bank", check_due, users[0], now_ms, now_ms))
conn.execute("UPDATE supplier_cheques SET status='returned',status_updated_by=?,updated_at=? WHERE id=?", (users[0], now_ms, returned_supplier_check))
with conn:
    conn.execute("UPDATE supplier_cheques SET status='cashed',status_updated_by=?,cashed_at=?,updated_at=? WHERE id=? AND status='pending'", (users[0], now_ms, now_ms, supplier_check_id))
    conn.execute("INSERT INTO supplier_payments (id,tenant_id,supplier_id,purchase_invoice_id,supplier_cheque_id,idempotency_key,amount_minor,payment_method,reference,received_by,created_at) VALUES (?,?,?,?,?,?,2500,'cheque','SUP-CHK-001',?,?)", (uid(), tenants[0], supplier, invoice, supplier_check_id, f"supplier-cheque:{supplier_check_id}", users[0], now_ms))
assert conn.execute("SELECT paid_minor FROM purchase_invoices WHERE id=?", (invoice,)).fetchone()[0] == 6500
must_fail(lambda: conn.execute("UPDATE supplier_cheques SET status='returned' WHERE id=?", (supplier_check_id,)), "SUPPLIER_CHECK_INVALID_TRANSITION")
must_fail(lambda: conn.execute("INSERT INTO supplier_payments (id,tenant_id,supplier_id,purchase_invoice_id,supplier_cheque_id,idempotency_key,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,?,?,2500,'cheque','duplicate',?)", (uid(), tenants[0], supplier, invoice, supplier_check_id, f"supplier-cheque-duplicate:{supplier_check_id}", now_ms)), "UNIQUE constraint failed")

customer_check_invoice = uid()
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,10000,0,10000,2000,'EGP','mixed','partially_paid',?,?)", (customer_check_invoice, tenants[0], branch, patient_id, users[0], "customer-cheque-invoice-key", "CHK-CUST-INV-001", now_ms, now_ms))
conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,2000,'cash','initial cash',?)", (uid(), tenants[0], customer_check_invoice, users[0], now_ms))
customer_check_id = uid()
conn.execute("INSERT INTO customer_cheques (id,tenant_id,branch_id,customer_id,invoice_id,cheque_number,bank_name,due_date,amount_minor,status,received_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,5000,'pending',?,?,?)", (customer_check_id, tenants[0], branch, patient_id, customer_check_invoice, "CUST-CHK-001", "Test Bank", check_due, users[0], now_ms, now_ms))
assert conn.execute("SELECT paid_minor FROM invoices WHERE id=?", (customer_check_invoice,)).fetchone()[0] == 2000
must_fail(lambda: conn.execute("INSERT INTO customer_cheques (id,tenant_id,branch_id,customer_id,invoice_id,cheque_number,bank_name,due_date,amount_minor,status,received_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,5001,'pending',?,?,?)", (uid(), tenants[0], branch, patient_id, customer_check_invoice, "CUST-CHK-OVER", "Test Bank", check_due, users[0], now_ms, now_ms)), "CUSTOMER_CHECK_INVOICE_SCOPE_OR_BALANCE")
try:
    conn.execute("SAVEPOINT customer_check_reservation_test")
    conn.execute("UPDATE invoices SET paid_minor=8000,status='partially_paid' WHERE id=?", (customer_check_invoice,))
    conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,6000,'cash','reserved',?)", (uid(), tenants[0], customer_check_invoice, users[0], now_ms))
    raise AssertionError("ordinary customer payment consumed a pending-cheque reserve")
except sqlite3.IntegrityError as exc:
    assert "INVOICE_PAYMENT_RESERVED_FOR_CHECK" in str(exc), str(exc)
    conn.execute("ROLLBACK TO customer_check_reservation_test")
    conn.execute("RELEASE customer_check_reservation_test")
assert conn.execute("SELECT paid_minor FROM invoices WHERE id=?", (customer_check_invoice,)).fetchone()[0] == 2000
with conn:
    conn.execute("UPDATE invoices SET paid_minor=7000,status='partially_paid',payment_method='mixed',updated_at=? WHERE id=?", (now_ms, customer_check_invoice))
    conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,idempotency_key,customer_cheque_id,created_at) VALUES (?,?,?,?,5000,'cheque','CUST-CHK-001',?,?,?)", (uid(), tenants[0], customer_check_invoice, users[0], f"customer-cheque:{customer_check_id}", customer_check_id, now_ms))
    conn.execute("UPDATE customer_cheques SET status='collected',status_updated_by=?,collected_at=?,updated_at=? WHERE id=? AND status='pending'", (users[0], now_ms, now_ms, customer_check_id))
assert conn.execute("SELECT paid_minor,status FROM invoices WHERE id=?", (customer_check_invoice,)).fetchone()[:] == (7000, "partially_paid")
assert conn.execute("SELECT status FROM customer_cheques WHERE id=?", (customer_check_id,)).fetchone()[0] == "collected"
assert conn.execute("SELECT amount_minor,payment_method FROM invoice_payments WHERE customer_cheque_id=?", (customer_check_id,)).fetchone()[:] == (5000, "cheque")
must_fail(lambda: conn.execute("UPDATE customer_cheques SET status='returned' WHERE id=?", (customer_check_id,)), "CUSTOMER_CHECK_PAYMENT_NOT_REVERSED")
with conn:
    conn.execute("UPDATE invoice_payments SET reversed_at=?,reversed_by=?,reversal_reason='bank return' WHERE tenant_id=? AND customer_cheque_id=? AND reversed_at IS NULL", (now_ms, users[0], tenants[0], customer_check_id))
    conn.execute("UPDATE invoices SET paid_minor=paid_minor-5000,status='partially_paid',paid_at=NULL,updated_at=? WHERE id=? AND tenant_id=?", (now_ms, customer_check_invoice, tenants[0]))
    conn.execute("UPDATE invoices SET payment_method=(SELECT MIN(payment_method) FROM invoice_payments WHERE tenant_id=? AND invoice_id=? AND reversed_at IS NULL) WHERE id=? AND tenant_id=?", (tenants[0], customer_check_invoice, customer_check_invoice, tenants[0]))
    conn.execute("UPDATE customer_cheques SET status='returned',status_reason='bank return',status_updated_by=?,updated_at=? WHERE id=?", (users[0], now_ms, customer_check_id))
assert conn.execute("SELECT paid_minor,status,payment_method FROM invoices WHERE id=?", (customer_check_invoice,)).fetchone()[:] == (2000, "partially_paid", "cash")
assert conn.execute("SELECT status,status_reason FROM customer_cheques WHERE id=?", (customer_check_id,)).fetchone()[:] == ("returned", "bank return")
assert conn.execute("SELECT reversed_at,reversal_reason FROM invoice_payments WHERE customer_cheque_id=?", (customer_check_id,)).fetchone()[:] == (now_ms, "bank return")
assert conn.execute("SELECT COALESCE(SUM(amount_minor),0) FROM invoice_payments WHERE invoice_id=? AND reversed_at IS NULL", (customer_check_invoice,)).fetchone()[0] == 2000
must_fail(lambda: conn.execute("UPDATE invoice_payments SET reversed_at=NULL,reversal_reason=NULL WHERE customer_cheque_id=?", (customer_check_id,)), "INVOICE_PAYMENT_REVERSAL_IMMUTABLE")
must_fail(lambda: conn.execute("UPDATE customer_cheques SET status='rejected' WHERE id=?", (customer_check_id,)), "CUSTOMER_CHECK_INVALID_TRANSITION")
unlinked_check_id = uid()
conn.execute("INSERT INTO customer_cheques (id,tenant_id,branch_id,customer_id,invoice_id,cheque_number,bank_name,due_date,amount_minor,status,received_by,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?,1500,'pending',?,?,?)", (unlinked_check_id, tenants[0], branch, patient_id, "CUST-CHK-002", "Test Bank", check_due, users[0], now_ms, now_ms))
conn.execute("UPDATE customer_cheques SET status='rejected',status_updated_by=?,updated_at=? WHERE id=?", (users[0], now_ms, unlinked_check_id))
assert conn.execute("SELECT status FROM customer_cheques WHERE id=?", (unlinked_check_id,)).fetchone()[0] == "rejected"
must_fail(lambda: conn.execute("INSERT INTO customer_cheques (id,tenant_id,branch_id,customer_id,invoice_id,cheque_number,bank_name,due_date,amount_minor,status,received_by,created_at,updated_at) VALUES (?,?,?, ?,NULL,?,?,?,100,'pending',?,?,?)", (uid(), tenants[1], branch, patient_id, "CROSS-TENANT", "Test Bank", check_due, users[1], now_ms, now_ms)), "CUSTOMER_CHECK_CUSTOMER_SCOPE")
conn.commit()

print("Customer/supplier cheque integration passed: pending reservations, duplicate/over-balance rejection, tenant scope, transition rules, check collection, idempotent financial reversal after bank return, immutable reversal audit, restored invoice balance, and supplier payable update on cashing.")


# Distribution trip custody is tenant-scoped, invoice-linked, and backed by the stock ledger.
route_id, rep_id, van_warehouse_id, trip_id = uid(), uid(), uid(), uid()
conn.execute("INSERT INTO inventory_warehouses (id,tenant_id,branch_id,code,name,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,1,1)", (van_warehouse_id, tenants[0], branch, "VAN-TEST", "Test van"))
conn.execute("INSERT INTO distribution_routes (id,tenant_id,branch_id,code,name,area,is_active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)", (route_id, tenants[0], branch, "R-TEST", "Test route", "Test area", users[0], now_ms, now_ms))
conn.execute("INSERT INTO sales_reps (id,tenant_id,branch_id,route_id,van_warehouse_id,full_name,commission_bps,is_active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,500,1,?,?,?)", (rep_id, tenants[0], branch, route_id, van_warehouse_id, "Test rep", users[0], now_ms, now_ms))
conn.execute("INSERT INTO distribution_trips (id,tenant_id,branch_id,route_id,sales_rep_id,source_warehouse_id,van_warehouse_id,trip_number,status,opened_by,opened_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?)", (trip_id, tenants[0], branch, route_id, rep_id, warehouses[0], van_warehouse_id, "TR-TEST-001", users[0], now_ms, now_ms, now_ms))
load_operation = add_operation(tenants[0], f"distribution-load:{trip_id}", "transfer", "distribution_trip_load")
ensure_balance(tenants[0], item, warehouses[0]); ensure_balance(tenants[0], item, van_warehouse_id)
movement(load_operation, tenants[0], item, warehouses[0], -3, "transfer_out")
movement(load_operation, tenants[0], item, van_warehouse_id, 3, "transfer_in")
trip_line_id = uid()
conn.execute("INSERT INTO distribution_trip_lines (id,tenant_id,trip_id,item_id,batch_id,batch_key,quantity_scale,loaded_units,unit_cost_minor,created_at) VALUES (?,?,?,?,NULL,'',0,3,250,?)", (trip_line_id, tenants[0], trip_id, item, now_ms))
trip_invoice_id = uid()
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,500,0,500,300,'EGP','mixed','partially_paid',?,?)", (trip_invoice_id, tenants[0], branch, customer_id, users[0], "trip-invoice-key", "TR-POS-001", now_ms, now_ms))
conn.execute("INSERT INTO invoice_items (id,tenant_id,invoice_id,inventory_item_id,stock_warehouse_id,quantity_scale,description,quantity,unit_price_minor,line_total_minor,commission_bps,created_at) VALUES (?,?,?,?,?,0,'Gauze',1,500,500,0,?)", (uid(), tenants[0], trip_invoice_id, item, van_warehouse_id, now_ms))
trip_sale_operation = add_operation(tenants[0], f"pos-invoice:{trip_invoice_id}", "point_of_sale", "invoice")
conn.execute("UPDATE stock_operations SET reference_id=? WHERE id=?", (trip_invoice_id, trip_sale_operation))
movement(trip_sale_operation, tenants[0], item, van_warehouse_id, -1, "pos_deduction")
conn.execute("INSERT INTO distribution_trip_invoices (id,tenant_id,trip_id,invoice_id,created_at) VALUES (?,?,?,?,?)", (uid(), tenants[0], trip_id, trip_invoice_id, now_ms))
conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,300,'cash','trip cash',?)", (uid(), tenants[0], trip_invoice_id, users[0], now_ms))
conn.execute("INSERT INTO invoice_payments (id,tenant_id,invoice_id,received_by,amount_minor,payment_method,reference,created_at) VALUES (?,?,?,?,200,'card','trip credit/card',?)", (uid(), tenants[0], trip_invoice_id, users[0], now_ms))
assert conn.execute("SELECT quantity_on_hand FROM inventory_balances WHERE tenant_id=? AND item_id=? AND warehouse_id=? AND batch_key=''", (tenants[0], item, van_warehouse_id)).fetchone()[0] == 2
assert conn.execute("SELECT SUM(amount_minor) FROM invoice_payments WHERE invoice_id=? AND payment_method='cash' AND reversed_at IS NULL", (trip_invoice_id,)).fetchone()[0] == 300
conn.execute("UPDATE distribution_trip_lines SET returned_good_units=1,missing_units=1 WHERE id=?", (trip_line_id,))
assert conn.execute("SELECT loaded_units,returned_good_units,returned_damaged_units,missing_units FROM distribution_trip_lines WHERE id=?", (trip_line_id,)).fetchone()[:] == (3, 1, 0, 1)

# A trip invoice must be open, from the same branch, and contain stock from the assigned van.
wrong_stock_invoice = uid()
conn.execute("INSERT INTO invoices (id,tenant_id,branch_id,customer_id,issued_by,idempotency_key,invoice_number,subtotal_minor,discount_minor,total_minor,paid_minor,currency,payment_method,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,500,0,500,0,'EGP','unpaid','issued',?,?)", (wrong_stock_invoice, tenants[0], branch, customer_id, users[0], "wrong-van-key", "TR-POS-WRONG", now_ms, now_ms))
conn.execute("INSERT INTO invoice_items (id,tenant_id,invoice_id,inventory_item_id,stock_warehouse_id,quantity_scale,description,quantity,unit_price_minor,line_total_minor,commission_bps,created_at) VALUES (?,?,?,?,?,0,'Wrong warehouse',1,500,500,0,?)", (uid(), tenants[0], wrong_stock_invoice, item, warehouses[0], now_ms))
must_fail(lambda: conn.execute("INSERT INTO distribution_trip_invoices (id,tenant_id,trip_id,invoice_id,created_at) VALUES (?,?,?,?,?)", (uid(), tenants[0], trip_id, wrong_stock_invoice, now_ms)), "DISTRIBUTION_TRIP_NOT_OPEN_OR_ITEMS_MISMATCH")

# Treasury entries are append-only and the database trigger refuses an overdraft.
account_id = uid()
conn.execute("INSERT INTO treasury_accounts (id,tenant_id,branch_id,account_type,name,currency,opening_balance_minor,is_active,created_by,created_at,updated_at) VALUES (?,?,?,'cash','Test cash box','EGP',1000,1,?,?,?)", (account_id, tenants[0], branch, users[0], now_ms, now_ms))
receipt_id = uid()
conn.execute("INSERT INTO treasury_transactions (id,tenant_id,account_id,branch_id,direction,category,is_operating_expense,amount_minor,currency,description,idempotency_key,created_by,created_at) VALUES (?,?,?,?, 'in','other_receipt',0,500,'EGP','test receipt','treasury-receipt-1',?,?)", (receipt_id, tenants[0], account_id, branch, users[0], now_ms))
expense_id = uid()
conn.execute("INSERT INTO treasury_transactions (id,tenant_id,account_id,branch_id,route_id,sales_rep_id,direction,category,is_operating_expense,amount_minor,currency,description,idempotency_key,created_by,created_at) VALUES (?,?,?,?,?,?,'out','fuel',1,1300,'EGP','test fuel','treasury-expense-1',?,?)", (expense_id, tenants[0], account_id, branch, route_id, rep_id, users[0], now_ms))
assert conn.execute("SELECT opening_balance_minor + COALESCE(SUM(CASE WHEN direction='in' THEN amount_minor ELSE -amount_minor END),0) FROM treasury_accounts a LEFT JOIN treasury_transactions t ON t.account_id=a.id WHERE a.id=?", (account_id,)).fetchone()[0] == 200
must_fail(lambda: conn.execute("INSERT INTO treasury_transactions (id,tenant_id,account_id,branch_id,direction,category,is_operating_expense,amount_minor,currency,description,idempotency_key,created_by,created_at) VALUES (?,?,?,?,'out','other',0,201,'EGP','overdraft','treasury-overdraw-1',?,?)", (uid(), tenants[0], account_id, branch, users[0], now_ms)), "TREASURY_INSUFFICIENT_FUNDS")
must_fail(lambda: conn.execute("UPDATE treasury_transactions SET description='tampered' WHERE id=?", (expense_id,)), "TREASURY_LEDGER_IMMUTABLE")
must_fail(lambda: conn.execute("DELETE FROM treasury_transactions WHERE id=?", (receipt_id,)), "TREASURY_LEDGER_IMMUTABLE")
conn.commit()
print("Distribution/treasury SQLite integration passed: transfer custody and trip invoice guard; cash/credit collection split; immutable treasury ledger; overdraft prevention; operating expenses by route/rep.")
