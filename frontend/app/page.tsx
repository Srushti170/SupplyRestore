"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Boxes, Check, CircleDollarSign,
  Cloud, FileCheck2, Gauge, LoaderCircle, Network, Play, RotateCcw, Route, ShieldCheck,
  ShoppingCart, Sparkles, Timer, Truck, Warehouse, X,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Candidate = { id: string; label: string; cost: number; carbon: number; delay_hours: number; score: number; feasible: boolean; infeasible_reason?: string | null; vendor_id?: string | null; vendor_name?: string | null; vendor_reliability?: number | null; route_id?: string };
type Comparison = { candidates: Candidate[]; recommended?: string; reason?: string };
type Event = { type: string; timestamp: string; content: { title?: string; message?: string; tool?: string; output?: Record<string, any> } };
type Run = { id: string; status: string; provider: string; events: Event[]; verification?: { passed: boolean; checks: CheckResult[] }; state: State };
type CheckResult = { name: string; passed: boolean; detail: string };
type State = { warehouses: { id: string; name: string; inventory: Record<string, number> }[]; vendors: { id: string; name: string; reliability: number; unit_cost: number; lead_time_hours: number; blocked: boolean }[]; routes: { id: string; from: string; to: string; status: string; lead_time_hours: number }[]; shipments: { id: string; product: string; qty: number; status: string }[]; metrics: Record<string, number> };

const defaults = { min_fulfilment_pct: 100, max_extra_cost: 500, max_extra_carbon: 100, max_delay_hours: 8 };

const eventStyle: Record<string, { color: string; icon: typeof Activity }> = {
  goal: { color: "#73e6aa", icon: ShieldCheck }, monitor: { color: "#7db7ff", icon: Activity },
  detection: { color: "#ffb35c", icon: AlertTriangle }, investigation: { color: "#b29aff", icon: Network },
  comparison: { color: "#f2cf68", icon: Gauge }, action: { color: "#68dbe0", icon: Truck },
  decision: { color: "#b29aff", icon: Sparkles },
  disruption: { color: "#ff6b6b", icon: X }, verification: { color: "#f59eaa", icon: FileCheck2 },
  replan: { color: "#ff9f6e", icon: RotateCcw }, certificate: { color: "#54e090", icon: BadgeCheck },
  infeasible: { color: "#ffb35c", icon: AlertTriangle },
  error: { color: "#ff6b6b", icon: AlertTriangle },
};

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#203b31] bg-[#0c1915]/90 shadow-[0_16px_60px_rgba(0,0,0,.18)] ${className}`}>{children}</section>;
}

