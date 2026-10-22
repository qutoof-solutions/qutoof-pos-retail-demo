import assert from "node:assert/strict";
import test from "node:test";
import type { getDb } from "../lib/db/client";
import { appointments, scheduleExceptions, schedules, staffShifts } from "../lib/db/schema";
import { getPublicAvailableSlots, PUBLIC_PROVIDER_ROLES } from "../lib/operations/public-availability";

type QueryValue = readonly unknown[];
class FakeQuery {
  constructor(private readonly value: QueryValue) {}
  from() { return this; }
  innerJoin() { return this; }
  where() { return this; }
  orderBy() { return Promise.resolve(this.value); }
  then<TResult1 = QueryValue, TResult2 = never>(onFulfilled?: ((value: QueryValue) => TResult1 | PromiseLike<TResult1>) | null, onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.value).then(onFulfilled, onRejected);
  }
}

function localDb(options: { providers: QueryValue; appointments?: QueryValue }) {
  const rows = new Map<unknown, QueryValue>([
    [schedules, [{ providerId: "doctor-1", branchId: "branch-main", weekday: 1, startsAt: "09:00", endsAt: "17:00", breaksJson: "[]", effectiveFrom: null, effectiveTo: null }]],
    [scheduleExceptions, []],
    [staffShifts, []],
    [appointments, options.appointments ?? []],
  ]);
  return {
    selectDistinct: () => new FakeQuery(options.providers),
    select: () => ({ from: (table: unknown) => new FakeQuery(rows.get(table) ?? []) }),
  } as unknown as ReturnType<typeof getDb>;
}

const baseInput = {
  tenantId: "tenant-1",
  timezone: "UTC",
  date: "2099-01-05",
  branchId: "branch-main",
  durationMinutes: 30,
};

test("public availability accepts provider, doctor, and specialist only when branch membership makes them eligible", async () => {
  assert.deepEqual(PUBLIC_PROVIDER_ROLES, ["provider", "doctor", "specialist"]);
  const db = localDb({
    providers: [
      { id: "doctor-1", fullName: "Doctor One" },
      { id: "specialist-1", fullName: "Specialist One" },
    ],
  });
  const slots = await getPublicAvailableSlots({
    db,
    ...baseInput,
    providerIds: [{ id: "doctor-1" }, { id: "specialist-1" }, { id: "nurse-other-branch" }],
  });
  assert.ok(slots.length > 0);
  assert.equal(slots.every((slot) => slot.providerId === "doctor-1"), true);
  const rejectedOtherBranch = await getPublicAvailableSlots({
    db,
    ...baseInput,
    providerIds: [{ id: "nurse-other-branch" }],
    requestedProviderId: "nurse-other-branch",
  });
  assert.deepEqual(rejectedOtherBranch, []);
});

test("public availability rejects a requested provider outside the branch and blocks an overlapping appointment", async () => {
  const db = localDb({
    providers: [{ id: "doctor-1", fullName: "Doctor One" }],
    appointments: [{ providerId: "doctor-1", startsAt: new Date("2099-01-05T09:00:00.000Z"), endsAt: new Date("2099-01-05T09:30:00.000Z") }],
  });
  const blocked = await getPublicAvailableSlots({
    db,
    ...baseInput,
    providerIds: [{ id: "doctor-1" }],
    requestedProviderId: "doctor-1",
  });
  assert.equal(blocked.some((slot) => slot.startsAt === "2099-01-05T09:00:00.000Z"), false);
  const wrongBranch = await getPublicAvailableSlots({
    db,
    ...baseInput,
    providerIds: [{ id: "specialist-other-branch" }],
    requestedProviderId: "specialist-other-branch",
  });
  assert.deepEqual(wrongBranch, []);
});
