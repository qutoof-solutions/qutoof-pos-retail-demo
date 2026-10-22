from __future__ import annotations

from pathlib import Path
import sqlite3
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "drizzle" / "migrations"
RECOVERY = MIGRATIONS / "0021_reconcile_production_schema_drift.sql"


def fail(message: str) -> None:
    raise AssertionError(message)


def apply_sql(db: sqlite3.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8").replace("--> statement-breakpoint", ";")
    try:
        db.executescript(sql)
    except sqlite3.Error as error:
        fail(f"{path.name} failed in drift fixture: {error}")
    db.execute("PRAGMA foreign_keys = ON")


def expect_trigger_abort(db: sqlite3.Connection, sql: str, params: tuple, expected: str) -> None:
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError as error:
        if expected not in str(error):
            fail(f"Expected trigger error {expected!r}, got {str(error)!r}")
    except sqlite3.Error as error:
        fail(f"Expected trigger error {expected!r}, got SQLite error {str(error)!r}")
    else:
        fail(f"Invalid service_materials write was accepted; expected {expected}")


def run_drift_recovery_fixture() -> None:
    if not RECOVERY.is_file():
        fail("Corrective migration 0021 is missing")

    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    # Build the repository baseline through 0018. The production ledger will then
    # claim 0019/0020 ran, while the physical schema is intentionally left stale.
    baseline = sorted(path for path in MIGRATIONS.glob("*.sql") if path.name < "0019_service_material_guards.sql")
    if not baseline or baseline[-1].name != "0018_familiar_mastermind.sql":
        fail("Expected migration baseline through 0018")
    for path in baseline:
        apply_sql(db, path)

    now = int(time.time())
    tenant_a, tenant_b = str(uuid.uuid4()), str(uuid.uuid4())
    branch_a, branch_b, branch_other = (str(uuid.uuid4()) for _ in range(3))
    owner_id, reception_id, provider_id, unassigned_provider_id, storekeeper_id = (str(uuid.uuid4()) for _ in range(5))

    for tenant_id, name in ((tenant_a, "Synthetic Drift Tenant A"), (tenant_b, "Synthetic Drift Tenant B")):
        db.execute(
            "INSERT INTO tenants (id, name, slug, vertical, status, timezone, settings_json, created_at, updated_at) VALUES (?, ?, ?, 'medical', 'active', 'UTC', '{}', ?, ?)",
            (tenant_id, name, f"drift-{tenant_id[:8]}", now, now),
        )
    for branch_id, tenant_id, name in (
        (branch_a, tenant_a, "Synthetic Branch A"),
        (branch_b, tenant_a, "Synthetic Branch B"),
        (branch_other, tenant_b, "Synthetic Other-Tenant Branch"),
    ):
        db.execute(
            "INSERT INTO branches (id, tenant_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
            (branch_id, tenant_id, name, now, now),
        )

    for user_id, role, tenant_id in (
        (owner_id, "business_admin", tenant_a),
        (reception_id, "reception", tenant_a),
        (provider_id, "provider", tenant_a),
        (unassigned_provider_id, "provider", tenant_a),
        (storekeeper_id, "storekeeper", tenant_a),
    ):
        db.execute(
            "INSERT INTO users (id, tenant_id, email, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, 'synthetic-test-hash', ?, ?, 1, ?, ?)",
            (user_id, tenant_a, f"{role}-{user_id[:8]}@example.invalid", role, role, now, now),
        )
    db.execute(
        "INSERT INTO schedules (id, tenant_id, branch_id, provider_id, weekday, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, '08:00', '17:00', ?, ?)",
        (str(uuid.uuid4()), tenant_a, branch_a, provider_id, now, now),
    )

    # Reproduce the observed older trigger bodies and absent 0020 table.
    db.executescript("""
        DROP TRIGGER IF EXISTS service_material_validate_insert;
        DROP TRIGGER IF EXISTS service_material_validate_update;
        DROP TRIGGER IF EXISTS service_materials_require_warehouse_insert;
        DROP TRIGGER IF EXISTS service_materials_require_warehouse_update;
        CREATE TRIGGER service_material_validate_insert BEFORE INSERT ON service_materials
        WHEN NEW.warehouse_id IS NULL BEGIN SELECT RAISE(ABORT, 'warehouse_id cannot be null'); END;
        CREATE TRIGGER service_material_validate_update BEFORE UPDATE ON service_materials
        WHEN NEW.warehouse_id IS NULL BEGIN SELECT RAISE(ABORT, 'warehouse_id cannot be null'); END;
        CREATE TRIGGER service_materials_require_warehouse_insert BEFORE INSERT ON service_materials
        WHEN NEW.warehouse_id IS NULL BEGIN SELECT RAISE(ABORT, 'warehouse_id required'); END;
        CREATE TRIGGER service_materials_require_warehouse_update BEFORE UPDATE OF warehouse_id ON service_materials
        WHEN NEW.warehouse_id IS NULL BEGIN SELECT RAISE(ABORT, 'warehouse_id required'); END;
    """)
    objects_before = {row["name"] for row in db.execute("SELECT name FROM sqlite_schema")}
    if "branch_memberships" in objects_before:
        fail("Drift fixture unexpectedly contains branch_memberships before repair")
    old_trigger = db.execute("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='service_material_validate_insert'").fetchone()
    if not old_trigger or "warehouse_id cannot be null" not in old_trigger["sql"]:
        fail("Drift fixture did not recreate the observed legacy trigger")

    # The ledger claims migrations 0019 and 0020 succeeded, just like production.
    db.execute("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    db.executemany(
        "INSERT INTO d1_migrations (id, name, applied_at) VALUES (?, ?, ?)",
        ((20, "0019_service_material_guards.sql", "2026-10-13 09:02:25"), (21, "0020_branch_memberships.sql", "2026-10-13 09:03:12")),
    )

    apply_sql(db, RECOVERY)

    expected_objects = {
        "branch_memberships",
        "branch_memberships_user_branch_uq",
        "branch_memberships_user_idx",
        "branch_memberships_branch_idx",
    }
    actual_objects = {row["name"] for row in db.execute("SELECT name FROM sqlite_schema")}
    missing = expected_objects - actual_objects
    if missing:
        fail(f"Recovery failed to create expected membership objects: {sorted(missing)}")

    expected_memberships = {
        (owner_id, branch_a),
        (owner_id, branch_b),
        (provider_id, branch_a),
    }
    rows = db.execute("SELECT user_id, branch_id FROM branch_memberships WHERE tenant_id = ?", (tenant_a,)).fetchall()
    actual_memberships = {(row["user_id"], row["branch_id"]) for row in rows}
    if actual_memberships != expected_memberships:
        fail(f"Backfill did not preserve least privilege: {actual_memberships}")
    if any(row["user_id"] in {reception_id, unassigned_provider_id, storekeeper_id} for row in rows):
        fail("Backfill assigned a reception, unassigned provider, or storekeeper without explicit assignment")

    trigger_rows = db.execute(
        "SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND name IN (?, ?, ?, ?)",
        (
            "service_material_validate_insert",
            "service_material_validate_update",
            "service_materials_require_warehouse_insert",
            "service_materials_require_warehouse_update",
        ),
    ).fetchall()
    trigger_sql = {row["name"]: row["sql"] for row in trigger_rows}
    if set(trigger_sql) != {
        "service_material_validate_insert",
        "service_material_validate_update",
        "service_materials_require_warehouse_insert",
        "service_materials_require_warehouse_update",
    }:
        fail("Recovery did not recreate all four service-material triggers")
    for name in ("service_material_validate_insert", "service_material_validate_update"):
        for rule in ("SERVICE_MATERIAL_INVALID_QUANTITY", "SERVICE_MATERIAL_SERVICE_SCOPE", "SERVICE_MATERIAL_ITEM_SCOPE", "SERVICE_MATERIAL_WAREHOUSE_SCOPE", "SERVICE_MATERIAL_BRANCH_SCOPE"):
            if rule not in trigger_sql[name]:
                fail(f"Trigger {name} is missing rule {rule}")
    if "warehouse_id cannot be null" in " ".join(trigger_sql.values()):
        fail("The stale production trigger body remains after recovery")

    reference_db = sqlite3.connect(":memory:")
    reference_db.row_factory = sqlite3.Row
    reference_db.execute("PRAGMA foreign_keys = ON")
    for path in baseline:
        apply_sql(reference_db, path)
    apply_sql(reference_db, MIGRATIONS / "0019_service_material_guards.sql")
    expected_trigger_sql = {
        row["name"]: row["sql"]
        for row in reference_db.execute("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND name IN (?, ?, ?, ?)", tuple(trigger_sql))
    }
    if trigger_sql != expected_trigger_sql:
        fail("Corrective trigger SQL differs from the canonical 0019 migration")
    reference_db.close()

    # Exercise the recreated trigger behavior with synthetic references.
    service_a, service_other = str(uuid.uuid4()), str(uuid.uuid4())
    item_good, item_wrong_tenant, item_inactive, item_branch_test = (str(uuid.uuid4()) for _ in range(4))
    item_service_test, item_warehouse_test = str(uuid.uuid4()), str(uuid.uuid4())
    warehouse_a, warehouse_b, warehouse_other, warehouse_inactive = (str(uuid.uuid4()) for _ in range(4))
    for service_id, tenant_id, branch_id, name in (
        (service_a, tenant_a, branch_a, "Synthetic Service A"),
        (service_other, tenant_b, branch_other, "Synthetic Other-Tenant Service"),
    ):
        db.execute(
            "INSERT INTO services (id, tenant_id, branch_id, name, kind, price_minor, duration_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, 'single', 1000, 30, ?, ?)",
            (service_id, tenant_id, branch_id, name, now, now),
        )
    items = (
        (item_good, tenant_a, "GOOD", 1),
        (item_wrong_tenant, tenant_b, "OTHER", 1),
        (item_inactive, tenant_a, "INACTIVE", 0),
        (item_branch_test, tenant_a, "BRANCH", 1),
        (item_service_test, tenant_a, "SERVICE", 1),
        (item_warehouse_test, tenant_a, "WAREHOUSE", 1),
    )
    for item_id, tenant_id, sku, active in items:
        db.execute(
            "INSERT INTO inventory_items (id, tenant_id, sku, name, category, unit_code, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'test', 'unit', ?, ?, ?)",
            (item_id, tenant_id, sku, f"Synthetic {sku}", active, now, now),
        )
    warehouses = (
        (warehouse_a, tenant_a, branch_a, "A", 1),
        (warehouse_b, tenant_a, branch_b, "B", 1),
        (warehouse_other, tenant_b, branch_other, "OTHER", 1),
        (warehouse_inactive, tenant_a, branch_a, "INACTIVE", 0),
    )
    for warehouse_id, tenant_id, branch_id, code, active in warehouses:
        db.execute(
            "INSERT INTO inventory_warehouses (id, tenant_id, branch_id, code, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (warehouse_id, tenant_id, branch_id, code, f"Synthetic {code}", active, now, now),
        )

    def insert_material(item_id: str, warehouse_id: str, service_id: str = service_a, tenant_id: str = tenant_a, quantity: int = 1) -> tuple[str, tuple]:
        material_id = str(uuid.uuid4())
        sql = "INSERT INTO service_materials (id, tenant_id, service_id, item_id, warehouse_id, quantity_per_service, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
        return sql, (material_id, tenant_id, service_id, item_id, warehouse_id, quantity, now, now)

    sql, params = insert_material(item_service_test, warehouse_a, service_id=service_other)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_SERVICE_SCOPE")
    sql, params = insert_material(item_wrong_tenant, warehouse_a)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_ITEM_SCOPE")
    sql, params = insert_material(item_inactive, warehouse_a)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_ITEM_SCOPE")
    sql, params = insert_material(item_warehouse_test, warehouse_other)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_WAREHOUSE_SCOPE")
    sql, params = insert_material(item_warehouse_test, warehouse_inactive)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_WAREHOUSE_SCOPE")
    sql, params = insert_material(item_branch_test, warehouse_b)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_BRANCH_SCOPE")
    sql, params = insert_material(item_good, warehouse_a, quantity=0)
    expect_trigger_abort(db, sql, params, "SERVICE_MATERIAL_INVALID_QUANTITY")

    sql, params = insert_material(item_good, warehouse_a)
    db.execute(sql, params)
    material_id = params[0]
    try:
        db.execute("UPDATE service_materials SET quantity_per_service = 0 WHERE id = ?", (material_id,))
    except sqlite3.IntegrityError as error:
        if "SERVICE_MATERIAL_INVALID_QUANTITY" not in str(error):
            fail(f"Unexpected update-trigger error: {error}")
    else:
        fail("Invalid service-material update was accepted")

    # The SQL itself is safe to re-run against the observed missing-table state.
    # Wrangler will run a recorded migration once; this second local run checks idempotence.
    apply_sql(db, RECOVERY)
    replay_rows = db.execute("SELECT user_id, branch_id FROM branch_memberships WHERE tenant_id = ?", (tenant_a,)).fetchall()
    if {(row["user_id"], row["branch_id"]) for row in replay_rows} != expected_memberships:
        fail("Running the corrective SQL twice duplicated or changed memberships")
    if db.execute("SELECT COUNT(*) FROM d1_migrations WHERE name IN ('0019_service_material_guards.sql','0020_branch_memberships.sql')").fetchone()[0] != 2:
        fail("Corrective SQL should not edit the pre-existing D1 migration ledger")
    if db.execute("SELECT COUNT(*) FROM d1_migrations WHERE name LIKE '0021%'").fetchone()[0] != 0:
        fail("Corrective SQL must not write its own migration marker; Wrangler records it after success")

    integrity = db.execute("PRAGMA foreign_key_check").fetchall()
    if integrity:
        fail(f"Foreign key check failed after drift recovery: {integrity}")
    print("SQLite drift-recovery fixture passed: 0019/0020 ledger rows with stale triggers and missing membership schema were repaired; indexes, least-privilege backfill, trigger constraints, SQL idempotence, and untouched migration ledger verified.")
    db.close()


if __name__ == "__main__":
    run_drift_recovery_fixture()
