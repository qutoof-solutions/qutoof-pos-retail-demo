export type LocalizedBranchName = {
  id?: string | null;
  name?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  branchName?: string | null;
  branchNameAr?: string | null;
  branchNameEn?: string | null;
};

export function localizedBranchName(branch: LocalizedBranchName, locale: string): string {
  const arabic = branch.nameAr ?? branch.branchNameAr;
  const english = branch.nameEn ?? branch.branchNameEn;
  const preferred = locale === "en" ? english : arabic;
  if (preferred?.trim()) return preferred.trim();
  const legacy = branch.name ?? branch.branchName;
  return legacy?.trim() ?? "";
}
