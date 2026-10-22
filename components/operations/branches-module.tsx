"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, MapPinned, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useDataLocale } from "@/components/operations/data-portability-ui";
import { localizedBranchName } from "@/lib/i18n/branch-name";
import { apiRequest, InputField, Loading, ModuleTitle, Notice, SelectField, useAction, useLoad } from "@/components/operations/shared";

type Branch = { id: string; name: string; nameAr: string; nameEn: string; address: string | null; phone: string | null; mapUrl: string | null; isActive: boolean };
type BranchResult = { branches: Branch[] };
type Staff = { id: string; fullName: string; email: string; role: string; isActive: boolean };
type MembershipResult = { staff: Staff[]; memberships: Array<{ userId: string; branchId: string }> };

export function BranchesModule() {
  const t = useTranslations("settings-whatsapp");
  const { locale } = useDataLocale();
  const roleNames: Record<string, string> = { admin: t("branches.roles.admin"), receptionist: t("branches.roles.receptionist"), reception: t("branches.roles.reception"), doctor: t("branches.roles.doctor"), specialist: t("branches.roles.specialist"), provider: t("branches.roles.provider"), storekeeper: t("branches.roles.storekeeper") };
  const { data, error: loadError, loading, reload } = useLoad<BranchResult>("/api/ops/branches");
  const { data: accessData, error: accessLoadError, loading: accessLoading, reload: reloadAccess } = useLoad<MembershipResult>("/api/ops/branch-memberships");
  const action = useAction();
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [staffId, setStaffId] = useState("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [editingBranchId, setEditingBranchId] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const assigned = useMemo(() => new Set(accessData?.memberships.filter((item) => item.userId === staffId).map((item) => item.branchId) ?? []), [accessData?.memberships, staffId]);
  const sortedBranches = useMemo(() => [...(data?.branches ?? [])].sort((a, b) => localizedBranchName(a, locale).localeCompare(localizedBranchName(b, locale), locale)), [data?.branches, locale]);

  useEffect(() => {
    if (!staffId && accessData?.staff.length) setStaffId(accessData.staff[0]!.id);
  }, [accessData?.staff, staffId]);
  useEffect(() => { setBranchIds([...assigned]); }, [assigned]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest<{ branch: Branch }>("/api/ops/branches", {
      method: "POST",
      body: JSON.stringify({ nameAr, nameEn, address: address || null, phone: phone || null, mapUrl: mapUrl || null }),
    }), t("branches.created"));
    if (result) {
      setNameAr(""); setNameEn(""); setAddress(""); setPhone(""); setMapUrl("");
      await Promise.all([reload(), reloadAccess()]);
    }
  }

  async function saveNames(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest<{ branch: Branch }>("/api/ops/branches", {
      method: "PATCH",
      body: JSON.stringify({ id, nameAr: editNameAr, nameEn: editNameEn }),
    }), t("branches.namesSaved"));
    if (result) {
      setEditingBranchId("");
      await reload();
    }
  }

  async function saveMemberships(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/branch-memberships", {
      method: "PUT",
      body: JSON.stringify({ userId: staffId, branchIds }),
    }), t("branches.membershipsSaved"));
    if (result) await reloadAccess();
  }

  function toggleBranch(id: string) {
    setBranchIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function beginEdit(branch: Branch) {
    setEditingBranchId(branch.id);
    setEditNameAr(branch.nameAr || branch.name);
    setEditNameEn(branch.nameEn || "");
    action.setError(""); action.setSuccess("");
  }

  return <section>
    <ModuleTitle eyebrow={t("branches.eyebrow")} title={t("branches.title")} description={t("branches.description")} />
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-6">
        <form onSubmit={create} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 font-bold text-navy"><Building2 size={18} className="text-teal" />{t("branches.addBranch")}</h2>
          <InputField label={t("branches.nameAr")} value={nameAr} onChange={setNameAr} required lang="ar-EG" dir="rtl" />
          <InputField label={t("branches.nameEn")} value={nameEn} onChange={setNameEn} required lang="en-GB" dir="ltr" />
          <InputField label={t("branches.address")} value={address} onChange={setAddress} />
          <InputField label={t("branches.phone")} value={phone} onChange={setPhone} type="tel" />
          <InputField label={t("branches.mapUrl")} value={mapUrl} onChange={setMapUrl} type="url" />
          <Button disabled={action.busy} type="submit"><Plus size={17} />{t("branches.saveBranch")}</Button>
          {action.error && <Notice>{action.error}</Notice>}{action.success && <Notice kind="success">{action.success}</Notice>}
        </form>

        <form onSubmit={saveMemberships} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 font-bold text-navy"><ShieldCheck size={18} className="text-teal" />{t("branches.memberships")}</h2>
          {accessLoadError && <Notice>{accessLoadError}</Notice>}
          {accessLoading ? <Loading /> : accessData?.staff.length ? <>
            <SelectField label={t("branches.employee")} value={staffId} onChange={setStaffId} options={accessData.staff.filter((staff) => staff.isActive).map((staff) => ({ value: staff.id, label: `${staff.fullName} · ${roleNames[staff.role] ?? staff.role}` }))} required />
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{t("branches.allowedBranches")}</p>
              {sortedBranches.filter((branch) => branch.isActive).map((branch) => <label key={branch.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm hover:bg-slate-50"><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} className="size-4 accent-teal" /><span>{localizedBranchName(branch, locale)}</span>{assigned.has(branch.id) && <span className="ms-auto text-xs text-teal">{t("branches.currentlySaved")}</span>}</label>)}
              {!data?.branches.length && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{t("branches.addFirst")}</p>}
            </div>
            <Button disabled={action.busy || !staffId} type="submit"><Users size={16} />{t("branches.saveMemberships")}</Button>
          </> : <p className="text-sm text-slate-500">{t("branches.noActiveEmployees")}</p>}
        </form>
      </div>

      <div className="space-y-3">
        {loadError && <Notice>{loadError}</Notice>}
        {loading ? <Loading /> : sortedBranches.length ? sortedBranches.map((branch) => <article key={branch.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"><span className="grid size-11 place-items-center rounded-xl bg-teal/10 text-teal"><Building2 /></span><div className="min-w-0 flex-1"><h3 className="font-semibold text-navy">{localizedBranchName(branch, locale)}</h3><p className="mt-1 text-sm text-slate-500">{branch.address || t("branches.addressMissing")}{branch.phone ? ` · ${branch.phone}` : ""}</p>{branch.nameEn === `Branch ${branch.id}` && <p className="mt-1 text-xs text-amber-700">{t("branches.translationMissing")}</p>}</div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">{t("branches.active")}</span><Button variant="outline" size="sm" onClick={() => beginEdit(branch)}>{t("branches.editNames")}</Button><a className="inline-flex items-center gap-1 text-sm font-semibold text-teal" href={`/queue/${branch.id}`} target="_blank" rel="noreferrer"><MapPinned size={16} />{t("branches.queueScreen")}</a>{editingBranchId === branch.id && <form onSubmit={(event) => void saveNames(event, branch.id)} className="grid w-full gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><InputField label={t("branches.nameAr")} value={editNameAr} onChange={setEditNameAr} required lang="ar-EG" dir="rtl" /><InputField label={t("branches.nameEn")} value={editNameEn} onChange={setEditNameEn} required lang="en-GB" dir="ltr" /><div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={action.busy}>{t("branches.saveNames")}</Button><Button type="button" variant="outline" onClick={() => setEditingBranchId("")}>{t("branches.cancelEdit")}</Button></div>{action.error && <div className="sm:col-span-2"><Notice>{action.error}</Notice></div>}</form>}</article>) : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><Building2 className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-navy">{t("branches.noBranches")}</p><p className="mt-1 text-sm text-slate-500">{t("branches.addFirstForScheduling")}</p></div>}
        <Button variant="outline" size="sm" onClick={() => void Promise.all([reload(), reloadAccess()])}><RefreshCw size={15} />{t("branches.refresh")}</Button>
      </div>
    </div>
  </section>;
}
