"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useDataLocale } from "@/components/operations/data-portability-ui";

type MobileSidebarDrawerProps = {
  children: ReactNode;
};

const DRAWER_ID = "mobile-dashboard-sidebar-drawer";

export function MobileSidebarDrawer({ children }: MobileSidebarDrawerProps) {
  const { locale } = useDataLocale();
  const isArabic = locale === "ar";
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const focusableElements = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("aria-hidden"));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const desktopMedia = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsOpen(false);
    };
    desktopMedia.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      desktopMedia.removeEventListener("change", closeOnDesktop);
      previousFocus?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname;
      setIsOpen(false);
    }
  }, [pathname]);

  const closeWhenNavigationSelected = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a[href]")) setIsOpen(false);
  };

  const drawer = isOpen ? (
    <div className="dashboard-drawer-overlay fixed inset-0 z-[80] md:hidden" dir={isArabic ? "rtl" : "ltr"}>
      <button
        type="button"
        className="dashboard-drawer-backdrop absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-[1px]"
        aria-label={isArabic ? "إغلاق القائمة" : "Close navigation menu"}
        onClick={() => setIsOpen(false)}
      />
      <aside
        ref={panelRef}
        id={DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-label={isArabic ? "قائمة التنقل الرئيسية" : "Main navigation menu"}
        tabIndex={-1}
        dir={isArabic ? "rtl" : "ltr"}
        className="dashboard-drawer-panel absolute inset-y-0 z-10 flex h-dvh w-72 max-w-[calc(100vw-2rem)] flex-col bg-navy p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] text-white shadow-2xl"
      >
        <div className="mb-2 flex shrink-0 items-center justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label={isArabic ? "إغلاق القائمة" : "Close navigation menu"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-bright"
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" onClick={closeWhenNavigationSelected}>
          {children}
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={isArabic ? "فتح القائمة" : "Open navigation menu"}
        aria-controls={DRAWER_ID}
        aria-expanded={isOpen}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:border-teal hover:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 md:hidden"
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      {portalRoot && drawer ? createPortal(drawer, portalRoot) : null}
    </>
  );
}
