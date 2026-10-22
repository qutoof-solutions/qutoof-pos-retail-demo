"use client";

import { useState } from "react";
import { Plus, RefreshCw, ShieldCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { apiRequest, InputField, Loading, ModuleTitle, Notice, SelectField, useAction, useLoad } from "@/components/operations/shared";
import { STAFF_ASSIGNABLE_ROLES } from "@/lib/operations/permissions";

type TeamRole = (typeof STAFF_ASSIGNABLE_ROLES)[number];
type TeamMember = { id: string; fullName: string; email: string; role: TeamRole | "business_admin" | "owner" | "super_admin"; isActive: boolean; createdAt: string | Date; lastLoginAt?: string | Date | null };
type TeamForm = { fullName: string; email: string; role: TeamRole; password: string };
const initial: TeamForm = { fullName: "", email: "", role: "receptionist", password: "" };

export function TeamModule() {
  const t = useTranslations("settings-whatsapp");
  const roleLabels: Record<TeamRole | "business_admin" | "owner" | "super_admin", string> = { business_admin: t("team.roles.businessAdmin"), owner: t("team.roles.owner"), admin: t("team.roles.admin"), reception: t("team.roles.reception"), receptionist: t("team.roles.receptionist"), provider: t("team.roles.provider"), doctor: t("team.roles.doctor"), specialist: t("team.roles.specialist"), storekeeper: t("team.roles.storekeeper"), nurse: t("team.roles.nurse"), super_admin: t("team.roles.superAdmin") };
  const choices = STAFF_ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleLabels[role] }));
  const { data, error, loading, reload } = useLoad<{ team: TeamMember[] }>("/api/ops/team");
  const [form, setForm] = useState(initial);
  const [showCreate, setShowCreate] = useState(false);
  const action = useAction();
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.execute(() => apiRequest("/api/ops/team", { method: "POST", body: JSON.stringify(form) }), t("team.created"));
    if (result) { setForm(initial); setShowCreate(false); await reload(); }
  }
  async function setActive(member: TeamMember) {
    const active = !member.isActive;
    if (!window.confirm(`${active ? t("team.confirmReactivate") : t("team.confirmDeactivate")} «${member.fullName}»؟ ${t("team.confirmNoDelete")}`)) return;
    const result = await action.execute(() => apiRequest(`/api/ops/team/${member.id}`, { method: "PATCH", body: JSON.stringify({ isActive: active }) }), active ? t("team.activated") : t("team.deactivated"));
    if (result) await reload();
  }
  return <section><ModuleTitle eyebrow={t("team.eyebrow")} title={t("team.title")} description={t("team.description")} action={<Button onClick={() => setShowCreate((value) => !value)}><Plus size={17} />{t("team.addEmployee")}</Button>} />
    {error && <Notice>{error}</Notice>}{action.error && <Notice>{action.error}</Notice>}{action.success && <Notice kind="success">{action.success}</Notice>}
    <div className="mb-5 rounded-2xl border border-teal/20 bg-teal/5 p-4 text-sm leading-7 text-slate-700"><div className="flex items-center gap-2 font-semibold text-navy"><ShieldCheck size={18} />{t("team.permissionsNotes")}</div><p className="mt-1">{t("team.permissionsHelp")}</p><p>{t("team.passwordHelp")}</p></div>
    {showCreate && <form onSubmit={create} className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-2"><InputField label={t("team.fullName")} value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} required /><InputField label={t("team.email")} value={form.email} onChange={(value) => setForm({ ...form, email: value })} type="email" required /><SelectField label={t("team.role")} value={form.role} onChange={(value) => setForm({ ...form, role: value as TeamRole })} options={choices} required /><InputField label={t("team.password")} value={form.password} onChange={(value) => setForm({ ...form, password: value })} type="password" required /><div className="flex gap-2 md:col-span-2"><Button disabled={action.busy} type="submit">{action.busy ? t("team.creating") : t("team.create")}</Button><Button variant="outline" type="button" onClick={() => setShowCreate(false)}>{t("team.cancel")}</Button></div></form>}
    {loading ? <Loading /> : data?.team.length ? <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[720px] text-right text-sm"><thead className="bg-canvas text-slate-600"><tr><th className="p-4">{t("team.employee")}</th><th className="p-4">{t("team.role")}</th><th className="p-4">{t("team.status")}</th><th className="p-4">{t("team.action")}</th></tr></thead><tbody>{data.team.map((member) => <tr key={member.id} className="border-t border-slate-100"><td className="p-4"><strong className="block text-navy">{member.fullName}</strong><span className="text-xs text-slate-500">{member.email}</span></td><td className="p-4">{roleLabels[member.role]}</td><td className="p-4"><span className={`rounded-full px-3 py-1 text-xs ${member.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{member.isActive ? t("team.active") : t("team.inactive")}</span></td><td className="p-4">{member.role !== "business_admin" && member.role !== "owner" && <Button size="sm" variant="outline" disabled={action.busy} onClick={() => void setActive(member)}>{member.isActive ? <><UserRoundX size={15} /> {t("team.deactivate")}</> : <><UserRoundCheck size={15} /> {t("team.activate")}</>}</Button>}</td></tr>)}</tbody></table></div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{t("team.empty")}</div>}
    <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}><RefreshCw size={15} />{t("team.refresh")}</Button>
  </section>;
}
