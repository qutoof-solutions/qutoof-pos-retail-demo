"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isTrialDays,
  parsePublicPlans,
  parsePublicResourceAddons,
  type PlanLoadState,
} from "./marketing-types";

export type PublicPricingState = PlanLoadState & {
  trialDays: number | null;
};

export type PublicPricingData = Omit<PlanLoadState, "status"> & {
  trialDays: number;
};

export type PublicPricingFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const initialState: PublicPricingState = {
  status: "loading",
  plans: [],
  addOns: [],
  trialDays: null,
};

function readTrialDays(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as { trialDays?: unknown }).trialDays;
  return isTrialDays(value) ? value : null;
}

function hasPayloadError(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { error?: unknown }).error === "string");
}

export async function loadPublicPricing(
  fetcher: PublicPricingFetcher = fetch,
  signal?: AbortSignal,
): Promise<PublicPricingData> {
  const requestSignal = signal ?? new AbortController().signal;
  const [plansResponse, settingsResponse] = await Promise.all([
    fetcher("/api/public/plans", { cache: "no-store", signal: requestSignal }),
    fetcher("/api/public/settings", { cache: "no-store", signal: requestSignal }),
  ]);
  const [plansPayload, settingsPayload] = await Promise.all([
    plansResponse.json(),
    settingsResponse.json(),
  ]);
  const plans = parsePublicPlans(plansPayload);
  const addOns = parsePublicResourceAddons(plansPayload);
  const trialDays = readTrialDays(settingsPayload);
  if (!plansResponse.ok || !settingsResponse.ok || hasPayloadError(plansPayload) || hasPayloadError(settingsPayload)
    || plans === null || addOns === null || trialDays === null) {
    throw new Error("public pricing unavailable");
  }
  return { plans, addOns, trialDays };
}

export function usePublicPricing(): PublicPricingState & { retry: () => void } {
  const [state, setState] = useState<PublicPricingState>(initialState);
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState(initialState);

    void loadPublicPricing(fetch, controller.signal)
      .then((pricing) => {
        if (!active) return;
        setState({ status: "ready", ...pricing });
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof Error && error.name === "AbortError")) return;
        setState({ status: "error", plans: [], addOns: [], trialDays: null });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [retryKey]);

  return { ...state, retry };
}
