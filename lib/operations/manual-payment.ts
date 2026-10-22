export type ManualPaymentSettings = {
  mobileWalletLabel: string;
  mobileWalletNumber: string;
  instapayLink: string;
  instapayQrUrl: string;
  paymentInstructions: string;
};

export function publicManualPayment(profile: Partial<ManualPaymentSettings> | null | undefined): ManualPaymentSettings | null {
  if (!profile) return null;
  const settings: ManualPaymentSettings = {
    mobileWalletLabel: profile.mobileWalletLabel?.trim() ?? "",
    mobileWalletNumber: profile.mobileWalletNumber?.trim() ?? "",
    instapayLink: profile.instapayLink?.trim() ?? "",
    instapayQrUrl: profile.instapayQrUrl?.trim() ?? "",
    paymentInstructions: profile.paymentInstructions?.trim() ?? "",
  };
  return settings.mobileWalletNumber || settings.instapayLink || settings.instapayQrUrl ? settings : null;
}

export function hasManualPaymentSettings(profile: Partial<ManualPaymentSettings> | null | undefined): boolean {
  return publicManualPayment(profile) !== null;
}
