import assert from "node:assert/strict";
import test from "node:test";
import { addResourceAddonMarker, classifyCatalogFeatures, classifyCatalogFeaturesJson, isOfficialWhatsAppPlan, parseCatalogFeatures, stripResourceAddonMarkers, validateBasePlanSelection, withCatalogFeatureDefaults } from "../lib/platform/catalog";

test("resource add-on markers classify one resource and stay separate from plan entitlements", () => {
  const features = addResourceAddonMarker({ pos: true, inventory: true }, "warehouse");
  assert.deepEqual(classifyCatalogFeatures(features), { kind: "addon", resourceType: "warehouse" });
  assert.deepEqual(stripResourceAddonMarkers(features), { pos: true, inventory: true });
  assert.deepEqual(classifyCatalogFeatures(addResourceAddonMarker({ branches: true }, "branch")), { kind: "addon", resourceType: "branch" });
  assert.deepEqual(classifyCatalogFeatures(addResourceAddonMarker({}, "user")), { kind: "addon", resourceType: "user" });
  assert.deepEqual(classifyCatalogFeatures(addResourceAddonMarker({}, "doctor")), { kind: "addon", resourceType: "doctor" });
});

test("catalog rows without markers remain plans and malformed marker combinations are not sellable", () => {
  assert.deepEqual(classifyCatalogFeatures({ pos: true }), { kind: "plan" });
  assert.deepEqual(classifyCatalogFeatures({ catalog_addon_warehouse: true, catalog_addon_branch: true }), { kind: "invalid_addon" });
  assert.deepEqual(classifyCatalogFeatures({ catalog_addon_warehouse: false }), { kind: "invalid_addon" });
  assert.deepEqual(classifyCatalogFeaturesJson('{"catalog_addon_doctor":true}'), { kind: "addon", resourceType: "doctor" });
  assert.deepEqual(parseCatalogFeatures("invalid-json"), {});
});

test("base-plan assignment accepts a base row but rejects seeded add-ons and missing rows", () => {
  const base = { id: "base-plan-uuid", nameAr: "باقة أساسية", featuresJson: '{"pos":true}' };
  const addon = { id: "resource-addon-warehouse-monthly", nameAr: "مخزن إضافي", featuresJson: '{"catalog_addon_warehouse":true}' };
  assert.deepEqual(validateBasePlanSelection(base), { ok: true, plan: base });
  assert.deepEqual(validateBasePlanSelection(addon), { ok: false, reason: "addon" });
  assert.deepEqual(validateBasePlanSelection(undefined), { ok: false, reason: "missing" });
});

test("medical center and hospital plans include POS and Meta WhatsApp starts at Pro/Center", () => {
  assert.equal(withCatalogFeatureDefaults("clinic_center_monthly", { emr: true }).pos, true);
  assert.equal(withCatalogFeatureDefaults("clinic_hospital_monthly", { emr: true }).pos, true);
  assert.equal(isOfficialWhatsAppPlan("erp_starter_monthly"), false);
  assert.equal(isOfficialWhatsAppPlan("erp_pro_monthly"), true);
  assert.equal(isOfficialWhatsAppPlan("clinic_center_monthly"), true);
});
