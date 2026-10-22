import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "قطوف كاشير - نظام إدارة المتاجر ونقاط البيع",
  description: "Qutoof Cashier - Retail & POS Management",
  applicationName: "قطوف كاشير",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