function Metric({ icon: Icon, label, value, unit }: { icon: typeof Timer; label: string; value: string | number; unit?: string }) {
  return <div className="rounded-xl border border-[#20382f] bg-[#0a1512] p-3.5">
    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-[#7f9c90]"><Icon size={14} />{label}</div>
    <div className="font-mono text-xl font-semibold text-white">{value}<span className="ml-1 text-xs font-normal text-[#718a80]">{unit}</span></div>
  </div>;
}

export default function Home() {
  const [form, setForm] = useState(defaults);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agentMode, setAgentMode] = useState<"checking" | "live_ai" | "local_deterministic" | "offline">("checking");
  const [resultOpen, setResultOpen] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const startingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const runActive = loading || run?.status === "running";

  const comparisons = useMemo(() => {
    const all = (run?.events || []).filter(event => event.type === "comparison" && Array.isArray(event.content.output?.candidates)).map(event => event.content.output as Comparison);
    return all.length > 2 ? [all[0], all[all.length - 1]] : all;
  }, [run]);
  const runStatusLabel = run?.status === "verified" ? "Recovery verified" : run?.status === "infeasible" ? "Recovery infeasible" : run?.status === "failed" ? "Run failed" : "Recovery running";
  const finalRecovery = useMemo(() => {
    if (run?.status !== "verified") return null;
    const action = [...run.events].reverse().find(event => event.type === "action" && event.content.output?.action_id && !event.content.output?.error);
    if (!action) return null;
    if (action.content.tool === "create_purchase_order") {
      const vendorId = String((action.content as any).input?.vendor_id || "");
      const vendor = run.state.vendors.find(item => item.id === vendorId);
      const route = run.state.routes.find(item => item.id === "R-VN");
      return {
        method: "Emergency purchase order",
        supplier: vendor ? `${vendor.name} (${vendor.id})` : vendorId,
        reliability: vendor ? `${Math.round(vendor.reliability * 100)}% reliability` : "Eligible supplier",
        path: `${vendor?.name || vendorId} → ${route?.id || "R-VN"} → North Fulfilment Hub`,
        why: "Selected as the feasible recovery option after transfer route R-SN closed.",
      };
    }
    const routeId = String((action.content as any).input?.route_id || "");
    return {
      method: "Inter-warehouse transfer",
      supplier: "South Reserve Hub",
      reliability: "Internal inventory source",
      path: `South Reserve Hub → ${routeId} → North Fulfilment Hub`,
      why: "Selected for the lowest contract-normalized cost, carbon, and delay score.",
    };
  }, [run]);

  useEffect(() => {
    fetch(`${API}/health`).then(response => response.ok ? response.json() : Promise.reject()).then(data => setAgentMode(data.agent_mode)).catch(() => setAgentMode("offline"));
  }, []);

  useEffect(() => {
    if (!run?.id || run.status !== "running") return;
    const timer = setInterval(async () => {
      const response = await fetch(`${API}/runs/${run.id}`);
      if (response.ok) setRun(await response.json());
    }, 1500);
    return () => clearInterval(timer);
  }, [run?.id, run?.status]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
  }, [run?.events.length]);

  useEffect(() => {
    if (run && run.status !== "running" && dismissedRunId !== run.id) setResultOpen(true);
  }, [run?.id, run?.status, dismissedRunId]);

  useEffect(() => {
    if (!resultOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setResultOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [resultOpen]);

  async function startRun() {
    if (startingRef.current || run?.status === "running") return;
    startingRef.current = true;
    setLoading(true); setError(""); setRun(null); setResultOpen(false); setDismissedRunId(null);
    try {
      const resetResponse = await fetch(`${API}/reset`, { method: "POST" });
      if (!resetResponse.ok) {
        const resetError = await resetResponse.json();
        throw new Error(resetError.detail || "Could not reset the recovery environment");
      }
      const contractResponse = await fetch(`${API}/contracts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!contractResponse.ok) throw new Error("Could not create Recovery Contract");
      const contract = await contractResponse.json();
      const runResponse = await fetch(`${API}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contract_id: contract.id }) });
      const started = await runResponse.json();
      if (!runResponse.ok) throw new Error(started.detail || "Run failed to start");
      const detail = await fetch(`${API}/runs/${started.id}`);
      setRun(await detail.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unexpected error"); }
    finally { startingRef.current = false; setLoading(false); }
  }

  return <main className="relative mx-auto max-w-[1500px] px-5 py-5 lg:px-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#1c332a] pb-5">
      <div className="flex items-center gap-3.5">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#56e39a] text-[#052117] shadow-[0_0_32px_rgba(86,227,154,.22)]"><Boxes size={24} strokeWidth={2.4} /></div>
        <div><div className="flex items-center gap-2"><h1 className="text-xl font-bold tracking-tight">SupplyRestore</h1><span className="rounded-full border border-[#2e5545] bg-[#10241c] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#66dda0]">Control room</span></div><p className="text-sm text-[#789186]">From disruption to verified recovery.</p></div>
      </div>
      <div className="flex items-center gap-3 text-xs text-[#88a298]"><span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${agentMode === "live_ai" ? "animate-pulse bg-[#56e39a]" : agentMode === "offline" ? "bg-red-500" : "bg-amber-400"}`} />{agentMode === "live_ai" ? "AI agent connected" : agentMode === "local_deterministic" ? "Local agent ready" : agentMode === "offline" ? "Backend offline" : "Checking agent…"}</span><span className="h-4 w-px bg-[#2a4138]" /><span className="font-mono">Live operations</span></div>
    </header>

    <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Panel className="p-5">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#5cdd99]">Recovery contract</p><h2 className="mt-1 text-lg font-semibold">Operating guardrails</h2></div><ShieldCheck className="text-[#4ad58e]" size={22} /></div>
          <div className="space-y-4">
            {[
              ["min_fulfilment_pct", "Minimum fulfilment", "%"], ["max_extra_cost", "Maximum extra cost", "$"],
              ["max_extra_carbon", "Maximum carbon", "kg"], ["max_delay_hours", "Maximum delay", "hours"],
            ].map(([key, label, unit]) => <label className="block" key={key}><span className="mb-1.5 flex justify-between text-xs text-[#91a99f]"><span>{label}</span><span>{unit}</span></span><input type="number" value={form[key as keyof typeof form]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} className="w-full rounded-lg border border-[#284238] bg-[#08130f] px-3 py-2.5 font-mono text-sm outline-none transition focus:border-[#50d895]" /></label>)}
            <button onClick={startRun} disabled={runActive} aria-busy={runActive} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-sm font-bold text-[#062117] transition hover:bg-[#73ecad] disabled:cursor-not-allowed disabled:opacity-60">{runActive ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} fill="currentColor" />}{runActive ? "Recovery in progress…" : "Start recovery"}</button>
            {error && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</p>}
          </div>
        </Panel>
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><h3 className="text-sm font-semibold">Live network</h3><Network size={16} className="text-[#6a8b7d]" /></div>
          <div className="p-3">
            {(run?.state.routes || []).map(route => <div key={route.id} className="mb-2 flex items-center gap-3 rounded-xl bg-[#091510] p-3 last:mb-0"><div className={`h-2.5 w-2.5 rounded-full ${route.status === "open" ? "bg-[#4edb91]" : "bg-[#ff6868] shadow-[0_0_12px_#ff686866]"}`} /><div className="min-w-0 flex-1"><div className="font-mono text-xs font-semibold">{route.id}</div><div className="truncate text-[11px] text-[#6e897d]">{route.from} → {route.to}</div></div><span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${route.status === "open" ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>{route.status}</span></div>)}
            {!run && <div className="py-8 text-center text-xs text-[#627b70]"><Route className="mx-auto mb-2" size={22} />Network appears when a run starts</div>}
          </div>
        </Panel>
      </div>

      <div className="min-w-0 space-y-5">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#68897b]">Autonomous execution</p><h2 className="mt-0.5 font-semibold">Recovery timeline</h2></div>{run && <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${run.status === "verified" ? "bg-emerald-900/40 text-emerald-300" : run.status === "infeasible" ? "bg-amber-900/40 text-amber-300" : run.status === "failed" ? "bg-red-900/40 text-red-300" : "bg-blue-900/40 text-blue-300"}`}>{runStatusLabel}</span>}</div>
          <div ref={timelineRef} className="max-h-[620px] min-h-[420px] overflow-y-auto p-5">
            {!run ? <div className="grid min-h-[380px] place-items-center text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-[#29493c] bg-[#10241c]"><Sparkles className="text-[#56e39a]" size={24} /></div><h3 className="font-semibold">Ready to restore supply</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#70897e]">Set the operating guardrails and start a run. Every decision, action, failure, and verification will appear here.</p></div></div> :
              <div>{run.events.map((event, index) => {
                const style = eventStyle[event.type] || eventStyle.monitor; const Icon = style.icon;
                return <div key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">{index < run.events.length - 1 && <div className="absolute left-[15px] top-8 h-[calc(100%-20px)] w-px bg-[#284137]" />}<div className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-[#0b1813]" style={{ borderColor: `${style.color}66`, color: style.color }}><Icon size={15} /></div><div className="min-w-0 flex-1 rounded-xl border border-[#1c352b] bg-[#09140f] p-3.5"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: style.color }}>{event.type}</span><h4 className="mt-0.5 text-sm font-semibold">{event.content.title || event.content.tool}</h4></div><time className="whitespace-nowrap font-mono text-[10px] text-[#587166]">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>{event.content.message && <p className="mt-2 text-xs leading-5 text-[#8ca399]">{event.content.message}</p>}{event.type === "verification" && event.content.output && <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${event.content.output.passed ? "bg-emerald-950/50 text-emerald-300" : "bg-red-950/45 text-red-300"}`}>{event.content.output.passed ? <Check size={14} /> : <X size={14} />}{String(event.content.output.detail)}</div>}</div></div>;
              })}{run.status === "running" && <div className="ml-12 flex items-center gap-2.5 rounded-xl border border-[#274338] bg-[#0c1b15] px-3.5 py-3 text-xs text-[#8da79b]"><LoaderCircle className="animate-spin text-[#56e39a]" size={15} /><span>Agent is processing the next step…</span></div>}</div>}
          </div>
        </Panel>

        {comparisons.length > 0 && <Panel className="p-5">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#f2cf68]">Deterministic optimizer</p><h3 className="mt-1 font-semibold">Decision evolution</h3><p className="mt-1 text-xs text-[#6f887d]">Why the recovery plan changed after the disruption</p></div><Gauge className="text-[#f2cf68]" size={20} /></div>
          <div className={`grid gap-3 ${comparisons.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {comparisons.map((comparison, stageIndex) => <div key={stageIndex} className="overflow-hidden rounded-xl border border-[#263f35] bg-[#09140f]">
              <div className="flex items-center justify-between border-b border-[#20372e] px-4 py-3">
                <div className="flex items-center gap-3"><span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-bold ${stageIndex === 0 ? "bg-[#26382e] text-[#b2c7bd]" : "bg-[#1d4934] text-[#68e6a4]"}`}>0{stageIndex + 1}</span><div><p className="text-xs font-semibold">{stageIndex === 0 ? "Initial decision" : "Recovery replan"}</p><p className="mt-0.5 text-[10px] text-[#6d867b]">{stageIndex === 0 ? "Before route disruption" : "After route R-SN closed"}</p></div></div>
                {stageIndex > 0 && <span className="rounded-full bg-[#42251d] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ffa57e]">Replanned</span>}
              </div>
              <div className="space-y-2 p-3">{comparison.candidates.map(candidate => { const selected = comparison.recommended === candidate.id; return <div key={candidate.id} className={`rounded-lg border px-3 py-3 ${selected ? "border-[#3b9d69] bg-[#10271d]" : !candidate.feasible ? "border-[#56332f] bg-[#211412]" : "border-[#263a32] bg-[#0c1813]"}`}>
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-2.5">{candidate.id === "transfer" ? <Truck className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} /> : <ShoppingCart className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} />}<div className="min-w-0"><p className="truncate text-xs font-semibold">{candidate.label}</p>{candidate.id === "purchase" && candidate.vendor_name && <p className="mt-0.5 truncate text-[10px] font-medium text-[#9bb5a9]">Supplier · {candidate.vendor_name} ({candidate.vendor_id})</p>}<p className="mt-1 font-mono text-[10px] text-[#789085]">${candidate.cost} · {candidate.carbon}kg · {candidate.delay_hours}h</p></div></div>
                  <div className="shrink-0 text-right">{selected ? <span className="rounded bg-[#56e39a] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#052117]">Selected</span> : !candidate.feasible ? <span className="rounded bg-[#5b2b25] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ff9d8b]">Unavailable</span> : <span className="font-mono text-[11px] text-[#82998f]">{candidate.score.toFixed(4)}</span>}{!candidate.feasible && <p className="mt-1.5 max-w-[135px] text-[9px] leading-3 text-[#d48778]">{candidate.infeasible_reason || "Contract constraint violated"}</p>}</div></div>
              </div>})}</div>
              <div className="border-t border-[#20372e] px-4 py-3 text-[10px] leading-4 text-[#718a7f]">{comparison.reason}</div>
            </div>)}
          </div>
        </Panel>}
      </div>

      <div className="space-y-5">
        <Panel className="p-5"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">Operational state</h3><Warehouse size={17} className="text-[#789287]" /></div><div className="grid grid-cols-2 gap-2"><Metric icon={Boxes} label="North SKU-100" value={run?.state.warehouses.find(w => w.id === "WH-NORTH")?.inventory["SKU-100"] ?? "—"} unit="units" /><Metric icon={Truck} label="South SKU-100" value={run?.state.warehouses.find(w => w.id === "WH-SOUTH")?.inventory["SKU-100"] ?? "—"} unit="units" /><Metric icon={CircleDollarSign} label="Extra cost" value={run ? `$${run.state.metrics.extra_cost}` : "—"} /><Metric icon={Cloud} label="Carbon" value={run?.state.metrics.extra_carbon ?? "—"} unit="kg" /></div></Panel>
        <Panel className="overflow-hidden"><div className="border-b border-[#203b31] px-5 py-4"><h3 className="text-sm font-semibold">Supply partners</h3></div><div className="space-y-2 p-3">{(run?.state.vendors || []).map(v => <div key={v.id} className="rounded-xl bg-[#091510] p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{v.name}</span><span className="font-mono text-xs text-[#5bdfa0]">{Math.round(v.reliability * 100)}%</span></div><div className="mt-2 flex justify-between text-[10px] text-[#6e887c]"><span>${v.unit_cost}/unit</span><span>{v.lead_time_hours}h lead time</span></div></div>)}{!run && <p className="py-5 text-center text-xs text-[#627b70]">Awaiting network scan</p>}</div></Panel>
        {run && run.status !== "running" && <button onClick={() => setResultOpen(true)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition hover:-translate-y-0.5 ${run.status === "verified" ? "border-[#347855] bg-[#10271d] text-[#71e9ab]" : run.status === "infeasible" ? "border-[#76572b] bg-amber-950/25 text-amber-200" : "border-red-900/60 bg-red-950/25 text-red-300"}`}><span><span className="block text-[9px] font-bold uppercase tracking-[.15em] opacity-70">Recovery result</span><span className="mt-0.5 block text-xs font-semibold">View verification certificate</span></span><FileCheck2 size={19} /></button>}
      </div>
    </div>

    {run && resultOpen && run.status !== "running" && <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recovery-result-title">
      <div className={`relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-[#0b1813] shadow-[0_28px_100px_rgba(0,0,0,.65)] ${run.status === "verified" ? "border-[#3a8f61]" : run.status === "infeasible" ? "border-[#83602e]" : "border-red-900"}`}>
        <button onClick={() => { setResultOpen(false); setDismissedRunId(run.id); }} aria-label="Close recovery result" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-[#30473e] bg-[#101f19] text-[#91a99f] transition hover:border-[#547264] hover:text-white"><X size={17} /></button>
        <div className={`px-6 pb-5 pt-7 text-center ${run.status === "verified" ? "bg-[radial-gradient(circle_at_top,rgba(60,207,134,.16),transparent_70%)]" : run.status === "infeasible" ? "bg-[radial-gradient(circle_at_top,rgba(245,158,11,.14),transparent_70%)]" : "bg-[radial-gradient(circle_at_top,rgba(239,68,68,.12),transparent_70%)]"}`}>
          <div className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full ${run.status === "verified" ? "bg-[#56e39a] text-[#062117] shadow-[0_0_35px_rgba(86,227,154,.24)]" : run.status === "infeasible" ? "bg-amber-900/70 text-amber-300" : "bg-red-950 text-red-300"}`}>{run.status === "verified" ? <BadgeCheck size={29} /> : run.status === "infeasible" ? <AlertTriangle size={27} /> : <X size={27} />}</div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#799287]">Verification certificate</p>
          <h2 id="recovery-result-title" className="mt-1 text-2xl font-bold tracking-tight">{run.status === "verified" ? "Recovery accomplished" : run.status === "infeasible" ? "Recovery infeasible" : "Recovery could not be completed"}</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#829a8f]">{run.status === "verified" ? "The selected recovery path passed every active contract check." : run.status === "infeasible" ? "The application completed its analysis, but no available option satisfies every active guardrail." : "The workflow stopped before a verified recovery could be produced."}</p>
        </div>

        {finalRecovery && <div className="mx-5 rounded-xl border border-[#2c6047] bg-[#0e241a] p-4">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#62dfa0]"><Route size={13} />Final recovery path</div>
          <p className="text-sm font-semibold leading-5 text-white">{finalRecovery.path}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-[#09150f] px-3 py-2.5"><p className="text-[9px] uppercase tracking-wider text-[#607b6e]">Supplier selected</p><p className="mt-1 text-xs font-semibold text-[#d4e5dc]">{finalRecovery.supplier}</p><p className="mt-0.5 text-[10px] text-[#708b7e]">{finalRecovery.reliability}</p></div><div className="rounded-lg bg-[#09150f] px-3 py-2.5"><p className="text-[9px] uppercase tracking-wider text-[#607b6e]">Recovery method</p><p className="mt-1 text-xs font-semibold text-[#d4e5dc]">{finalRecovery.method}</p></div></div>
          <p className="mt-3 border-l-2 border-[#4fcf8e] pl-2.5 text-[10px] leading-4 text-[#8da79a]"><span className="font-semibold text-[#c0d4ca]">Why selected: </span>{finalRecovery.why}</p>
        </div>}

        <div className="p-5"><p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#708a7f]">Contract checks</p>{run.verification?.checks ? <div className="grid gap-2 sm:grid-cols-2">{run.verification.checks.map(check => <div key={check.name} className="flex gap-2.5 rounded-lg border border-[#20372e] bg-[#09140f] p-3"><div className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.passed ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}`}>{check.passed ? <Check size={12} /> : <X size={12} />}</div><div><p className="text-xs font-medium">{check.name}</p><p className="mt-0.5 text-[10px] leading-4 text-[#71897f]">{check.detail}</p></div></div>)}</div> : <p className="rounded-lg bg-red-950/25 p-3 text-xs text-red-300">Verification evidence was not completed. Review the final timeline event for details.</p>}</div>
        <div className={`flex items-center justify-between border-t px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] ${run.status === "verified" ? "border-[#28503e] bg-[#10271d] text-[#6be6a6]" : run.status === "infeasible" ? "border-[#5c4529] bg-amber-950/25 text-amber-200" : "border-red-900/50 bg-red-950/20 text-red-300"}`}><span>{run.status === "verified" ? "All evidence complete" : run.status === "infeasible" ? "Analysis complete · constraints unmet" : "Action required"}</span>{run.status === "verified" ? <BadgeCheck size={17} /> : <AlertTriangle size={16} />}</div>
      </div>
    </div>}
  </main>;
}
