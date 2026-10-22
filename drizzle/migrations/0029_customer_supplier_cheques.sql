CREATE TABLE `customer_cheques` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`invoice_id` text,
	`cheque_number` text NOT NULL,
	`bank_name` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`status_reason` text,
	`notes` text,
	`received_by` text NOT NULL,
	`status_updated_by` text,
	`collected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`status_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "customer_cheques_amount_positive" CHECK("customer_cheques"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_cheques_tenant_bank_number_uq` ON `customer_cheques` (`tenant_id`,`bank_name`,`cheque_number`);--> statement-breakpoint
CREATE INDEX `customer_cheques_tenant_status_due_idx` ON `customer_cheques` (`tenant_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `customer_cheques_customer_idx` ON `customer_cheques` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_cheques_invoice_idx` ON `customer_cheques` (`tenant_id`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `supplier_cheques` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`purchase_invoice_id` text NOT NULL,
	`cheque_number` text NOT NULL,
	`bank_name` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`issued_by` text NOT NULL,
	`status_updated_by` text,
	`cashed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`status_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "supplier_cheques_amount_positive" CHECK("supplier_cheques"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_cheques_tenant_bank_number_uq` ON `supplier_cheques` (`tenant_id`,`bank_name`,`cheque_number`);--> statement-breakpoint
CREATE INDEX `supplier_cheques_tenant_status_due_idx` ON `supplier_cheques` (`tenant_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `supplier_cheques_supplier_idx` ON `supplier_cheques` (`tenant_id`,`supplier_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `supplier_cheques_invoice_idx` ON `supplier_cheques` (`tenant_id`,`purchase_invoice_id`);--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `customer_cheque_id` text REFERENCES customer_cheques(id);--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversed_at` integer;--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversed_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversal_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payments_customer_cheque_uq` ON `invoice_payments` (`tenant_id`,`customer_cheque_id`) WHERE "invoice_payments"."customer_cheque_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD `supplier_cheque_id` text REFERENCES supplier_cheques(id);--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_payments_cheque_uq` ON `supplier_payments` (`tenant_id`,`supplier_cheque_id`) WHERE "supplier_payments"."supplier_cheque_id" IS NOT NULL;CREATE TRIGGER `customer_cheque_validate_insert`
BEFORE INSERT ON `customer_cheques`
BEGIN
  SELECT CASE WHEN NEW.amount_minor <= 0 THEN RAISE(ABORT, 'CUSTOMER_CHECK_INVALID_AMOUNT') END;
  SELECT CASE WHEN NEW.status <> 'pending' THEN RAISE(ABORT, 'CUSTOMER_CHECK_MUST_START_PENDING') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'CUSTOMER_CHECK_CUSTOMER_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id AND b.is_active = 1) THEN RAISE(ABORT, 'CUSTOMER_CHECK_BRANCH_SCOPE') END;
  SELECT CASE WHEN NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = NEW.invoice_id AND i.tenant_id = NEW.tenant_id AND i.customer_id = NEW.customer_id AND i.branch_id = NEW.branch_id
      AND i.status IN ('issued', 'partially_paid')
      AND NEW.amount_minor <= i.total_minor - i.paid_minor - COALESCE((SELECT SUM(c.amount_minor) FROM customer_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id AND c.status = 'pending'), 0)
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_INVOICE_SCOPE_OR_BALANCE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `customer_cheque_status_transition`
BEFORE UPDATE OF `status` ON `customer_cheques`
WHEN NEW.status <> OLD.status
BEGIN
  SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('collected', 'returned', 'rejected') THEN RAISE(ABORT, 'CUSTOMER_CHECK_INVALID_TRANSITION') END;
  SELECT CASE WHEN NEW.status = 'collected' AND NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoice_payments p
    WHERE p.tenant_id = NEW.tenant_id AND p.invoice_id = NEW.invoice_id AND p.customer_cheque_id = NEW.id
      AND p.amount_minor = NEW.amount_minor AND p.payment_method = 'cheque'
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_PAYMENT_MISSING') END;
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_cheque_validate_insert`
BEFORE INSERT ON `supplier_cheques`
BEGIN
  SELECT CASE WHEN NEW.amount_minor <= 0 THEN RAISE(ABORT, 'SUPPLIER_CHECK_INVALID_AMOUNT') END;
  SELECT CASE WHEN NEW.status <> 'pending' THEN RAISE(ABORT, 'SUPPLIER_CHECK_MUST_START_PENDING') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = NEW.supplier_id AND s.tenant_id = NEW.tenant_id) THEN RAISE(ABORT, 'SUPPLIER_CHECK_SUPPLIER_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_invoices p
    WHERE p.id = NEW.purchase_invoice_id AND p.tenant_id = NEW.tenant_id AND p.supplier_id = NEW.supplier_id AND p.status = 'received'
      AND NEW.amount_minor <= p.total_minor - p.paid_minor - COALESCE((SELECT SUM(c.amount_minor) FROM supplier_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.purchase_invoice_id = NEW.purchase_invoice_id AND c.status = 'pending'), 0)
  ) THEN RAISE(ABORT, 'SUPPLIER_CHECK_EXCEEDS_BALANCE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_cheque_status_transition`
BEFORE UPDATE OF `status` ON `supplier_cheques`
WHEN NEW.status <> OLD.status
BEGIN
  SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('cashed', 'returned', 'rejected') THEN RAISE(ABORT, 'SUPPLIER_CHECK_INVALID_TRANSITION') END;
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payment_check_validate_insert`
BEFORE INSERT ON `supplier_payments`
WHEN NEW.supplier_cheque_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM supplier_cheques c
    WHERE c.id = NEW.supplier_cheque_id AND c.tenant_id = NEW.tenant_id AND c.supplier_id = NEW.supplier_id
      AND c.purchase_invoice_id = NEW.purchase_invoice_id AND c.amount_minor = NEW.amount_minor AND c.status = 'cashed'
      AND NEW.payment_method = 'cheque'
  ) THEN RAISE(ABORT, 'SUPPLIER_CHECK_PAYMENT_SCOPE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `supplier_payment_reserve_pending_checks`
BEFORE INSERT ON `supplier_payments`
WHEN NEW.supplier_cheque_id IS NULL AND EXISTS (SELECT 1 FROM supplier_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.purchase_invoice_id = NEW.purchase_invoice_id AND c.status = 'pending')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_invoices p
    WHERE p.id = NEW.purchase_invoice_id AND p.tenant_id = NEW.tenant_id AND p.supplier_id = NEW.supplier_id AND p.status = 'received'
      AND NEW.amount_minor <= p.total_minor - p.paid_minor - COALESCE((SELECT SUM(c.amount_minor) FROM supplier_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.purchase_invoice_id = NEW.purchase_invoice_id AND c.status = 'pending'), 0)
  ) THEN RAISE(ABORT, 'SUPPLIER_PAYMENT_RESERVED_FOR_CHECK') END;
END;

--> statement-breakpoint
CREATE TRIGGER `invoice_payment_customer_cheque_validate_insert`
BEFORE INSERT ON `invoice_payments`
WHEN NEW.customer_cheque_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customer_cheques c
    WHERE c.id = NEW.customer_cheque_id AND c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id
      AND c.amount_minor = NEW.amount_minor AND c.status = 'pending' AND NEW.payment_method = 'cheque'
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_PAYMENT_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = NEW.invoice_id AND i.tenant_id = NEW.tenant_id
      AND i.paid_minor <= i.total_minor - COALESCE((SELECT SUM(c.amount_minor) FROM customer_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id AND c.status = 'pending' AND c.id <> NEW.customer_cheque_id), 0)
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_EXCEEDS_INVOICE_BALANCE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_payment_reserve_pending_customer_checks`
BEFORE INSERT ON `invoice_payments`
WHEN NEW.customer_cheque_id IS NULL AND EXISTS (SELECT 1 FROM customer_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id AND c.status = 'pending')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = NEW.invoice_id AND i.tenant_id = NEW.tenant_id
      AND i.paid_minor <= i.total_minor - COALESCE((SELECT SUM(c.amount_minor) FROM customer_cheques c WHERE c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id AND c.status = 'pending'), 0)
  ) THEN RAISE(ABORT, 'INVOICE_PAYMENT_RESERVED_FOR_CHECK') END;
END;
--> statement-breakpoint
DROP TRIGGER `customer_cheque_status_transition`;
--> statement-breakpoint
CREATE TRIGGER `customer_cheque_status_transition`
BEFORE UPDATE OF `status` ON `customer_cheques`
WHEN NEW.status <> OLD.status
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status = 'pending' AND NEW.status IN ('collected', 'returned', 'rejected'))
    OR (OLD.status = 'collected' AND NEW.status IN ('returned', 'rejected'))
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_INVALID_TRANSITION') END;
  SELECT CASE WHEN NEW.status = 'collected' AND NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoice_payments p
    WHERE p.tenant_id = NEW.tenant_id AND p.invoice_id = NEW.invoice_id AND p.customer_cheque_id = NEW.id
      AND p.amount_minor = NEW.amount_minor AND p.payment_method = 'cheque' AND p.reversed_at IS NULL
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_PAYMENT_MISSING') END;
  SELECT CASE WHEN OLD.status = 'collected' AND NEW.status IN ('returned', 'rejected') AND NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoice_payments p
    WHERE p.tenant_id = NEW.tenant_id AND p.invoice_id = NEW.invoice_id AND p.customer_cheque_id = NEW.id
      AND p.amount_minor = NEW.amount_minor AND p.reversed_at IS NOT NULL
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_PAYMENT_NOT_REVERSED') END;
END;
--> statement-breakpoint
CREATE TRIGGER `invoice_payment_customer_cheque_reverse_validate`
BEFORE UPDATE OF `reversed_at` ON `invoice_payments`
WHEN OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.customer_cheque_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM customer_cheques c
    WHERE c.id = NEW.customer_cheque_id AND c.tenant_id = NEW.tenant_id AND c.invoice_id = NEW.invoice_id
      AND c.amount_minor = NEW.amount_minor AND c.status = 'collected'
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_REVERSAL_SCOPE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = NEW.invoice_id AND i.tenant_id = NEW.tenant_id AND i.paid_minor >= NEW.amount_minor
  ) THEN RAISE(ABORT, 'CUSTOMER_CHECK_REVERSAL_BALANCE') END;
END;

--> statement-breakpoint
CREATE TRIGGER `invoice_payment_reversal_immutable`
BEFORE UPDATE OF `reversed_at`, `reversed_by`, `reversal_reason` ON `invoice_payments`
WHEN OLD.reversed_at IS NOT NULL AND (
  NEW.reversed_at IS NOT OLD.reversed_at OR NEW.reversed_by IS NOT OLD.reversed_by OR NEW.reversal_reason IS NOT OLD.reversal_reason
)
BEGIN
  SELECT RAISE(ABORT, 'INVOICE_PAYMENT_REVERSAL_IMMUTABLE');
END;
