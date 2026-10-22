"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";

export type BarcodeLabelData = { value: string; itemName: string; businessName: string; priceMinor: number; copies?: number };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const priceText = (priceMinor: number, locale: string) => new Intl.NumberFormat(locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn", { style: "currency", currency: "EGP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(priceMinor / 100);

export function printBarcodeLabels(labels: BarcodeLabelData[], title = "", locale = "ar") {
  const prepared = labels.flatMap((item) => Array.from({ length: Math.max(0, Math.min(50, Math.floor(item.copies ?? 1))) }, () => item)).slice(0, 500);
  if (!prepared.length) return;
  const popup = window.open("", "_blank", "width=540,height=640");
  if (!popup) return;
  const labelHtml = prepared.map((item) => {
    const svg = popup.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    try {
      JsBarcode(svg, item.value, { format: "CODE128", displayValue: true, font: "Arial", fontSize: 9, height: 28, margin: 1, width: 1.25, textMargin: 1 });
    } catch {
      return "";
    }
    return `<article class="label"><div class="business">${escapeHtml(item.businessName)}</div><div class="name">${escapeHtml(item.itemName)}</div><div class="price">${escapeHtml(priceText(item.priceMinor, locale))}</div>${svg.outerHTML}</article>`;
  }).join("");
  popup.document.write(`<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    @page{size:50mm 30mm;margin:0}
    *{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Arial,sans-serif;color:#111}
    .label{width:50mm;height:30mm;padding:1.3mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;page-break-after:always;break-after:page;text-align:center}
    .label:last-child{page-break-after:auto;break-after:auto}.business{width:100%;font-size:7pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .name{width:100%;margin-top:.4mm;font-size:8pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .price{margin-top:.2mm;font-size:8pt;font-weight:700}.label svg{display:block;width:100%;max-width:42mm;height:11mm;overflow:visible}
    @media screen{body{display:flex;flex-wrap:wrap;background:#e5e7eb;gap:4mm;padding:8mm}.label{background:white;box-shadow:0 1mm 3mm #0002}}
  </style></head><body>${labelHtml}<script>window.onload=()=>setTimeout(()=>{window.focus();window.print()},200)<\/script></body></html>`);
  popup.document.close();
}

export function BarcodeLabel({ value, itemName, businessName, priceMinor }: Omit<BarcodeLabelData, "copies">) {
  const t = useTranslations("remaining-platform-print");
  const locale = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    try { JsBarcode(svgRef.current, value, { format: "CODE128", displayValue: false, height: 36, margin: 3, width: 1.4 }); }
    catch { svgRef.current.replaceChildren(); }
  }, [value]);
  return <><svg ref={svgRef} className="hidden" aria-hidden="true" /><Button type="button" size="sm" variant="outline" onClick={() => printBarcodeLabels([{ value, itemName, businessName, priceMinor }], t("barcodeLabel.title"), locale)}>{t("barcodeLabel.print")}</Button></>;
}
