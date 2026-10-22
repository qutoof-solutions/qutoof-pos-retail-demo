"use client";

import { PRODUCT_NAME } from "@/lib/brand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Check, ClipboardList, MessageCircle, Plus, Printer, ReceiptText, ShoppingCart, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarcodeCamera } from "@/components/operations/barcode-camera";
import { apiRequest, formatDate, formatMoney, InputField, Loading, Modal, ModuleTitle, Notice, SelectField } from "@/components/operations/shared";
import { buildWhatsAppWebUrl } from "@/lib/whatsapp/web";
import { listOfflineInvoices, nextLocalInvoiceIdentity, saveOfflineInvoice, savePosSnapshot, type OfflineInvoiceRecord, type OfflineScope } from "@/lib/pos/offline-store";
import { pendingInvoiceCount, registerPosBackgroundSync, syncPendingPosInvoices } from "@/lib/pos/offline-sync";
import { OfflineStockConflicts } from "@/components/operations/offline-stock-conflicts";
import { printKitchenTicket, printQuotation, usePrintDocumentCopy } from "@/components/operations/print-documents";
import { DataExportActions } from "@/components/operations/data-portability-ui";
import type { PriceTier, Quotation } from "@/components/operations/pos-types";
import { getTierPriceMinor as tierPrice } from "@/lib/operations/pos-pricing";
import { localizedBranchName } from "@/lib/i18n/branch-name";
import { discountMinorForPoints } from "@/lib/operations/loyalty";
import { buildInstallmentPlan } from "@/lib/operations/installments";
import { parseWeightedScaleBarcode } from "@/lib/operations/weighted-scale-barcode";
import { findUnitByBarcode, maxSellableQuantity, resolveCustomerPriceTier, unitFactor as getUnitFactor, unitTierPrice as getUnitTierPrice, type UnitPrice } from "@/lib/operations/uom";
import { deliveryStatusOptions, deliveryStatusPayload, type DeliveryStatus } from "@/lib/operations/delivery-status";
type Branch = { id: string; name: string; nameAr?: string; nameEn?: string };
type Service = { id: string; name: string; kind: string; priceMinor: number; branchId: string | null; sessionCount: number; offlinePriceToken: string };
type Customer = { id: string; fullName: string; phone: string; priceTier?: PriceTier };
type InsuranceContract = { id: string; name: string; contractType: "insurance" | "union" | "corporate"; discountBps: number; copayBps: number; memberNumberLabel: string };
type Provider = { id: string; fullName: string };
type CartLine = { serviceId: string; providerId: string; quantity: number };
type ProductLine = { inventoryItemId: string; warehouseId: string; unitId: string | null; quantity: number; priceTier: PriceTier };
type PosProduct = { units?: Array<{ id: string; code: string; name: string; conversionFactor: number; barcode: string | null; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number }>; itemId: string; sku: string; barcode: string | null; name: string; variantSize: string | null; variantColor: string | null; unitCode: string; quantityScale: number; sellingPriceMinor: number; wholesalePriceMinor: number; distributorPriceMinor: number; warehouseId: string; warehouseName: string; quantityOnHand: number; offlinePriceToken: string | null; offlinePriceTokens?: Partial<Record<PriceTier, string | null>> };
type OpenTrip = { id: string; tripNumber: string; branchId: string; routeId: string; routeName: string; salesRepId: string; salesRepName: string; vanWarehouseId: string; lines: Array<{ id: string; itemId: string; itemName: string; loadedUnits: number; quantityScale: number }> };
type PayLine = { amount: string; method: "cash" | "card" | "wallet" | "instapay"; reference: string };
type Invoice = { id: string; invoiceNumber: string; serverInvoiceNumber?: string | null; offlineLocalNumber?: string | null; offlineCreatedAt?: string | null; syncStatus?: "synced" | "pending_sync"; syncIssue?: string; customerId: string; customerName: string | null; customerPhone: string | null; subtotalMinor: number; discountMinor: number; installmentFeeMinor?: number; totalMinor: number; paidMinor: number; paymentMethod: string; status: string; orderType?: "counter" | "dine_in" | "pickup" | "delivery"; deliveryCustomerName?: string | null; deliveryAddress?: string | null; deliveryPhone?: string | null; courierName?: string | null; deliveryStatus?: DeliveryStatus | null; createdAt: string; items: Array<{ description: string; quantity: number; quantityScale: number; lineTotalMinor: number }>; payments: Array<{ amountMinor: number; paymentMethod: string; reference: string | null; reversedAt?: string | null; reversalReason?: string | null }> };
type InstallmentDraft = { downPayment: number; interestBps: number; adminFee: number; installmentCount: number; frequency: "weekly" | "monthly"; firstDueDate: string; notes: string | null };
type InvoicePayload = { idempotencyKey: string; branchId: string; customerId: string; distributionTripId?: string; discount: number; redeemPoints?: number; items: Array<Record<string, unknown>>; payments: Array<{ amount: number; method: PayLine["method"]; reference: string | null }>; installment?: InstallmentDraft; orderType?: "counter" | "dine_in" | "pickup" | "delivery"; deliveryCustomerName?: string | null; deliveryAddress?: string | null; deliveryPhone?: string | null; courierName?: string | null; offlineSync?: { localInvoiceId: string; localInvoiceNumber: string; createdAt: string }; insuranceContractId?: string | null; insuranceMemberNumber?: string | null };
type HeldSalePayload = { customerId: string; cart: CartLine[]; productCart: ProductLine[]; discount: string; redeemPoints: string; payments: PayLine[]; installmentEnabled: boolean; installmentDownPayment: string; installmentInterestBps: string; installmentAdminFee: string; installmentCount: string; installmentFrequency: "weekly" | "monthly"; installmentFirstDueDate: string; installmentNotes: string; insuranceContractId: string; insuranceMemberNumber: string; selectedTripId: string; orderType: "counter" | "dine_in" | "pickup" | "delivery"; deliveryDetails: { name: string; address: string; phone: string; courier: string }; priceTierSelection: PriceTier };
type HeldSale = { id: string; label: string | null; createdAt: string; payload: HeldSalePayload };
type ShiftLine = { paymentMethod: "cash" | "card" | "wallet" | "instapay"; expectedMinor: number; collectedMinor: number; differenceMinor: number; invoiceCount: number };
type Shift = { id: string; branchId: string; status: string; openingCashMinor: number; expectedCashMinor: number; countedCashMinor: number | null; cashDifferenceMinor: number | null; electronicTotalMinor: number; openedAt: string; closedAt: string | null; notes: string | null; lines?: ShiftLine[] };
type DataContext = { branches: Branch[]; services: Service[]; providers: Provider[]; invoiceTerms: string; invoiceNotes: string; scope?: OfflineScope; canReviewOfflineConflicts?: boolean };
export function PosModule({ businessName }: { businessName: string }) {
  const t = useTranslations("pos");
  const locale = useLocale();
  const printCopy = usePrintDocumentCopy();
  const intlLocale = locale === "en" ? "en-EG-u-nu-latn" : "ar-EG-u-nu-latn";
  const paymentOptions = [{ value: "cash", label: t("cash") }, { value: "card", label: t("card") }, { value: "wallet", label: t("electronicWallet") }, { value: "instapay", label: t("instapayTransfer") }];
  const priceTierOptions = [{ value: "retail", label: t("retail") }, { value: "wholesale", label: t("wholesale") }, { value: "distributor", label: t("distributor") }];
  const paymentLabel = (method: string) => ({ cash: t("cash"), card: t("card"), wallet: t("electronicWallet"), instapay: t("instapayTransfer") }[method] ?? method);
  const deliveryStatusLabel = (status: string) => ({ preparing: t("preparing"), out_for_delivery: t("outForDelivery"), delivered: t("delivered") }[status] ?? status);
  const quoteStatusLabel = (status: string) => ({ issued: t("issued"), converted: t("convertedToInvoice") }[status] ?? status);
  const [context, setContext] = useState<DataContext>({ branches: [], services: [], providers: [], invoiceTerms: "", invoiceNotes: "" });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [insuranceContracts, setInsuranceContracts] = useState<InsuranceContract[]>([]);
  const [insuranceContractId, setInsuranceContractId] = useState("");
  const [insuranceMemberNumber, setInsuranceMemberNumber] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [openTrips, setOpenTrips] = useState<OpenTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [localInvoices, setLocalInvoices] = useState<OfflineInvoiceRecord<InvoicePayload, Invoice>[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [branchId, setBranchId] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [productCart, setProductCart] = useState<ProductLine[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const invoiceRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const paymentRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const quotationRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [discount, setDiscount] = useState("0");
  const [payments, setPayments] = useState<PayLine[]>([{ amount: "", method: "cash", reference: "" }]);
  const [installmentEnabled, setInstallmentEnabled] = useState(false);
  const [installmentDownPayment, setInstallmentDownPayment] = useState("0");
  const [installmentInterestBps, setInstallmentInterestBps] = useState("0");
  const [installmentAdminFee, setInstallmentAdminFee] = useState("0");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [installmentFrequency, setInstallmentFrequency] = useState<"weekly" | "monthly">("monthly");
  const [installmentFirstDueDate, setInstallmentFirstDueDate] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [installmentNotes, setInstallmentNotes] = useState("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [openingCash, setOpeningCash] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [countedElectronic, setCountedElectronic] = useState({ card: "", wallet: "", instapay: "" });
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<Invoice | null>(null);
  const [loyalty, setLoyalty] = useState<{ pointsBalance: number; lifetimePoints: number }>({ pointsBalance: 0, lifetimePoints: 0 });
  const [redeemPoints, setRedeemPoints] = useState("0");
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [orderType, setOrderType] = useState<"counter" | "dine_in" | "pickup" | "delivery">("counter");
  const [priceTierSelection, setPriceTierSelection] = useState<PriceTier>("retail");
  const [deliveryDetails, setDeliveryDetails] = useState({ name: "", address: "", phone: "", courier: "" });
  const [quoteValidDays, setQuoteValidDays] = useState("30");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PayLine["method"]>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [holdLabel, setHoldLabel] = useState("");
  const services = useMemo(() => context.services.filter((service) => !service.branchId || service.branchId === branchId), [context.services, branchId]);
  const selectedTrip = useMemo(() => openTrips.find((trip) => trip.id === selectedTripId) ?? null, [openTrips, selectedTripId]);
  const saleProducts = useMemo(() => selectedTrip ? products.filter((product) => product.warehouseId === selectedTrip.vanWarehouseId) : products, [products, selectedTrip]);
  const tripCartValid = !selectedTrip || productCart.every((line) => line.warehouseId === selectedTrip.vanWarehouseId);
  const serviceMap = useMemo(() => new Map(context.services.map((service) => [service.id, service])), [context.services]);
  const unitFactor = (product: PosProduct, unitId: string | null) => { const unit = product.units?.find((entry) => entry.id === unitId); return unit ? getUnitFactor(unit.conversionFactor, product.quantityScale) : 1; };
  const unitTierPrice = (product: PosProduct | undefined, unitId: string | null, tier: PriceTier) => { if (!product) return 0; const unit = product.units?.find((entry) => entry.id === unitId) as UnitPrice | undefined; return getUnitTierPrice(unit, product as unknown as UnitPrice, tier); };
  const subtotalMinor = useMemo(() => cart.reduce((total, line) => total + (serviceMap.get(line.serviceId)?.priceMinor ?? 0) * line.quantity, 0) + productCart.reduce((total, line) => { const product = products.find((row) => row.itemId === line.inventoryItemId && row.warehouseId === line.warehouseId); return total + Math.round(unitTierPrice(product, line.unitId, line.priceTier) * line.quantity); }, 0), [cart, productCart, products, serviceMap]);
  const discountMinor = Math.max(0, Math.round(Number(discount || 0) * 100));
  const redeemPointsCount = Math.max(0, Math.floor(Number(redeemPoints || 0)));
  const loyaltyDiscountMinor = discountMinorForPoints(redeemPointsCount);
  const selectedInsurance = insuranceContracts.find((contract) => contract.id === insuranceContractId);
  const insuranceGrossMinor = Math.max(0, subtotalMinor - discountMinor);
  const insuranceAdjustedMinor = selectedInsurance ? Math.round(insuranceGrossMinor * (1 - selectedInsurance.discountBps / 10000)) : insuranceGrossMinor;
  const principalMinor = Math.max(0, (selectedInsurance ? Math.round(insuranceAdjustedMinor * selectedInsurance.copayBps / 10000) : insuranceAdjustedMinor) - loyaltyDiscountMinor);
  const installmentPreview = useMemo(() => {
    if (!installmentEnabled || principalMinor < 1) return null;
    try {
      return buildInstallmentPlan({ baseTotalMinor: principalMinor, downPaymentMinor: Math.round(Number(installmentDownPayment || 0) * 100), interestBps: Number(installmentInterestBps || 0), adminFeeMinor: Math.round(Number(installmentAdminFee || 0) * 100), installmentCount: Number(installmentCount || 0), frequency: installmentFrequency, firstDueAt: new Date(`${installmentFirstDueDate}T12:00:00.000Z`) });
    } catch {
      return null;
    }
  }, [installmentAdminFee, installmentCount, installmentDownPayment, installmentEnabled, installmentFirstDueDate, installmentFrequency, installmentInterestBps, principalMinor]);
  const interestFeeMinor = installmentPreview?.interestFeeMinor ?? 0;
  const adminFeeMinor = installmentPreview?.adminFeeMinor ?? 0;
  const totalMinor = installmentPreview?.totalDueMinor ?? principalMinor;
  const paidMinor = payments.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.amount || 0) * 100)), 0);
  const remainingMinor = Math.max(totalMinor - paidMinor, 0);
  const overpaymentMinor = Math.max(paidMinor - totalMinor, 0);
  const paymentComplete = totalMinor > 0 && remainingMinor === 0 && overpaymentMinor === 0;
  const recentInvoices: Invoice[] = [...localInvoices.filter((record) => record.state !== "synced").map((record) => ({
    ...record.receipt,
    id: record.id,
    invoiceNumber: record.localNumber,
    offlineLocalNumber: record.localNumber,
    syncStatus: "pending_sync" as const,
    status: record.state,
    syncIssue: record.lastError,
  })), ...invoices];

  const loadBranchData = useCallback(async (selectedBranch: string) => {
    const [invoiceData, shiftData, quotationData, tripData] = await Promise.all([
      apiRequest<{ invoices: Invoice[] }>(`/api/ops/invoices?branchId=${encodeURIComponent(selectedBranch)}`),
      apiRequest<{ open: Shift | null; history: Shift[] }>(`/api/ops/settlements?branchId=${encodeURIComponent(selectedBranch)}`),
      apiRequest<{ quotations: Quotation[] }>(`/api/ops/quotations?branchId=${encodeURIComponent(selectedBranch)}`),
      apiRequest<{ trips: OpenTrip[] }>(`/api/ops/distribution/trips?branchId=${encodeURIComponent(selectedBranch)}`),
    ]);
    setInvoices(invoiceData.invoices); setShift(shiftData.open); setHistory(shiftData.history); setQuotations(quotationData.quotations.map((quotation) => ({ ...quotation, branchName: localizedBranchName(quotation, locale) }))); setOpenTrips(tripData.trips);
    setSelectedTripId((current) => current && tripData.trips.some((trip) => trip.id === current) ? current : "");
    return invoiceData.invoices;
  }, [locale]);
  const loadAll = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [refs, customersData, contractData] = await Promise.all([
        apiRequest<DataContext>("/api/ops/context"), apiRequest<{ customers: Customer[] }>("/api/ops/customers?limit=100"), apiRequest<{ contracts: InsuranceContract[] }>("/api/ops/medical?type=contracts"),
      ]);
      setContext(refs); setCustomers(customersData.customers); setInsuranceContracts(contractData.contracts);
      setBranchId((current) => current || refs.branches[0]?.id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("loadPosError")); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    setRedeemPoints("0");
    if (!customerId) { setLoyalty({ pointsBalance: 0, lifetimePoints: 0 }); return; }
    let cancelled = false;
    void apiRequest<{ account: { pointsBalance?: number; lifetimePoints?: number } }>(`/api/ops/customers/${customerId}/loyalty`).then((result) => {
      if (!cancelled) setLoyalty({ pointsBalance: result.account.pointsBalance ?? 0, lifetimePoints: result.account.lifetimePoints ?? 0 });
    }).catch(() => { if (!cancelled) setLoyalty({ pointsBalance: 0, lifetimePoints: 0 }); });
    return () => { cancelled = true; };
  }, [customerId]);
  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => { window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); };
  }, []);
  const refreshLocalInvoices = useCallback(async () => {
    if (!context.scope || !branchId) return [] as OfflineInvoiceRecord<InvoicePayload, Invoice>[];
    try {
      const rows = await listOfflineInvoices<InvoicePayload, Invoice>(context.scope, branchId);
      setLocalInvoices(rows);
      return rows;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("readLocalInvoicesError"));
      return [];
    }
  }, [context.scope, branchId, t]);
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    if (isOnline) {
      void loadBranchData(branchId).catch(async (cause) => {
        if (cancelled) return;
        if (!navigator.onLine && context.scope) {
          const snapshot = await import("@/lib/pos/offline-store").then(({ loadPosSnapshot }) => loadPosSnapshot<DataContext, Customer, PosProduct>(context.scope!, branchId)).catch(() => null);
          if (snapshot) { setContext(snapshot.context); setCustomers(snapshot.customers); setProducts(snapshot.products); }
          return;
        }
        setError(cause instanceof Error ? cause.message : t("refreshBranchError"));
      });
      void apiRequest<{ products: PosProduct[]; scope?: OfflineScope }>(`/api/ops/pos/catalog?branchId=${encodeURIComponent(branchId)}`).then(async (result) => {
        if (cancelled) return;
        setProducts(result.products);
        const scope = context.scope ?? result.scope;
        if (scope) await savePosSnapshot(scope, branchId, { context: { ...context, scope }, customers, products: result.products });
      }).catch(async (cause) => {
        if (cancelled) return;
        if (!navigator.onLine && context.scope) {
          const snapshot = await import("@/lib/pos/offline-store").then(({ loadPosSnapshot }) => loadPosSnapshot<DataContext, Customer, PosProduct>(context.scope!, branchId)).catch(() => null);
          if (snapshot) { setContext(snapshot.context); setCustomers(snapshot.customers); setProducts(snapshot.products); }
          return;
        }
        setError(cause instanceof Error ? cause.message : t("loadInventoryError"));
      });
    } else if (context.scope) {
      void import("@/lib/pos/offline-store").then(({ loadPosSnapshot }) => loadPosSnapshot<DataContext, Customer, PosProduct>(context.scope!, branchId)).then((snapshot) => {
        if (cancelled || !snapshot) return;
        setContext(snapshot.context); setCustomers(snapshot.customers); setProducts(snapshot.products);
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [branchId, context, customers, isOnline, loadBranchData, t]);
  useEffect(() => { void refreshLocalInvoices(); }, [refreshLocalInvoices]);
  const loadHeldSales = useCallback(async () => {
    if (!branchId || !isOnline) { setHeldSales([]); return; }
    try { const result = await apiRequest<{ holds: HeldSale[] }>(`/api/ops/pos/holds?branchId=${encodeURIComponent(branchId)}`); setHeldSales(result.holds); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("loadHeldSalesError")); }
  }, [branchId, isOnline, t]);
  useEffect(() => { void loadHeldSales(); }, [loadHeldSales]);
  useEffect(() => {
    if (!isOnline || !context.scope || !branchId) return;
    let cancelled = false;
    void syncPendingPosInvoices<InvoicePayload, Invoice>(context.scope).then(async (result) => {
      if (cancelled) return;
      await refreshLocalInvoices();
      if (result.synced) {
        await loadBranchData(branchId).catch(() => undefined);
        setMessage(`${t("syncCompletedPrefix")} ${result.synced} ${t("syncCompletedSuffix")}`);
      } else if (result.needsAttention) setError(t("localInvoiceNeedsReview"));
      else if (result.retryableError) await registerPosBackgroundSync(context.scope!);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isOnline, context.scope, branchId, refreshLocalInvoices, loadBranchData, t]);

  function addService() {
    const available = services[0]; if (!available) return;
    setCart((current) => [...current, { serviceId: available.id, providerId: "", quantity: 1 }]);
  }
  function addProduct() {
    const available = saleProducts.find((row) => row.quantityOnHand > 0) ?? (!navigator.onLine ? saleProducts[0] : undefined);
    if (!available) return;
    setProductCart((current) => [...current, { inventoryItemId: available.itemId, warehouseId: available.warehouseId, unitId: null, quantity: 1, priceTier: priceTierSelection }]);
  }
  function scanProduct(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    const weighted = parseWeightedScaleBarcode(code);
    const match = saleProducts.find((row) => row.barcode === code || row.sku.toLocaleLowerCase() === code.toLocaleLowerCase() || findUnitByBarcode(row.units, code));
    if (weighted) { const weightedProduct = saleProducts.find((row) => row.sku === weighted.itemCode || row.barcode === weighted.itemCode); if (weightedProduct) { setProductCart((current) => [...current, { inventoryItemId: weightedProduct.itemId, warehouseId: weightedProduct.warehouseId, quantity: weighted.quantity ?? 1, unitId: null, priceTier: priceTierSelection }]); setError(""); setMessage(`${t("addedProduct")} ${weightedProduct.name} ${t("fromWarehouse")} ${weightedProduct.warehouseName}.`); setScanValue(""); return; } }
    const matchedUnit = match ? findUnitByBarcode(match.units, code) : null;
    if (!match) { setError(t("productNotFoundByCode")); return; }
    if (match.quantityOnHand <= 0 && navigator.onLine) { setError(`${t("productBalance")} ${match.name} ${t("unavailableInWarehouse")} ${match.warehouseName}.`); return; }
    setProductCart((current) => [...current, { inventoryItemId: match.itemId, warehouseId: match.warehouseId, unitId: matchedUnit?.id ?? null, quantity: 1, priceTier: priceTierSelection }]);
    setError(""); setMessage(match.quantityOnHand <= 0 ? `${t("addedProduct")} ${match.name} ${t("offlineShortageReview")}` : `${t("addedProduct")} ${match.name} ${t("fromWarehouse")} ${match.warehouseName}.`); setScanValue("");  }
  function addScannedProduct() { scanProduct(scanValue); }
  function updateCart(index: number, patch: Partial<CartLine>) { setCart((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line)); }
  function updateProductCart(index: number, patch: Partial<ProductLine>) { setProductCart((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line)); }
  function updatePayment(index: number, patch: Partial<PayLine>) { setPayments((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line)); }
  function selectTrip(value: string) {
    const trip = openTrips.find((row) => row.id === value);
    setSelectedTripId(value);
    if (trip) setProductCart((current) => current.map((line) => {
      const product = products.find((row) => row.itemId === line.inventoryItemId && row.warehouseId === trip.vanWarehouseId);
      return product ? { ...line, warehouseId: product.warehouseId } : line;
    }));
  }
  async function createLocalOfflineInvoice(draft: Omit<InvoicePayload, "idempotencyKey" | "offlineSync">, existingId?: string) {
    if (draft.distributionTripId) throw new Error(t("tripInvoicesNeedConnection"));
    if (!context.scope) throw new Error(t("offlineWorkspaceUnavailable"));
    const customer = customers.find((row) => row.id === customerId);
    if (!customer) throw new Error(t("offlineCustomerUnavailable"));
    const localLines: Array<Record<string, unknown>> = [];
    const receiptItems: Invoice["items"] = [];
    let localSubtotalMinor = 0;
    for (const line of cart) {
      const service = serviceMap.get(line.serviceId);
      if (!service?.offlinePriceToken) throw new Error(t("servicePriceUnavailableOffline"));
      const lineTotalMinor = service.priceMinor * line.quantity;
      localSubtotalMinor += lineTotalMinor;
      localLines.push({ type: "service", serviceId: line.serviceId, providerId: line.providerId || null, quantity: line.quantity, offlinePrice: { unitPriceMinor: service.priceMinor, token: service.offlinePriceToken } });
      receiptItems.push({ description: service.name, quantity: line.quantity, quantityScale: 0, lineTotalMinor });
    }
    for (const line of productCart) {
      const product = products.find((row) => row.itemId === line.inventoryItemId && row.warehouseId === line.warehouseId);
      if (!product?.offlinePriceToken) throw new Error(t("productPriceUnavailableOffline"));
      const quantity = Math.round(line.quantity * (10 ** product.quantityScale));
      const unitPriceMinor = tierPrice(product, line.priceTier);
      const token = product.offlinePriceTokens?.[line.priceTier] ?? (line.priceTier === "retail" ? product.offlinePriceToken : null);
      if (!token) throw new Error(`${t("tierPriceUnavailable")} ${line.priceTier} ${t("forProduct")} ${product.name} ${t("signedPriceUnavailable")}`);
      const lineTotalMinor = Math.round(quantity * unitPriceMinor / (10 ** product.quantityScale));
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 1 || !Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 1) throw new Error(`${t("invalidQuantityOrValue")} ${product.name}.`);
      localSubtotalMinor += lineTotalMinor;
      localLines.push({ type: "inventory", inventoryItemId: line.inventoryItemId, warehouseId: line.warehouseId, quantity: line.quantity, priceTier: line.priceTier, offlinePrice: { unitPriceMinor, token } });
      const variant = [product.variantSize, product.variantColor].filter(Boolean).join(" / ");
      receiptItems.push({ description: `${product.name}${variant ? ` · ${variant}` : ""} (${product.unitCode})`, quantity, quantityScale: product.quantityScale, lineTotalMinor });
    }
    const localDiscountMinor = Math.round(Number(draft.discount || 0) * 100);
    const localTotalMinor = localSubtotalMinor - localDiscountMinor;
    const localPaidMinor = draft.payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    if (localTotalMinor < 0 || localPaidMinor > localTotalMinor) throw new Error(t("checkDiscountAndPayments"));
    const identity = await nextLocalInvoiceIdentity(context.scope, existingId);
    const createdAt = new Date().toISOString();
    const payload: InvoicePayload = {
      ...draft,
      idempotencyKey: identity.id,
      items: localLines,
      offlineSync: { localInvoiceId: identity.id, localInvoiceNumber: identity.localNumber, createdAt },
    };
    const paymentMethod = draft.payments.length === 0 ? "unpaid" : draft.payments.length === 1 ? draft.payments[0]!.method : "mixed";
    const localInvoice: Invoice = {
      id: identity.id,
      invoiceNumber: identity.localNumber,
      offlineLocalNumber: identity.localNumber,
      offlineCreatedAt: createdAt,
      syncStatus: "pending_sync",
      customerId,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      subtotalMinor: localSubtotalMinor,
      discountMinor: localDiscountMinor,
      totalMinor: localTotalMinor,
      paidMinor: localPaidMinor,
      paymentMethod,
      status: localPaidMinor === 0 ? "issued" : localPaidMinor === localTotalMinor ? "paid" : "partially_paid",
      createdAt,
      items: receiptItems,
      payments: draft.payments.map((payment) => ({ amountMinor: Math.round(payment.amount * 100), paymentMethod: payment.method, reference: payment.reference })),
    };
    await saveOfflineInvoice<InvoicePayload, Invoice>({ id: identity.id, tenantId: context.scope.tenantId, userId: context.scope.userId, branchId, localNumber: identity.localNumber, createdAt, state: "pending_sync", payload, receipt: localInvoice });
    const requestedByWarehouseItem = new Map<string, number>();
    for (const line of productCart) {
      const product = products.find((row) => row.itemId === line.inventoryItemId && row.warehouseId === line.warehouseId);
      if (product) {
        const key = `${line.inventoryItemId}:${line.warehouseId}`;
        requestedByWarehouseItem.set(key, (requestedByWarehouseItem.get(key) ?? 0) + Math.round(line.quantity * (10 ** product.quantityScale)));
      }
    }
    const localShortages = [...requestedByWarehouseItem].filter(([key, quantity]) => {
      const [itemId, warehouseId] = key.split(":");
      const product = products.find((row) => row.itemId === itemId && row.warehouseId === warehouseId);
      return Boolean(product && quantity > product.quantityOnHand);
    });
    const nextProducts = products.map((product) => ({ ...product, quantityOnHand: Math.max(0, product.quantityOnHand - (requestedByWarehouseItem.get(`${product.itemId}:${product.warehouseId}`) ?? 0)) }));
    setProducts(nextProducts);
    await savePosSnapshot(context.scope, branchId, { context, customers, products: nextProducts }).catch(() => undefined);
    invoiceRequestRef.current = null;
    setReceipt(localInvoice);
    setCart([]); setProductCart([]); setCustomerId(""); setInsuranceContractId(""); setInsuranceMemberNumber(""); setDiscount("0"); setPayments([{ amount: "", method: "cash", reference: "" }]); setOrderType("counter"); setDeliveryDetails({ name: "", address: "", phone: "", courier: "" }); setInstallmentEnabled(false); setInstallmentDownPayment("0"); setInstallmentInterestBps("0"); setInstallmentAdminFee("0"); setInstallmentCount("3"); setInstallmentNotes("");
    await refreshLocalInvoices();
    setMessage(`${t("offlineInvoiceIssued")} ${identity.localNumber}؛ ${t("pendingSync")} ${localShortages.length ? ` ${t("offlineShortageWarning")}` : ""}`);
    await registerPosBackgroundSync(context.scope);
  }
  function clearSaleDraft() {
    setCart([]); setProductCart([]); setCustomerId(""); setInsuranceContractId(""); setInsuranceMemberNumber(""); setDiscount("0"); setRedeemPoints("0"); setPayments([{ amount: "", method: "cash", reference: "" }]); setSelectedTripId(""); setOrderType("counter"); setDeliveryDetails({ name: "", address: "", phone: "", courier: "" }); setInstallmentEnabled(false); setInstallmentDownPayment("0"); setInstallmentInterestBps("0"); setInstallmentAdminFee("0"); setInstallmentCount("3"); setInstallmentNotes(""); setHoldLabel("");
  }
  async function holdCurrentSale() {
    if (!isOnline || !branchId || (!cart.length && !productCart.length)) return;
    setBusy(true); setError("");
    try {
      const payload: HeldSalePayload = { customerId, cart, productCart, discount, redeemPoints, payments, installmentEnabled, installmentDownPayment, installmentInterestBps, installmentAdminFee, installmentCount, installmentFrequency, installmentFirstDueDate, installmentNotes, insuranceContractId, insuranceMemberNumber, selectedTripId, orderType, deliveryDetails, priceTierSelection };
      await apiRequest("/api/ops/pos/holds", { method: "POST", body: JSON.stringify({ branchId, customerId: customerId || null, label: holdLabel.trim() || null, payload }) });
      clearSaleDraft(); await loadHeldSales(); setMessage(t("saleHeld"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("holdSaleError")); }
    finally { setBusy(false); }
  }
  async function recallHeldSale(hold: HeldSale) {
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/ops/pos/holds`, { method: "PATCH", body: JSON.stringify({ id: hold.id, action: "recall" }) });
      const d = hold.payload; setCustomerId(d.customerId); setCart(d.cart); setProductCart(d.productCart); setDiscount(d.discount); setRedeemPoints(d.redeemPoints); setPayments(d.payments); setInstallmentEnabled(d.installmentEnabled); setInstallmentDownPayment(d.installmentDownPayment); setInstallmentInterestBps(d.installmentInterestBps); setInstallmentAdminFee(d.installmentAdminFee); setInstallmentCount(d.installmentCount); setInstallmentFrequency(d.installmentFrequency); setInstallmentFirstDueDate(d.installmentFirstDueDate); setInstallmentNotes(d.installmentNotes); setInsuranceContractId(d.insuranceContractId); setInsuranceMemberNumber(d.insuranceMemberNumber); setSelectedTripId(d.selectedTripId); setOrderType(d.orderType); setDeliveryDetails(d.deliveryDetails); setPriceTierSelection(d.priceTierSelection); await loadHeldSales(); setMessage(t("saleRecalled"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("recallSaleError")); }
    finally { setBusy(false); }
  }
  async function cancelHeldSale(id: string) {
    setBusy(true); setError("");
    try { await apiRequest("/api/ops/pos/holds", { method: "PATCH", body: JSON.stringify({ id, action: "cancel" }) }); await loadHeldSales(); setMessage(t("heldSaleCancelled")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("cancelHeldSaleError")); }
    finally { setBusy(false); }
  }
  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!branchId) return;
    setBusy(true); setError(""); setMessage("");
    const paymentRows = payments.filter((item) => Number(item.amount) > 0).map((item) => ({ amount: Number(item.amount), method: item.method, reference: item.reference || null }));
    const installment = installmentEnabled ? { downPayment: Number(installmentDownPayment || 0), interestBps: Number(installmentInterestBps || 0), adminFee: Number(installmentAdminFee || 0), installmentCount: Number(installmentCount || 0), frequency: installmentFrequency, firstDueDate: installmentFirstDueDate, notes: installmentNotes || null } : undefined;
    const draft: Omit<InvoicePayload, "idempotencyKey" | "offlineSync"> = { branchId, customerId, redeemPoints: redeemPointsCount, ...(selectedTrip ? { distributionTripId: selectedTrip.id } : {}), insuranceContractId: insuranceContractId || null, insuranceMemberNumber: insuranceMemberNumber || null, discount: Number(discount || 0), items: [...cart.map((item) => ({ type: "service", serviceId: item.serviceId, providerId: item.providerId || null, quantity: item.quantity })), ...productCart.map((item) => ({ type: "inventory", inventoryItemId: item.inventoryItemId, warehouseId: item.warehouseId, unitId: item.unitId, quantity: item.quantity, priceTier: item.priceTier }))], payments: paymentRows, ...(installment ? { installment } : {}), orderType, deliveryCustomerName: orderType === "delivery" ? deliveryDetails.name : null, deliveryAddress: orderType === "delivery" ? deliveryDetails.address : null, deliveryPhone: orderType === "delivery" ? deliveryDetails.phone : null, courierName: orderType === "delivery" ? deliveryDetails.courier || null : null };
    const fingerprint = JSON.stringify(draft);
    if (!invoiceRequestRef.current || invoiceRequestRef.current.fingerprint !== fingerprint) invoiceRequestRef.current = { fingerprint, key: crypto.randomUUID() };
    try {
      if (!navigator.onLine) {
        if (selectedTrip) throw new Error(t("tripSalesNeedConnection"));
        if (redeemPointsCount > 0) throw new Error(t("redeemPointsNeedConnection"));
        if (orderType !== "counter") throw new Error(t("orderTypesNeedConnection"));
        if (installmentEnabled) throw new Error(t("installmentNeedConnection"));
        await createLocalOfflineInvoice(draft, invoiceRequestRef.current.key);
        return;
      }
      try {
        const result = await apiRequest<{ invoice: Invoice }>("/api/ops/invoices", { method: "POST", body: JSON.stringify({ ...draft, idempotencyKey: invoiceRequestRef.current.key }) });
        setReceipt(result.invoice);
        await loadBranchData(branchId);
        const productData = await apiRequest<{ products: PosProduct[]; scope?: OfflineScope }>(`/api/ops/pos/catalog?branchId=${encodeURIComponent(branchId)}`);
        setProducts(productData.products);
        invoiceRequestRef.current = null; setCart([]); setProductCart([]); setCustomerId(""); setDiscount("0"); setPayments([{ amount: "", method: "cash", reference: "" }]); setOrderType("counter"); setDeliveryDetails({ name: "", address: "", phone: "", courier: "" });
        setMessage(`${t("invoiceIssued")} ${result.invoice.invoiceNumber}`);
      } catch (cause) {
        if (!navigator.onLine) throw new Error(t("invoiceConnectionLost"));
        throw cause;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("issueInvoiceError")); }
    finally { setBusy(false); }
  }
  async function createQuotation(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!branchId || !customerId || (!cart.length && !productCart.length)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!navigator.onLine) throw new Error(t("quotationNeedConnection"));
      const items = [...cart.map((item) => ({ type: "service", serviceId: item.serviceId, quantity: item.quantity })), ...productCart.map((item) => ({ type: "inventory", inventoryItemId: item.inventoryItemId, warehouseId: item.warehouseId, unitId: item.unitId, quantity: item.quantity, priceTier: item.priceTier }))];
      const draft = { branchId, customerId, discount: Number(discount || 0), items, validDays: Number(quoteValidDays), notes: quoteNotes || null };
      const fingerprint = JSON.stringify(draft);
      if (!quotationRequestRef.current || quotationRequestRef.current.fingerprint !== fingerprint) quotationRequestRef.current = { fingerprint, key: crypto.randomUUID() };
      const result = await apiRequest<{ quotation: Quotation }>("/api/ops/quotations", { method: "POST", body: JSON.stringify({ ...draft, idempotencyKey: quotationRequestRef.current.key }) });
      const customer = customers.find((row) => row.id === customerId);
      const branch = context.branches.find((row) => row.id === branchId);
      const quote = { ...result.quotation, customerName: result.quotation.customerName ?? customer?.fullName ?? null, customerPhone: result.quotation.customerPhone ?? customer?.phone ?? null, branchName: localizedBranchName(result.quotation, locale) || (branch ? localizedBranchName(branch, locale) : null) };
      setSelectedQuotation(quote); await loadBranchData(branchId); quotationRequestRef.current = null; setMessage(`${t("quotationIssued")} ${quote.quoteNumber}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("issueQuotationError")); }
    finally { setBusy(false); }
  }
  async function convertQuotation(quote: Quotation) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ invoice: Invoice }>(`/api/ops/quotations/${encodeURIComponent(quote.id)}/convert`, { method: "POST", body: JSON.stringify({}) });
      setReceipt(result.invoice); setSelectedQuotation(null); await loadBranchData(branchId);
      const productsData = await apiRequest<{ products: PosProduct[] }>(`/api/ops/pos/catalog?branchId=${encodeURIComponent(branchId)}`); setProducts(productsData.products);
      setMessage(`${t("quotationConverted")} ${quote.quoteNumber} ${t("toInvoice")} ${result.invoice.invoiceNumber} ${t("andDeductedInventory")}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("convertQuotationError")); }
    finally { setBusy(false); }
  }
  async function updateDeliveryStatus(invoice: Invoice, deliveryStatus: DeliveryStatus) {
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/ops/invoices/${encodeURIComponent(invoice.id)}/delivery`, { method: "PATCH", body: JSON.stringify(deliveryStatusPayload(deliveryStatus)) });
      await loadBranchData(branchId); setMessage(`${t("deliveryStatusUpdated")} ${invoice.invoiceNumber}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("updateDeliveryStatusError")); }
    finally { setBusy(false); }
  }
  async function recordInvoicePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!payingInvoice || !branchId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const draft = { amount: Number(paymentAmount), method: paymentMethod, reference: paymentReference || null };
      const fingerprint = JSON.stringify({ invoiceId: payingInvoice.id, ...draft });
      if (!paymentRequestRef.current || paymentRequestRef.current.fingerprint !== fingerprint) paymentRequestRef.current = { fingerprint, key: crypto.randomUUID() };
      await apiRequest(`/api/ops/invoices/${encodeURIComponent(payingInvoice.id)}/payments`, { method: "POST", body: JSON.stringify({ ...draft, idempotencyKey: paymentRequestRef.current.key }) });
      const refreshed = await loadBranchData(branchId);
      const updated = refreshed.find((invoice) => invoice.id === payingInvoice.id);
      if (updated) setReceipt(updated);
      paymentRequestRef.current = null;
      setPayingInvoice(null); setPaymentAmount(""); setPaymentReference(""); setMessage(t("paymentRecorded"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("recordPaymentError")); }
    finally { setBusy(false); }
  }
  async function openShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await apiRequest("/api/ops/settlements", { method: "POST", body: JSON.stringify({ action: "open", branchId, openingCash: Number(openingCash), notes: notes || null }) }); setMessage(t("shiftOpened")); setNotes(""); await loadBranchData(branchId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("openShiftError")); }
    finally { setBusy(false); }
  }
  async function closeShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!shift) return; setBusy(true); setError(""); setMessage("");
    try { const result = await apiRequest<{ settlement: Shift }>("/api/ops/settlements", { method: "POST", body: JSON.stringify({ action: "close", settlementId: shift.id, countedCash: Number(countedCash), countedElectronic: { card: Number(countedElectronic.card || 0), wallet: Number(countedElectronic.wallet || 0), instapay: Number(countedElectronic.instapay || 0) }, notes: notes || null }) }); setMessage(`${t("shiftClosed")} ${formatMoney(result.settlement.cashDifferenceMinor, locale)}`); setCountedCash(""); setCountedElectronic({ card: "", wallet: "", instapay: "" }); setNotes(""); await loadBranchData(branchId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("closeShiftError")); }
    finally { setBusy(false); }
  }
  const receiptWhatsAppMessage = receipt ? [t("receiptWhatsAppGreeting"), receipt.customerName ?? "", t("receiptWhatsAppBody"), receipt.invoiceNumber, t("receiptWhatsAppAmount"), formatMoney(receipt.totalMinor, locale), t("receiptWhatsAppFrom"), PRODUCT_NAME].filter(Boolean).join(" ") : "";
  return <section><ModuleTitle eyebrow={t("settlementAndClosing")} title={t("posAndShift")} description={t("posDescription")} action={<DataExportActions dataset="invoices" />} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${isOnline ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}><span aria-hidden="true">{isOnline ? "🟢" : "🟡"}</span>{isOnline ? t("online") : `${t("offlineLocalMode")} ${pendingInvoiceCount(localInvoices)} ${t("heldInvoiceCount")}`}</span>{isOnline && pendingInvoiceCount(localInvoices) > 0 && <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">{t("pendingSync")}: {pendingInvoiceCount(localInvoices)}</span>}</div>
    {context.canReviewOfflineConflicts && branchId && <OfflineStockConflicts branchId={branchId} />}
    {context.branches.length > 0 && <div className="mb-4 max-w-sm"><SelectField label={t("branch")} value={branchId} onChange={setBranchId} options={context.branches.map((branch) => ({ value: branch.id, label: localizedBranchName(branch, locale) }))} /></div>}{error && <div className="mb-3"><Notice>{error}</Notice></div>}{message && <div className="mb-3"><Notice kind="success">{message}</Notice></div>}{loading ? <Loading /> : !branchId ? <Notice kind="info">{t("branchRequired")}</Notice> : <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><div className="space-y-5">      <section className="space-y-4 rounded-2xl border border-violet-200 bg-white p-5">
        <div><h2 className="font-bold text-navy">{t("salesAndRestaurantOptions")}</h2><p className="mt-1 text-xs text-slate-500">{t("salesOptionsDescription")}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t("invoicePriceTier")} value={priceTierSelection} onChange={(value) => { const tier = value as PriceTier; setPriceTierSelection(tier); setProductCart((current) => current.map((line) => ({ ...line, priceTier: tier }))); }} options={priceTierOptions} />
          <SelectField label={t("orderType")} value={orderType} onChange={(value) => setOrderType(value as typeof orderType)} options={[{ value: "counter", label: t("counterSale") }, { value: "dine_in", label: t("dineIn") }, { value: "pickup", label: t("pickup") }, { value: "delivery", label: t("delivery") }]} />
        </div>
        {orderType === "delivery" && <div className="grid gap-3 rounded-xl bg-amber-50 p-3 sm:grid-cols-2"><InputField label={t("deliveryRecipientName")} value={deliveryDetails.name} onChange={(value) => setDeliveryDetails((current) => ({ ...current, name: value }))} required /><InputField label={t("phoneNumber")} value={deliveryDetails.phone} onChange={(value) => setDeliveryDetails((current) => ({ ...current, phone: value }))} type="tel" required /><InputField label={t("address")} value={deliveryDetails.address} onChange={(value) => setDeliveryDetails((current) => ({ ...current, address: value }))} required /><InputField label={t("courierNameOptional")} value={deliveryDetails.courier} onChange={(value) => setDeliveryDetails((current) => ({ ...current, courier: value }))} /></div>}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"><InputField label={t("quotationValidityDays")} type="number" min="1" max="365" value={quoteValidDays} onChange={setQuoteValidDays} /><InputField label={t("quotationNotes")} value={quoteNotes} onChange={setQuoteNotes} /><p className="text-xs leading-5 text-slate-500">{t("quotationSavedNoStock")}</p><Button type="button" variant="outline" disabled={busy || !isOnline || Boolean(selectedTrip) || !customerId || (!cart.length && !productCart.length)} onClick={(event) => void createQuotation(event)}>{t("issueQuotation")}</Button></div>
        {quotations.length > 0 && <div className="space-y-2 border-t border-slate-100 pt-3"><h3 className="text-sm font-semibold text-navy">{t("recentQuotations")}</h3>{quotations.slice(0, 8).map((quote) => <article key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><div><strong className="text-sm text-navy">{quote.quoteNumber}</strong><p className="text-xs text-slate-500">{quote.customerName ?? t("customerFallback")} · {formatMoney(quote.totalMinor, locale)} · {quoteStatusLabel(quote.status)}</p></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => printQuotation(quote, businessName, printCopy, locale)}><Printer size={14} /> {t("printPdf")}</Button>{quote.status === "issued" && <Button type="button" size="sm" disabled={busy} onClick={() => void convertQuotation(quote)}>{t("convertToInvoice")}</Button>}</div></article>)}</div>}
        {invoices.filter((invoice) => invoice.orderType === "delivery" || invoice.orderType === "dine_in" || invoice.orderType === "pickup").slice(0, 6).map((invoice) => <article key={`kot-${invoice.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2"><div><strong className="text-sm text-navy">{invoice.invoiceNumber}</strong><p className="text-xs text-slate-500">{invoice.orderType === "delivery" ? `${t("delivery")} · ${invoice.deliveryCustomerName ?? invoice.customerName ?? ""} · ${deliveryStatusLabel(invoice.deliveryStatus ?? "preparing")}` : invoice.orderType === "dine_in" ? t("dineIn") : t("pickup")}</p></div><div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => printKitchenTicket(invoice, businessName, printCopy, locale)}><Printer size={14} /> {t("kitchenTicketNoPrices")}</Button>{isOnline && invoice.orderType === "delivery" && invoice.deliveryStatus !== "delivered" && <SelectField label={t("deliveryStatus")} value={invoice.deliveryStatus ?? "preparing"} onChange={(value) => void updateDeliveryStatus(invoice, value as DeliveryStatus)} options={deliveryStatusOptions((status) => deliveryStatusLabel(status), invoice.deliveryStatus ?? "preparing")} />}</div></article>)}
      </section>
      {isOnline && <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-amber-950">{t("heldSales")}</h2><Button type="button" size="sm" variant="outline" onClick={() => void loadHeldSales()} disabled={busy}>{t("refresh")}</Button></div>{heldSales.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{heldSales.map((hold) => <article key={hold.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3"><div><strong className="text-sm text-navy">{hold.label || t("unnamedHeldSale")}</strong><p className="text-xs text-slate-500">{formatDate(hold.createdAt, true, locale)} · {hold.payload.cart.length + hold.payload.productCart.length} {t("itemsUnit")}</p></div><div className="flex gap-2"><Button type="button" size="sm" onClick={() => void recallHeldSale(hold)} disabled={busy}>{t("recallSale")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => void cancelHeldSale(hold.id)} disabled={busy}>{t("cancel")}</Button></div></article>)}</div> : <p className="mt-2 text-sm text-amber-900">{t("noHeldSales")}</p>}</section>}
      <form onSubmit={createInvoice} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-bold text-navy"><ShoppingCart size={19} className="text-teal" /> {t("newInvoice")}</h2><div className="flex flex-wrap gap-2"><InputField label={t("holdLabelOptional")} value={holdLabel} onChange={setHoldLabel} /><Button type="button" size="sm" variant="outline" disabled={busy || !isOnline || (!cart.length && !productCart.length)} onClick={() => void holdCurrentSale()}>{t("holdSale")}</Button><Button type="button" size="sm" variant="outline" onClick={addService} disabled={!services.length}><Plus size={16} /> {t("addService")}</Button><Button type="button" size="sm" variant="outline" onClick={addProduct} disabled={!saleProducts.some((row) => row.quantityOnHand > 0)}><Plus size={16} /> {t("addInventoryItem")}</Button></div></div><SelectField label={t("customer")} value={customerId} onChange={(value) => { setCustomerId(value); const tier = resolveCustomerPriceTier(customers.find((customer) => customer.id === value)?.priceTier); setPriceTierSelection(tier); setProductCart((current) => current.map((line) => ({ ...line, priceTier: tier }))); }} options={customers.map((customer) => ({ value: customer.id, label: `${customer.fullName} · ${customer.phone}` }))} required />{customerId && <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2"><div><p className="text-xs text-amber-800">{t("loyaltyBalance")}</p><strong className="text-lg text-amber-950">{loyalty.pointsBalance} {t("pointsUnit")}</strong><p className="text-xs text-amber-800">{t("equivalentTo")} {formatMoney(loyalty.pointsBalance * 10, locale)} {t("discountLabel")}</p></div><InputField label={t("redeemPointsOptional")} type="number" min="0" max={loyalty.pointsBalance} step="1" value={redeemPoints} onChange={(value) => setRedeemPoints(String(Math.min(loyalty.pointsBalance, Math.max(0, Math.floor(Number(value) || 0)))))} /></div>}{insuranceContracts.length > 0 && <div className="grid gap-3 rounded-xl border border-teal/20 bg-teal/5 p-3 sm:grid-cols-2"><SelectField label={t("insuranceContract")} value={insuranceContractId} onChange={setInsuranceContractId} options={[{ value: "", label: t("noInsurance") }, ...insuranceContracts.map((contract) => ({ value: contract.id, label: `${contract.name} · ${t("copay")} ${contract.copayBps / 100}%` }))]} /><InputField label={selectedInsurance?.memberNumberLabel ?? t("memberNumberOptional")} value={insuranceMemberNumber} onChange={setInsuranceMemberNumber} readOnly={!selectedInsurance} /><p className="sm:col-span-2 text-xs text-teal-900">{selectedInsurance ? `${t("patientShare")} ${formatMoney(totalMinor, locale)} · ${t("estimatedClaim")} ${formatMoney(Math.max(0, insuranceAdjustedMinor - totalMinor), locale)}` : t("selectContractForClaim")}</p></div>}{openTrips.length > 0 && <SelectField label={t("distributionTrip")} value={selectedTripId} onChange={selectTrip} options={[{ value: "", label: t("regularBranchSale") }, ...openTrips.map((trip) => ({ value: trip.id, label: `${trip.tripNumber} · ${trip.salesRepName} · ${trip.routeName}` }))]} />}{selectedTrip && <p className="-mt-2 rounded-lg bg-teal/5 p-2 text-xs text-teal-900">{t("tripInvoiceNotice")}</p>}{selectedTrip && !tripCartValid && <Notice>{t("tripCartInvalid")}</Notice>}{cart.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">{t("addLineToInvoice")}</p> : <div className="space-y-2">{cart.map((line, index) => { const service = serviceMap.get(line.serviceId); return <div key={`${index}-${line.serviceId}`} className="grid grid-cols-[1fr_.7fr_.5fr_auto] items-end gap-2 rounded-xl bg-slate-50 p-3"><SelectField label={t("serviceOrPackage")} value={line.serviceId} onChange={(value) => updateCart(index, { serviceId: value })} options={services.map((item) => ({ value: item.id, label: `${item.name} · ${formatMoney(item.priceMinor, locale)}` }))} required /><SelectField label={t("provider")} value={line.providerId} onChange={(value) => updateCart(index, { providerId: value })} options={[{ value: "", label: t("unspecified") }, ...context.providers.map((provider) => ({ value: provider.id, label: provider.fullName }))]} /><InputField label={t("quantity")} type="number" min="1" max="100" value={line.quantity} onChange={(value) => updateCart(index, { quantity: Number(value) })} required /><Button type="button" size="sm" variant="ghost" onClick={() => setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t("delete")}</Button><div className="col-span-full flex flex-wrap justify-between text-xs text-slate-500"><span>{service?.kind === "single" ? t("singleService") : `${t("package")} ${service?.sessionCount ?? 0} ${t("sessionsPerUnit")}`}</span><strong className="text-navy">{formatMoney((service?.priceMinor ?? 0) * line.quantity, locale)}</strong></div></div>; })}</div>}<div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3"><label className="min-w-64 flex-1"><span className="mb-1.5 block text-sm font-medium text-slate-700">{t("scanBarcodeOrSku")}</span><input value={scanValue} onChange={(event) => setScanValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addScannedProduct(); } }} placeholder={t("scanThenEnter")} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" /></label><Button type="button" variant="outline" onClick={addScannedProduct}>{t("addCode")}</Button><Button type="button" variant="outline" onClick={() => setCameraOpen(true)}><Camera size={16} /> {t("camera")}</Button></div>{productCart.length > 0 && <div className="space-y-2">{productCart.map((line, index) => { const productOptions = [...new Map(saleProducts.map((row) => [row.itemId, row])).values()]; const product = saleProducts.find((row) => row.itemId === line.inventoryItemId && row.warehouseId === line.warehouseId); const item = productOptions.find((row) => row.itemId === line.inventoryItemId); const warehousesForItem = saleProducts.filter((row) => row.itemId === line.inventoryItemId); const selectedUnit = item?.units?.find((unit) => unit.id === line.unitId); const factor = item ? unitFactor(item, line.unitId) : 1; const maxQty = product ? maxSellableQuantity(product.quantityOnHand, product.quantityScale, selectedUnit?.conversionFactor ?? 10 ** product.quantityScale) : 0; const linePrice = unitTierPrice(item, line.unitId, line.priceTier); return <div key={`stock-${index}-${line.inventoryItemId}`} className="grid grid-cols-[1fr_1fr_.5fr_auto] items-end gap-2 rounded-xl border border-teal/20 bg-teal/5 p-3"><SelectField label={t("inventoryItem")} value={line.inventoryItemId} onChange={(value) => { const next = saleProducts.find((row) => row.itemId === value && row.quantityOnHand > 0) ?? saleProducts.find((row) => row.itemId === value); updateProductCart(index, { inventoryItemId: value, warehouseId: next?.warehouseId ?? "", quantity: 1 }); }} options={productOptions.map((row) => ({ value: row.itemId, label: `${row.name}${row.variantSize || row.variantColor ? ` · ${[row.variantSize, row.variantColor].filter(Boolean).join(" / ")}` : ""} · ${row.sku} · ${formatMoney(unitTierPrice(row, null, priceTierSelection), locale)}` }))} required /><SelectField label={t("deductionWarehouse")} value={line.warehouseId} onChange={(value) => updateProductCart(index, { warehouseId: value })} options={warehousesForItem.map((row) => ({ value: row.warehouseId, label: `${row.warehouseName} · ${t("available")} ${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: row.quantityScale }).format(row.quantityOnHand / (10 ** row.quantityScale))}` }))} required />{item?.units?.length ? <SelectField label={t("sellingUnit")} value={line.unitId ?? ""} onChange={(value) => updateProductCart(index, { unitId: value || null, quantity: 1 })} options={item.units.map((unit) => ({ value: unit.id, label: `${unit.name} × ${unit.conversionFactor}` }))} /> : null}<InputField label={`${t("quantity")} (${item?.units?.find((unit) => unit.id === line.unitId)?.name ?? item?.unitCode ?? t("unit")})`} type="number" min={1 / factor} max={maxQty || undefined} step={1 / factor} value={line.quantity} onChange={(value) => updateProductCart(index, { quantity: Number(value) })} required /><Button type="button" size="sm" variant="ghost" onClick={() => setProductCart((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t("delete")}</Button><div className="col-span-full flex justify-between text-xs text-slate-600"><span>{product?.warehouseName ?? t("chooseWarehouse")} · {product ? `${t("availableBalance")} ${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: product.quantityScale }).format(maxQty)} ${selectedUnit?.name ?? product.unitCode}` : t("unavailable")}</span><strong className="text-navy">{formatMoney(Math.round(linePrice * line.quantity), locale)}</strong></div></div>; })}</div>}      <div className="grid gap-3 sm:grid-cols-2"><InputField label={t("discountPounds")} type="number" min="0" step="0.01" value={discount} onChange={setDiscount} /><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{t("totalAfterDiscount")}</p><strong className="mt-1 block text-lg text-navy">{formatMoney(totalMinor, locale)}</strong></div></div><section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3"><label className="flex items-center gap-2 text-sm font-semibold text-navy"><input type="checkbox" checked={installmentEnabled} onChange={(event) => setInstallmentEnabled(event.target.checked)} /> {t("installmentSale")}</label>{installmentEnabled && <><div className="grid gap-2 sm:grid-cols-3"><InputField label={t("downPaymentPounds")} type="number" min="0" step="0.01" value={installmentDownPayment} onChange={setInstallmentDownPayment} /><InputField label={t("interestPercent")} type="number" min="0" max="100" step="0.01" value={(Number(installmentInterestBps || 0) / 100).toString()} onChange={(value) => setInstallmentInterestBps(String(Math.round(Number(value || 0) * 100)))} /><InputField label={t("adminFeePounds")} type="number" min="0" step="0.01" value={installmentAdminFee} onChange={setInstallmentAdminFee} /></div><div className="grid gap-2 sm:grid-cols-3"><InputField label={t("installmentCount")} type="number" min="1" max="60" step="1" value={installmentCount} onChange={setInstallmentCount} /><SelectField label={t("frequency")} value={installmentFrequency} onChange={(value) => setInstallmentFrequency(value as "weekly" | "monthly")} options={[{ value: "weekly", label: t("weekly") }, { value: "monthly", label: t("monthly") }]} /><InputField label={t("firstDueDate")} type="date" value={installmentFirstDueDate} onChange={setInstallmentFirstDueDate} /></div><InputField label={t("contractNotesOptional")} value={installmentNotes} onChange={setInstallmentNotes} /><p className="text-xs leading-5 text-amber-900">{t("installmentDescription")}</p></>}</section><section className="grid grid-cols-2 gap-2 rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-sm sm:grid-cols-4"><div><span className="block text-xs text-slate-600">{t("principalAmount")}</span><strong>{formatMoney(principalMinor, locale)}</strong></div><div><span className="block text-xs text-slate-600">{t("adminFeesAmount")}</span><strong>{formatMoney(adminFeeMinor, locale)}</strong></div><div><span className="block text-xs text-slate-600">{t("interestAmount")}</span><strong>{formatMoney(interestFeeMinor, locale)}</strong></div><div><span className="block text-xs text-slate-600">{t("grandTotalAmount")}</span><strong>{formatMoney(totalMinor, locale)}</strong></div></section><section className="space-y-3 rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-navy">{t("paymentMethods")}</h3><Button type="button" size="sm" variant="outline" onClick={() => setPayments((current) => [...current, { amount: "", method: "cash", reference: "" }])}><Plus size={14} /> {t("otherPayment")}</Button></div>{payments.map((payment, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><InputField label={t("amount")} type="number" min="0" step="0.01" value={payment.amount} onChange={(value) => updatePayment(index, { amount: value })} /><SelectField label={t("method")} value={payment.method} onChange={(value) => updatePayment(index, { method: value as PayLine["method"] })} options={paymentOptions} /><InputField label={t("paymentReferenceOptional")} value={payment.reference} onChange={(value) => updatePayment(index, { reference: value })} /><Button type="button" size="sm" variant="ghost" onClick={() => setPayments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t("delete")}</Button></div>)}</section><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-slate-600">{t("paid")}: {formatMoney(paidMinor, locale)} · {t("remaining")}: {formatMoney(remainingMinor, locale)}</span><span className={overpaymentMinor > 0 ? "font-semibold text-rose-700" : paymentComplete ? "font-semibold text-emerald-700" : "text-amber-700"}>{overpaymentMinor > 0 ? `${t("overpaymentBy")} ${formatMoney(overpaymentMinor, locale)}` : paymentComplete ? t("paymentComplete") : t("partialPayment")}</span></div><Button className="w-full" disabled={busy || (!cart.length && !productCart.length) || overpaymentMinor > 0 || !tripCartValid} type="submit"><ReceiptText size={17} /> {busy ? t("issuingInvoice") : paymentComplete ? t("issuePaidInvoice") : t("issueUnpaidInvoice")}</Button>{cameraOpen && <BarcodeCamera onDetected={(code) => scanProduct(code)} onClose={() => setCameraOpen(false)} />}</form>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-4 flex items-center gap-2 font-bold text-navy"><ClipboardList size={19} className="text-teal" /> {t("recentInvoices")}</h2>{recentInvoices.length ? <div className="space-y-2">{recentInvoices.map((invoice) => <article key={invoice.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3"><div className="min-w-40 flex-1"><strong className="text-sm text-navy">{invoice.invoiceNumber}</strong>{invoice.syncStatus === "pending_sync" && <span className="mr-2 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">{invoice.status === "needs_attention" ? t("needsReview") : t("pendingSync")}</span>}<p className="mt-1 text-xs text-slate-500">{invoice.customerName} · {formatDate(invoice.createdAt, true, locale)}</p>{invoice.syncIssue && <p className="mt-1 text-xs text-amber-800">{invoice.syncIssue}</p>}</div><div className="text-left"><strong className="block text-sm text-navy">{formatMoney(invoice.totalMinor, locale)}</strong><span className="text-xs text-slate-500">{t("paid")} {formatMoney(invoice.paidMinor, locale)}</span></div>{invoice.syncStatus !== "pending_sync" && invoice.paidMinor < invoice.totalMinor && invoice.status !== "void" && <Button size="sm" onClick={() => { setPayingInvoice(invoice); setPaymentAmount(((invoice.totalMinor - invoice.paidMinor) / 100).toFixed(2)); setPaymentReference(""); }}><Check size={15} /> {t("recordPayment")}</Button>}<Button size="sm" variant="outline" onClick={() => setReceipt(invoice)}><ReceiptText size={15} /> {t("receipt")}</Button></article>)}</div> : <p className="text-sm text-slate-500">{t("noInvoicesForBranch")}</p>}</section></div>
      <aside className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-4 flex items-center gap-2 font-bold text-navy"><Wallet size={19} className="text-teal" /> {t("cashShift")}</h2>{shift ? <form onSubmit={closeShift} className="space-y-4"><div className="rounded-xl bg-emerald-50 p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-emerald-900">{t("openShiftStatus")}</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">{t("running")}</span></div><p className="mt-2 text-xs text-emerald-800">{t("startedAt")} {formatDate(shift.openedAt, true, locale)}</p><p className="mt-1 text-sm text-emerald-900">{t("openingBalance")}: {formatMoney(shift.openingCashMinor, locale)}</p></div><InputField label={t("cashInDrawerAtClose")} type="number" min="0" step="0.01" value={countedCash} onChange={setCountedCash} required /><div className="grid gap-2 sm:grid-cols-3"><InputField label={t("matchedCards")} type="number" min="0" step="0.01" value={countedElectronic.card} onChange={(value) => setCountedElectronic((old) => ({ ...old, card: value }))} /><InputField label={t("matchedWallets")} type="number" min="0" step="0.01" value={countedElectronic.wallet} onChange={(value) => setCountedElectronic((old) => ({ ...old, wallet: value }))} /><InputField label={t("matchedInstapay")} type="number" min="0" step="0.01" value={countedElectronic.instapay} onChange={(value) => setCountedElectronic((old) => ({ ...old, instapay: value }))} /></div><InputField label={t("shiftNotes")} value={notes} onChange={setNotes} /><div className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">{t("shiftExpectedCashDescription")}</div><Button className="w-full" disabled={busy} type="submit"><Check size={17} />{t("closeAndReconcile")}</Button></form> : <form onSubmit={openShift} className="space-y-4"><p className="text-sm leading-6 text-slate-600">{t("noOpenShift")}</p><InputField label={t("openingCashBalance")} type="number" min="0" step="0.01" value={openingCash} onChange={setOpeningCash} required /><InputField label={t("notes")} value={notes} onChange={setNotes} /><Button className="w-full" disabled={busy} type="submit"><Plus size={17} /> {t("openShift")}</Button></form>}</section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-3 font-bold text-navy">{t("closedShiftsHistory")}</h3>{history.length ? <div className="space-y-2">{history.slice(0, 10).map((item) => <article key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="flex justify-between gap-2"><strong className="text-navy">{formatDate(item.openedAt, true, locale)}</strong><span className="text-xs text-slate-500">{item.closedAt ? formatDate(item.closedAt, true, locale) : ""}</span></div><p className="mt-1 text-xs text-slate-600">{t("expected")} {formatMoney(item.expectedCashMinor, locale)} · {t("counted")} {formatMoney(item.countedCashMinor, locale)} · {t("difference")} {formatMoney(item.cashDifferenceMinor, locale)}</p><p className="mt-1 text-xs text-slate-500">{t("electronicPayments")} {formatMoney(item.electronicTotalMinor, locale)}</p>{item.lines?.map((line) => <p key={line.paymentMethod} className="mt-1 text-[11px] text-slate-500">{paymentLabel(line.paymentMethod)}: {t("expected")} {formatMoney(line.expectedMinor, locale)} · {t("matched")} {formatMoney(line.collectedMinor, locale)} · {t("difference")} {formatMoney(line.differenceMinor, locale)} · {line.invoiceCount} {t("invoices")}</p>)}</article>)}</div> : <p className="text-sm text-slate-500">{t("noClosedShifts")}</p>}</section></aside></div>}
    {payingInvoice && <Modal title={`${t("recordPayment")} ${payingInvoice.invoiceNumber}`} onClose={() => setPayingInvoice(null)}><form onSubmit={recordInvoicePayment} className="space-y-4"><p className="rounded-xl bg-slate-50 p-3 text-sm">{t("remaining")}: <strong>{formatMoney(payingInvoice.totalMinor - payingInvoice.paidMinor, locale)}</strong> · {t("manualPaymentVerification")}</p><InputField label={t("receivedAmountPounds")} type="number" min="0.01" max={(payingInvoice.totalMinor - payingInvoice.paidMinor) / 100} step="0.01" value={paymentAmount} onChange={setPaymentAmount} required /><SelectField label={t("collectionMethod")} value={paymentMethod} onChange={(value) => setPaymentMethod(value as PayLine["method"])} options={paymentOptions} /><InputField label={t("transferReferenceOptional")} value={paymentReference} onChange={setPaymentReference} /><div className="flex gap-2"><Button type="submit" disabled={busy || Number(paymentAmount) <= 0 || Math.round(Number(paymentAmount) * 100) > payingInvoice.totalMinor - payingInvoice.paidMinor}>{busy ? t("recording") : t("confirmPayment")}</Button><Button type="button" variant="outline" onClick={() => setPayingInvoice(null)}>{t("cancel")}</Button></div></form></Modal>}
    {receipt && <Modal title={`${t("receipt")} ${receipt.invoiceNumber}`} onClose={() => setReceipt(null)}><div className="receipt-print space-y-3 text-sm"><div className="border-b border-dashed border-slate-300 pb-3 text-center"><p className="font-bold text-navy" dir="ltr">{PRODUCT_NAME}</p><p className="mt-1 text-xs text-slate-500">{t("taxReceipt")}</p></div><div className="flex justify-between"><span>{t("invoiceNumber")}</span><strong>{receipt.invoiceNumber}</strong></div><div className="flex justify-between"><span>{t("customer")}</span><strong>{receipt.customerName}</strong></div><div className="flex justify-between"><span>{t("date")}</span><span>{formatDate(receipt.createdAt, true, locale)}</span></div><div className="border-y border-dashed border-slate-300 py-2">{receipt.items.map((item, index) => <div key={index} className="flex justify-between py-1"><span>{item.description} × {new Intl.NumberFormat(intlLocale, { maximumFractionDigits: item.quantityScale }).format(item.quantity / (10 ** item.quantityScale))}</span><strong>{formatMoney(item.lineTotalMinor, locale)}</strong></div>)}</div><div className="flex justify-between"><span>{t("total")}</span><strong>{formatMoney(receipt.totalMinor, locale)}</strong></div><div className="flex justify-between"><span>{t("paid")}</span><strong>{formatMoney(receipt.paidMinor, locale)}</strong></div><div className="flex justify-between"><span>{t("remaining")}</span><strong>{formatMoney(receipt.totalMinor - receipt.paidMinor, locale)}</strong></div><div className="space-y-1 border-t border-slate-200 pt-2">{receipt.payments.map((item, index) => <div key={index} className={`flex justify-between text-xs ${item.reversedAt ? "text-rose-700 line-through" : ""}`}><span>{paymentLabel(item.paymentMethod)}{item.reversedAt ? ` · ${t("reversed")}${item.reversalReason ? ` (${item.reversalReason})` : ""}` : ""} · {item.reference || t("noReference")}</span><strong>{formatMoney(item.amountMinor, locale)}</strong></div>)}</div>{context.invoiceTerms && <section dir="auto" className="whitespace-pre-wrap border-t border-slate-200 pt-3 text-xs leading-5"><strong>{t("invoiceTerms")}</strong><p>{context.invoiceTerms}</p></section>}{context.invoiceNotes && <section dir="auto" className="whitespace-pre-wrap text-center text-xs leading-5"><strong>{t("invoiceNotes")}</strong><p>{context.invoiceNotes}</p></section>}<div className="flex flex-wrap gap-2 print:hidden"><Button onClick={() => window.print()}><Printer size={16} /> {t("printReceipt")}</Button>{receipt.customerPhone && buildWhatsAppWebUrl(receipt.customerPhone, receiptWhatsAppMessage) && <a href={buildWhatsAppWebUrl(receipt.customerPhone, receiptWhatsAppMessage) ?? undefined} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"><MessageCircle size={16} /> {t("sendViaWhatsApp")}</a>}<Button variant="outline" onClick={() => setReceipt(null)}>{t("close")}</Button></div></div></Modal>}
    {selectedQuotation && <Modal title={`${t("quotation")} ${selectedQuotation.quoteNumber}`} onClose={() => setSelectedQuotation(null)}><div className="space-y-4"><p className="rounded-xl bg-slate-50 p-3 text-sm">{t("quotationSavedNoStock")} {selectedQuotation.validUntil ? formatDate(selectedQuotation.validUntil, false, locale) : "—"}.</p><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => printQuotation(selectedQuotation, businessName, printCopy, locale)}><Printer size={16} />{t("printSavePdf")}</Button><Button type="button" disabled={busy || selectedQuotation.status !== "issued"} onClick={() => void convertQuotation(selectedQuotation)}>{t("convertToConfirmedInvoice")}</Button><Button type="button" variant="outline" onClick={() => setSelectedQuotation(null)}>{t("close")}</Button></div></div></Modal>}
  </section>;
}
