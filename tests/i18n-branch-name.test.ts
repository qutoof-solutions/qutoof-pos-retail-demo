import test from "node:test";
import assert from "node:assert/strict";
import { localizedBranchName } from "../lib/i18n/branch-name";

test("localizedBranchName selects the explicit business name for the active locale", () => {
  const branch = { name: "الفرع الرئيسي", nameAr: "الفرع الرئيسي", nameEn: "Main branch" };
  assert.equal(localizedBranchName(branch, "ar"), "الفرع الرئيسي");
  assert.equal(localizedBranchName(branch, "en"), "Main branch");
});

test("localizedBranchName preserves compatibility with legacy API objects", () => {
  assert.equal(localizedBranchName({ name: "Old branch" }, "en"), "Old branch");
  assert.equal(localizedBranchName({ name: "فرع قديم" }, "ar"), "فرع قديم");
});
