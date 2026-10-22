export type PlanArchiveView = "active" | "archived";

export function filterPlansForArchiveView<T extends { isActive: boolean }>(plans: readonly T[], view: PlanArchiveView): T[] {
  return plans.filter((plan) => view === "active" ? plan.isActive : !plan.isActive);
}
