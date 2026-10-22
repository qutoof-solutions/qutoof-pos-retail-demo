"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** Kept for call-site compatibility; marketing content no longer animates into view. */
  delay?: number;
};

/**
 * Marketing content must be readable immediately on every browser.
 * The component keeps existing composition call sites without allowing motion
 * or observer timing to control commercial content visibility.
 */
export function ScrollReveal({ children, className = "" }: Props) {
  return <div className={`scroll-reveal scroll-reveal-visible ${className}`}>{children}</div>;
}
