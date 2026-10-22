ALTER TABLE `clinical_prescriptions` ADD `patient_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `invoice_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_public_profiles` ADD `invoice_notes` text DEFAULT '' NOT NULL;