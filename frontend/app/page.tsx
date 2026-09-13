"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Boxes, Check, CircleDollarSign,
  Cloud, FileCheck2, Gauge, LoaderCircle, LockKeyhole, LogIn, LogOut, MapPin, Network,
  Play, Plus, RotateCcw, Route, ShieldCheck, ShoppingCart, Sparkles, Timer, Truck, User,
  UserPlus, Warehouse, X, Languages,
} from "lucide-react";
import { CHECK_LABELS, COPY, EVENT_LABELS, Locale, TOOL_LABELS } from "./i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const LiveNetworkMap = dynamic(() => import("./LiveNetworkMap"), { ssr: false });

type Candidate = { id: string; label: string; cost: number; carbon: number; delay_hours: number; score: number; feasible: boolean; infeasible_reason?: string | null; vendor_id?: string | null; vendor_name?: string | null; vendor_reliability?: number | null; route_id?: string };
type Comparison = { candidates: Candidate[]; recommended?: string; reason?: string };
type Event = { type: string; timestamp: string; content: { title?: string; message?: string; tool?: string; output?: Record<string, any> } };
type Run = { id: string; status: string; provider: string; events: Event[]; verification?: { passed: boolean; checks: CheckResult[] }; state: State };
type CheckResult = { name: string; passed: boolean; detail: string };
type State = { warehouses: { id: string; name: string; inventory: Record<string, number> }[]; vendors: { id: string; name: string; reliability: number; unit_cost: number; lead_time_hours: number; blocked: boolean }[]; routes: { id: string; from: string; to: string; status: string; lead_time_hours: number }[]; shipments: { id: string; product: string; qty: number; status: string }[]; metrics: Record<string, number> };
type AccountWarehouse = { id: number; name: string; location: string };
type WarehouseUser = { id: number; name: string; username: string; warehouse_name: string; warehouse_location: string; warehouses: AccountWarehouse[] };

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
  const [locale, setLocale] = useState<Locale>("en");
  const [authStatus, setAuthStatus] = useState<"checking" | "signed_out" | "signed_in">("checking");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<WarehouseUser | null>(null);
  const [activeWarehouseId, setActiveWarehouseId] = useState<number | null>(null);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState("");
  const [warehouseForm, setWarehouseForm] = useState({ name: "", location: "" });
  const [authForm, setAuthForm] = useState({ name: "", username: "", password: "", warehouse_name: "", warehouse_location: "" });
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
  const text = COPY[locale];
  const activeWarehouse = user?.warehouses?.find(warehouse => warehouse.id === activeWarehouseId) || user?.warehouses?.[0];

  const comparisons = useMemo(() => {
    const all = (run?.events || []).filter(event => event.type === "comparison" && Array.isArray(event.content.output?.candidates)).map(event => event.content.output as Comparison);
    return all.length > 2 ? [all[0], all[all.length - 1]] : all;
  }, [run]);
  const runStatusLabel = run?.status === "verified" ? text.verified : run?.status === "infeasible" ? text.infeasible : run?.status === "failed" ? text.failed : text.running;
  const finalRecovery = useMemo(() => {
    if (run?.status !== "verified") return null;
    const action = [...run.events].reverse().find(event => event.type === "action" && event.content.output?.action_id && !event.content.output?.error);
    if (!action) return null;
    if (action.content.tool === "create_purchase_order") {
      const vendorId = String((action.content as any).input?.vendor_id || "");
      const vendor = run.state.vendors.find(item => item.id === vendorId);
      const route = run.state.routes.find(item => item.id === "R-VN");
      return {
        method: text.purchase,
        supplier: vendor ? `${vendor.name} (${vendor.id})` : vendorId,
        reliability: vendor ? `${Math.round(vendor.reliability * 100)}%` : text.supplier,
        path: `${vendor?.name || vendorId} → ${route?.id || "R-VN"} → North Fulfilment Hub`,
        why: locale === "hi" ? "ट्रांसफर मार्ग R-SN बंद होने के बाद यह अनुबंध-अनुकूल विकल्प था।" : locale === "mr" ? "हस्तांतरण मार्ग R-SN बंद झाल्यानंतर हा करार-अनुकूल पर्याय होता." : "Selected as the feasible recovery option after transfer route R-SN closed.",
      };
    }
    const routeId = String((action.content as any).input?.route_id || "");
    return {
      method: text.transfer,
      supplier: "South Reserve Hub",
      reliability: locale === "hi" ? "आंतरिक इन्वेंटरी स्रोत" : locale === "mr" ? "अंतर्गत साठा स्रोत" : "Internal inventory source",
      path: `South Reserve Hub → ${routeId} → North Fulfilment Hub`,
      why: locale === "hi" ? "सबसे कम अनुबंध-अनुकूल लागत, कार्बन और देरी स्कोर के कारण चयनित।" : locale === "mr" ? "सर्वात कमी करार-अनुकूल खर्च, कार्बन आणि विलंब गुणामुळे निवडले." : "Selected for the lowest contract-normalized cost, carbon, and delay score.",
    };
  }, [run, locale, text.purchase, text.supplier, text.transfer]);

  const localizedReason = (reason?: string | null) => {
    if (!reason || locale === "en") return reason || text.constraintViolation;
    const reasons: Record<string, { hi: string; mr: string }> = {
      "Route R-SN is closed": { hi: "मार्ग R-SN बंद है", mr: "मार्ग R-SN बंद आहे" },
      "Route is prohibited by the contract": { hi: "अनुबंध में मार्ग प्रतिबंधित है", mr: "करारामध्ये मार्ग प्रतिबंधित आहे" },
      "Insufficient reserve stock": { hi: "आरक्षित स्टॉक अपर्याप्त है", mr: "राखीव साठा अपुरा आहे" },
      "No eligible vendor meets the policy": { hi: "कोई पात्र विक्रेता नीति पूरी नहीं करता", mr: "कोणताही पात्र विक्रेता धोरण पूर्ण करत नाही" },
      "Vendor delivery route is closed": { hi: "विक्रेता डिलीवरी मार्ग बंद है", mr: "विक्रेता वितरण मार्ग बंद आहे" },
      "Vendor route is prohibited by the contract": { hi: "अनुबंध में विक्रेता मार्ग प्रतिबंधित है", mr: "करारामध्ये विक्रेता मार्ग प्रतिबंधित आहे" },
      "Exceeds cost limit": { hi: "लागत सीमा से अधिक", mr: "खर्च मर्यादेपेक्षा अधिक" },
      "Exceeds carbon limit": { hi: "कार्बन सीमा से अधिक", mr: "कार्बन मर्यादेपेक्षा अधिक" },
      "Exceeds delay limit": { hi: "देरी सीमा से अधिक", mr: "विलंब मर्यादेपेक्षा अधिक" },
      "Contract constraint violated": { hi: "अनुबंध सीमा का उल्लंघन", mr: "करार मर्यादेचे उल्लंघन" },
    };
    return reasons[reason]?.[locale] || reason;
  };

  const localizedEventTitle = (event: Event) => {
    if (event.content.tool) return TOOL_LABELS[locale][event.content.tool] || event.content.title || event.content.tool;
    if (event.type === "goal") return text.goalTitle;
    if (event.type === "disruption") return text.disruptionTitle;
    if (event.type === "replan") return text.replanTitle;
    if (event.type === "infeasible") return text.infeasibleTitle;
    if (event.type === "decision") return event.content.title?.toLowerCase().includes("alternate") ? text.alternateTitle : text.decisionTitle;
    return event.content.title || EVENT_LABELS[locale][event.type] || event.type;
  };

  const localizedEventMessage = (event: Event) => {
    if (event.type === "goal") return text.goalMessage;
    if (event.type === "disruption") return text.disruptionMessage;
    if (event.type === "replan") return text.replanMessage;
    if (event.type === "decision") return text.decisionMessage;
    if (event.type === "infeasible") return text.infeasibleBody;
    return event.content.message;
  };

  const localizedCheckDetail = (detail: string) => {
    if (locale === "en") return detail;
    const exact: Record<string, { hi: string; mr: string }> = {
      "No prohibited route was used": { hi: "किसी प्रतिबंधित मार्ग का उपयोग नहीं हुआ", mr: "कोणताही प्रतिबंधित मार्ग वापरला नाही" },
      "A prohibited route was used": { hi: "एक प्रतिबंधित मार्ग का उपयोग हुआ", mr: "प्रतिबंधित मार्ग वापरला गेला" },
      "No blocked vendor was used": { hi: "किसी प्रतिबंधित विक्रेता का उपयोग नहीं हुआ", mr: "कोणताही प्रतिबंधित विक्रेता वापरला नाही" },
      "A blocked vendor was used": { hi: "एक प्रतिबंधित विक्रेता का उपयोग हुआ", mr: "प्रतिबंधित विक्रेता वापरला गेला" },
      "Observed inventory and delivery effect matches the action.": { hi: "देखा गया इन्वेंटरी और डिलीवरी प्रभाव कार्रवाई से मेल खाता है।", mr: "निरीक्षणातील साठा आणि वितरण परिणाम कृतीशी जुळतो." },
    };
    if (exact[detail]) return exact[detail][locale];
    if (detail.includes("available; minimum")) return detail.replace("available; minimum", locale === "hi" ? "उपलब्ध; न्यूनतम" : "उपलब्ध; किमान");
    if (detail.includes(" limit")) return detail.replace(" of ", " / ").replace(" limit", locale === "hi" ? " सीमा" : " मर्यादा");
    if (detail.includes("closed mid-transfer")) return locale === "hi" ? "मार्ग ट्रांसफर के दौरान बंद हुआ; इन्वेंटरी स्रोत पर वापस कर दी गई।" : "मार्ग हस्तांतरणादरम्यान बंद झाला; साठा स्रोताकडे परत केला.";
    return detail;
  };

  useEffect(() => {
    const saved = window.localStorage.getItem("supplyrestore-language") as Locale | null;
    if (saved && saved in COPY) setLocale(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("supplyrestore-language", locale);
    document.documentElement.lang = locale === "en" ? "en" : locale === "hi" ? "hi" : "mr";
  }, [locale]);

  useEffect(() => {
    const token = window.localStorage.getItem("supplyrestore-session");
    if (!token) { setAuthStatus("signed_out"); return; }
    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(account => { setUser(account); setActiveWarehouseId(account.warehouses?.[0]?.id ?? null); setAuthStatus("signed_in"); })
      .catch(() => { window.localStorage.removeItem("supplyrestore-session"); setAuthStatus("signed_out"); });
  }, []);

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

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLoading) return;
    setAuthLoading(true); setAuthError("");
    try {
      const payload = authMode === "login"
        ? { username: authForm.username.trim(), password: authForm.password }
        : { ...authForm, name: authForm.name.trim(), username: authForm.username.trim(), warehouse_name: authForm.warehouse_name.trim(), warehouse_location: authForm.warehouse_location.trim() };
      const response = await fetch(`${API}/auth/${authMode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        const message = typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? result.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(" · ") : "Could not authenticate this warehouse account";
        throw new Error(message);
      }
      window.localStorage.setItem("supplyrestore-session", result.token);
      setUser(result.user); setActiveWarehouseId(result.user.warehouses?.[0]?.id ?? null); setAuthStatus("signed_in"); setAuthForm({ name: "", username: "", password: "", warehouse_name: "", warehouse_location: "" });
    } catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Authentication failed"); }
    finally { setAuthLoading(false); }
  }

  async function signOut() {
    const token = window.localStorage.getItem("supplyrestore-session");
    if (token) await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    window.localStorage.removeItem("supplyrestore-session");
    setUser(null); setActiveWarehouseId(null); setRun(null); setAuthStatus("signed_out"); setAuthMode("login");
  }

  async function addWarehouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (warehouseLoading) return;
    setWarehouseLoading(true); setWarehouseError("");
    try {
      const token = window.localStorage.getItem("supplyrestore-session");
      const response = await fetch(`${API}/warehouses`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(warehouseForm) });
      const result = await response.json();
      if (!response.ok) {
        const message = typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? result.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(" · ") : "Could not add warehouse";
        throw new Error(message);
      }
      const newest = result.warehouses[result.warehouses.length - 1];
      setUser(result); setActiveWarehouseId(newest.id); setWarehouseForm({ name: "", location: "" }); setWarehouseOpen(false);
    } catch (cause) { setWarehouseError(cause instanceof Error ? cause.message : "Could not add warehouse"); }
    finally { setWarehouseLoading(false); }
  }

  if (authStatus === "checking") return <main className="grid min-h-screen place-items-center"><div className="flex items-center gap-3 text-sm text-[#93aa9f]"><LoaderCircle className="animate-spin text-[#56e39a]" size={20} />{text.checkingAgent}</div></main>;

  if (authStatus === "signed_out") return <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10">
    <div className="absolute right-5 top-5"><label className="flex items-center gap-2 rounded-lg border border-[#294239] bg-[#0b1813] px-2.5 py-1.5"><Languages size={14} className="text-[#62dca0]" /><select aria-label="Language" value={locale} onChange={event => setLocale(event.target.value as Locale)} className="bg-transparent text-xs font-semibold text-[#c1d4cb] outline-none"><option className="bg-white text-black" value="en">English</option><option className="bg-white text-black" value="hi">हिन्दी</option><option className="bg-white text-black" value="mr">मराठी</option></select></label></div>
    <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-[#234235] bg-[#0a1712]/95 shadow-[0_30px_120px_rgba(0,0,0,.5)] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-[650px] overflow-hidden border-r border-[#234235] bg-[#0d2118] p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(86,227,154,.18),transparent_34%),radial-gradient(circle_at_80%_75%,rgba(68,126,255,.11),transparent_35%)]" />
        <div className="relative"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#56e39a] text-[#052117]"><Boxes size={26} /></div><div><h1 className="text-2xl font-bold">SupplyRestore</h1><p className="text-sm text-[#7d9a8d]">{text.tagline}</p></div></div></div>
        <div className="relative"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#61dfa0]">{text.secureWorkspace}</p><h2 className="mt-3 max-w-md text-4xl font-bold leading-tight">{text.welcomeBody}</h2><div className="mt-8 space-y-4 text-sm text-[#9bb2a7]">{[text.authFeatureOne, text.authFeatureTwo, text.authFeatureThree].map((feature, index) => <div key={feature} className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full border border-[#326148] bg-[#10291d] font-mono text-[10px] text-[#65e3a3]">0{index + 1}</span>{feature}</div>)}</div></div>
        <div className="relative flex items-center gap-2 text-xs text-[#607c6e]"><ShieldCheck size={15} />{text.recoveryContract}</div>
      </section>
      <section className="p-6 sm:p-10 lg:p-12">
        <div className="mb-8 lg:hidden"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#56e39a] text-[#052117]"><Boxes size={24} /></div><div><h1 className="text-xl font-bold">SupplyRestore</h1><p className="text-xs text-[#789186]">{text.tagline}</p></div></div></div>
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#5cdd99]">{text.welcome}</p>
        <h2 className="mt-2 text-2xl font-bold">{authMode === "login" ? text.login : text.signup}</h2>
        <p className="mt-2 text-sm leading-6 text-[#789187]">{text.welcomeBody}</p>
        <div className="mt-6 grid grid-cols-2 rounded-xl border border-[#294238] bg-[#08130f] p-1"><button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); }} className={`rounded-lg px-3 py-2.5 text-xs font-bold transition ${authMode === "login" ? "bg-[#183426] text-[#6fe5a8]" : "text-[#718b7f]"}`}>{text.login}</button><button type="button" onClick={() => { setAuthMode("signup"); setAuthError(""); }} className={`rounded-lg px-3 py-2.5 text-xs font-bold transition ${authMode === "signup" ? "bg-[#183426] text-[#6fe5a8]" : "text-[#718b7f]"}`}>{text.signup}</button></div>
        <form onSubmit={submitAuth} className="mt-6 space-y-4">
          {authMode === "signup" && <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.name}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><User size={16} className="text-[#628073]" /><input required minLength={2} autoComplete="name" value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label>}
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.username}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><User size={16} className="text-[#628073]" /><input required minLength={3} autoComplete="username" value={authForm.username} onChange={event => setAuthForm({ ...authForm, username: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label>
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.password}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><LockKeyhole size={16} className="text-[#628073]" /><input required minLength={6} type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label>
          {authMode === "signup" && <><label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseName}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Warehouse size={16} className="text-[#628073]" /><input required minLength={2} value={authForm.warehouse_name} onChange={event => setAuthForm({ ...authForm, warehouse_name: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label><label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseLocation}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><MapPin size={16} className="text-[#628073]" /><input required minLength={3} placeholder={text.locationHint} value={authForm.warehouse_location} onChange={event => setAuthForm({ ...authForm, warehouse_location: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#40594e]" /></div></label></>}
          {authError && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{authError}</p>}
          <button disabled={authLoading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-sm font-bold text-[#062117] transition hover:bg-[#73ecad] disabled:opacity-60">{authLoading ? <LoaderCircle className="animate-spin" size={17} /> : authMode === "login" ? <LogIn size={17} /> : <UserPlus size={17} />}{authLoading ? (authMode === "login" ? text.signingIn : text.creatingAccount) : (authMode === "login" ? text.login : text.signup)}</button>
        </form>
        <p className="mt-5 text-center text-xs text-[#71897e]">{authMode === "login" ? text.newAccount : text.existingAccount} <button type="button" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }} className="font-bold text-[#61dfa0] hover:underline">{authMode === "login" ? text.signup : text.login}</button></p>
      </section>
    </div>
  </main>;

  return <main className="relative mx-auto max-w-[1500px] px-5 py-5 lg:px-8">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#1c332a] pb-5">
      <div className="flex items-center gap-3.5">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#56e39a] text-[#052117] shadow-[0_0_32px_rgba(86,227,154,.22)]"><Boxes size={24} strokeWidth={2.4} /></div>
        <div><div className="flex items-center gap-2"><h1 className="text-xl font-bold tracking-tight">SupplyRestore</h1><span className="rounded-full border border-[#2e5545] bg-[#10241c] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#66dda0]">{text.controlRoom}</span></div><p className="text-sm text-[#789186]">{text.tagline}</p></div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-[#88a298]">
        <label className="flex items-center gap-2 rounded-lg border border-[#294239] bg-[#0b1813] px-2.5 py-1.5"><Languages size={14} className="text-[#62dca0]" /><select aria-label="Language" value={locale} onChange={event => setLocale(event.target.value as Locale)} className="bg-transparent text-xs font-semibold text-[#c1d4cb] outline-none"><option className="bg-white text-black" value="en">English</option><option className="bg-white text-black" value="hi">हिन्दी</option><option className="bg-white text-black" value="mr">मराठी</option></select></label>
        {user && <div className="flex items-center gap-2 rounded-lg border border-[#294239] bg-[#0b1813] px-2.5 py-1.5"><Warehouse size={14} className="shrink-0 text-[#62dca0]" />{user.warehouses?.length ? <select aria-label={text.signedInWarehouse} value={activeWarehouse?.id || ""} onChange={event => setActiveWarehouseId(Number(event.target.value))} className="max-w-[190px] bg-transparent text-xs font-semibold text-[#d5e5dd] outline-none">{user.warehouses.map(warehouse => <option className="bg-white text-black" key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.location}</option>)}</select> : <div className="max-w-[190px]"><p className="truncate text-[10px] font-bold text-[#d5e5dd]">{user.warehouse_name}</p><p className="truncate text-[9px] text-[#718b7f]">{user.warehouse_location}</p></div>}</div>}
        <button onClick={() => { setWarehouseError(""); setWarehouseOpen(true); }} className="flex items-center gap-1.5 rounded-lg border border-[#315442] bg-[#10241c] px-2.5 py-2 text-[10px] font-bold text-[#68e2a3] transition hover:border-[#54b781]"><Plus size={13} />{text.addWarehouse}</button>
        <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${agentMode === "live_ai" ? "animate-pulse bg-[#56e39a]" : agentMode === "offline" ? "bg-red-500" : "bg-amber-400"}`} />{agentMode === "live_ai" ? text.aiConnected : agentMode === "local_deterministic" ? text.localReady : agentMode === "offline" ? text.backendOffline : text.checkingAgent}</span><span className="h-4 w-px bg-[#2a4138]" /><span className="font-mono">{text.liveOperations}</span>
        <button onClick={signOut} title={text.logout} aria-label={text.logout} className="grid h-8 w-8 place-items-center rounded-lg border border-[#294239] bg-[#0b1813] text-[#88a298] transition hover:border-red-900 hover:text-red-300"><LogOut size={14} /></button>
      </div>
    </header>

    <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Panel className="p-5">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#5cdd99]">{text.recoveryContract}</p><h2 className="mt-1 text-lg font-semibold">{text.guardrails}</h2></div><ShieldCheck className="text-[#4ad58e]" size={22} /></div>
          <div className="space-y-4">
            {[
              ["min_fulfilment_pct", text.minFulfilment, "%"], ["max_extra_cost", text.maxCost, "$"],
              ["max_extra_carbon", text.maxCarbon, "kg"], ["max_delay_hours", text.maxDelay, "h"],
            ].map(([key, label, unit]) => <label className="block" key={key}><span className="mb-1.5 flex justify-between text-xs text-[#91a99f]"><span>{label}</span><span>{unit}</span></span><input type="number" value={form[key as keyof typeof form]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} className="w-full rounded-lg border border-[#284238] bg-[#08130f] px-3 py-2.5 font-mono text-sm outline-none transition focus:border-[#50d895]" /></label>)}
            <button onClick={startRun} disabled={runActive} aria-busy={runActive} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-sm font-bold text-[#062117] transition hover:bg-[#73ecad] disabled:cursor-not-allowed disabled:opacity-60">{runActive ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} fill="currentColor" />}{runActive ? text.recovering : text.start}</button>
            {error && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</p>}
          </div>
        </Panel>
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><div><h3 className="text-sm font-semibold">{text.liveNetwork}</h3><p className="mt-0.5 max-w-[280px] truncate text-[10px] text-[#698277]">{activeWarehouse?.name} · {activeWarehouse?.location}</p></div><Network size={16} className="text-[#6a8b7d]" /></div>
          <LiveNetworkMap warehouses={user?.warehouses || []} activeWarehouseId={activeWarehouseId} events={run?.events || []} runStatus={run?.status} labels={{ active: text.mapActive, warehouse: text.mapWarehouse, supplier: text.mapSupplier, available: text.availableRoute, selected: text.selectedPath, closed: text.closed, verified: text.mapVerified, simulated: text.simulationNote }} />
        </Panel>
      </div>

      <div className="min-w-0 space-y-5">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#68897b]">{text.autonomousExecution}</p><h2 className="mt-0.5 font-semibold">{text.timeline}</h2></div>{run && <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${run.status === "verified" ? "bg-emerald-900/40 text-emerald-300" : run.status === "infeasible" ? "bg-amber-900/40 text-amber-300" : run.status === "failed" ? "bg-red-900/40 text-red-300" : "bg-blue-900/40 text-blue-300"}`}>{runStatusLabel}</span>}</div>
          <div ref={timelineRef} className="max-h-[620px] min-h-[420px] overflow-y-auto p-5">
            {!run ? <div className="grid min-h-[380px] place-items-center text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-[#29493c] bg-[#10241c]"><Sparkles className="text-[#56e39a]" size={24} /></div><h3 className="font-semibold">{text.readyTitle}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#70897e]">{text.readyBody}</p></div></div> :
              <div>{run.events.map((event, index) => {
                const style = eventStyle[event.type] || eventStyle.monitor; const Icon = style.icon;
                return <div key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">{index < run.events.length - 1 && <div className="absolute left-[15px] top-8 h-[calc(100%-20px)] w-px bg-[#284137]" />}<div className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-[#0b1813]" style={{ borderColor: `${style.color}66`, color: style.color }}><Icon size={15} /></div><div className="min-w-0 flex-1 rounded-xl border border-[#1c352b] bg-[#09140f] p-3.5"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: style.color }}>{EVENT_LABELS[locale][event.type] || event.type}</span><h4 className="mt-0.5 text-sm font-semibold">{localizedEventTitle(event)}</h4></div><time className="whitespace-nowrap font-mono text-[10px] text-[#587166]">{new Date(event.timestamp).toLocaleTimeString(locale === "hi" ? "hi-IN" : locale === "mr" ? "mr-IN" : "en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>{localizedEventMessage(event) && <p className="mt-2 text-xs leading-5 text-[#8ca399]">{localizedEventMessage(event)}</p>}{event.type === "verification" && event.content.output && <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${event.content.output.passed ? "bg-emerald-950/50 text-emerald-300" : "bg-red-950/45 text-red-300"}`}>{event.content.output.passed ? <Check size={14} /> : <X size={14} />}{localizedCheckDetail(String(event.content.output.detail))}</div>}</div></div>;
              })}{run.status === "running" && <div className="ml-12 flex items-center gap-2.5 rounded-xl border border-[#274338] bg-[#0c1b15] px-3.5 py-3 text-xs text-[#8da79b]"><LoaderCircle className="animate-spin text-[#56e39a]" size={15} /><span>{text.processing}</span></div>}</div>}
          </div>
        </Panel>

        {comparisons.length > 0 && <Panel className="p-5">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#f2cf68]">{text.optimizer}</p><h3 className="mt-1 font-semibold">{text.evolution}</h3><p className="mt-1 text-xs text-[#6f887d]">{text.evolutionBody}</p></div><Gauge className="text-[#f2cf68]" size={20} /></div>
          <div className={`grid gap-3 ${comparisons.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {comparisons.map((comparison, stageIndex) => <div key={stageIndex} className="overflow-hidden rounded-xl border border-[#263f35] bg-[#09140f]">
              <div className="flex items-center justify-between border-b border-[#20372e] px-4 py-3">
                <div className="flex items-center gap-3"><span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-bold ${stageIndex === 0 ? "bg-[#26382e] text-[#b2c7bd]" : "bg-[#1d4934] text-[#68e6a4]"}`}>0{stageIndex + 1}</span><div><p className="text-xs font-semibold">{stageIndex === 0 ? text.initial : text.replan}</p><p className="mt-0.5 text-[10px] text-[#6d867b]">{stageIndex === 0 ? text.beforeDisruption : text.afterClosure}</p></div></div>
                {stageIndex > 0 && <span className="rounded-full bg-[#42251d] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ffa57e]">{text.replanned}</span>}
              </div>
              <div className="space-y-2 p-3">{comparison.candidates.map(candidate => { const selected = comparison.recommended === candidate.id; return <div key={candidate.id} className={`rounded-lg border px-3 py-3 ${selected ? "border-[#3b9d69] bg-[#10271d]" : !candidate.feasible ? "border-[#56332f] bg-[#211412]" : "border-[#263a32] bg-[#0c1813]"}`}>
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-2.5">{candidate.id === "transfer" ? <Truck className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} /> : <ShoppingCart className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} />}<div className="min-w-0"><p className="truncate text-xs font-semibold">{candidate.id === "transfer" ? text.transfer : text.purchase}</p>{candidate.id === "purchase" && candidate.vendor_name && <p className="mt-0.5 truncate text-[10px] font-medium text-[#9bb5a9]">{text.supplier} · {candidate.vendor_name} ({candidate.vendor_id})</p>}<p className="mt-1 font-mono text-[10px] text-[#789085]">${candidate.cost} · {candidate.carbon}kg · {candidate.delay_hours}h</p></div></div>
                  <div className="shrink-0 text-right">{selected ? <span className="rounded bg-[#56e39a] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#052117]">{text.selected}</span> : !candidate.feasible ? <span className="rounded bg-[#5b2b25] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ff9d8b]">{text.unavailable}</span> : <span className="font-mono text-[11px] text-[#82998f]">{candidate.score.toFixed(4)}</span>}{!candidate.feasible && <p className="mt-1.5 max-w-[135px] text-[9px] leading-3 text-[#d48778]">{localizedReason(candidate.infeasible_reason)}</p>}</div></div>
              </div>})}</div>
              <div className="border-t border-[#20372e] px-4 py-3 text-[10px] leading-4 text-[#718a7f]">{comparison.recommended ? `${comparison.recommended === "transfer" ? text.transfer : text.purchase} ${text.selectedReason} (${comparison.candidates.find(candidate => candidate.id === comparison.recommended)?.score.toFixed(4)}).` : text.noCandidate}</div>
            </div>)}
          </div>
        </Panel>}
      </div>

      <div className="space-y-5">
        <Panel className="p-5"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">{text.operationalState}</h3><Warehouse size={17} className="text-[#789287]" /></div><div className="grid grid-cols-2 gap-2"><Metric icon={Boxes} label={text.northStock} value={run?.state.warehouses.find(w => w.id === "WH-NORTH")?.inventory["SKU-100"] ?? "—"} unit={text.units} /><Metric icon={Truck} label={text.southStock} value={run?.state.warehouses.find(w => w.id === "WH-SOUTH")?.inventory["SKU-100"] ?? "—"} unit={text.units} /><Metric icon={CircleDollarSign} label={text.extraCost} value={run ? `$${run.state.metrics.extra_cost}` : "—"} /><Metric icon={Cloud} label={text.carbon} value={run?.state.metrics.extra_carbon ?? "—"} unit="kg" /></div></Panel>
        <Panel className="overflow-hidden"><div className="border-b border-[#203b31] px-5 py-4"><h3 className="text-sm font-semibold">{text.supplyPartners}</h3></div><div className="space-y-2 p-3">{(run?.state.vendors || []).map(v => <div key={v.id} className="rounded-xl bg-[#091510] p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{v.name}</span><span className="font-mono text-xs text-[#5bdfa0]">{Math.round(v.reliability * 100)}%</span></div><div className="mt-2 flex justify-between text-[10px] text-[#6e887c]"><span>${v.unit_cost}/{text.units}</span><span>{v.lead_time_hours}h {locale === "hi" ? "लीड टाइम" : locale === "mr" ? "वितरण वेळ" : "lead time"}</span></div></div>)}{!run && <p className="py-5 text-center text-xs text-[#627b70]">{text.awaitingScan}</p>}</div></Panel>
        {run && run.status !== "running" && <button onClick={() => setResultOpen(true)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition hover:-translate-y-0.5 ${run.status === "verified" ? "border-[#347855] bg-[#10271d] text-[#71e9ab]" : run.status === "infeasible" ? "border-[#76572b] bg-amber-950/25 text-amber-200" : "border-red-900/60 bg-red-950/25 text-red-300"}`}><span><span className="block text-[9px] font-bold uppercase tracking-[.15em] opacity-70">{text.recoveryResult}</span><span className="mt-0.5 block text-xs font-semibold">{text.viewCertificate}</span></span><FileCheck2 size={19} /></button>}
      </div>
    </div>

    {warehouseOpen && <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="add-warehouse-title">
      <div className="relative w-full max-w-md rounded-2xl border border-[#315442] bg-[#0b1813] p-6 shadow-[0_28px_100px_rgba(0,0,0,.65)]">
        <button onClick={() => setWarehouseOpen(false)} aria-label={text.cancel} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-[#30473e] bg-[#101f19] text-[#91a99f] hover:text-white"><X size={17} /></button>
        <div className="mb-5 flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173426] text-[#63e1a1]"><Warehouse size={20} /></div><div><h2 id="add-warehouse-title" className="text-lg font-bold">{text.addWarehouse}</h2><p className="mt-1 text-xs text-[#789187]">{text.addWarehouseBody}</p></div></div>
        {user && user.warehouses?.length > 0 && <div className="mb-5 rounded-xl border border-[#20382f] bg-[#08130f] p-3"><p className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#688579]">{text.yourWarehouses} · {user.warehouses.length}</p><div className="max-h-28 space-y-1 overflow-y-auto">{user.warehouses.map(warehouse => <div key={warehouse.id} className="flex items-center gap-2 text-xs text-[#9db2a8]"><MapPin size={12} className="shrink-0 text-[#5cd99a]" /><span className="font-semibold text-[#c9dbd2]">{warehouse.name}</span><span className="truncate text-[#678074]">· {warehouse.location}</span></div>)}</div></div>}
        <form onSubmit={addWarehouse} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseName}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Warehouse size={16} className="text-[#628073]" /><input required minLength={2} autoFocus value={warehouseForm.name} onChange={event => setWarehouseForm({ ...warehouseForm, name: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label>
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseLocation}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><MapPin size={16} className="text-[#628073]" /><input required minLength={3} placeholder={text.locationHint} value={warehouseForm.location} onChange={event => setWarehouseForm({ ...warehouseForm, location: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#40594e]" /></div></label>
          {warehouseError && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{warehouseError}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => setWarehouseOpen(false)} className="flex-1 rounded-lg border border-[#30483e] px-4 py-3 text-xs font-bold text-[#92a99e]">{text.cancel}</button><button disabled={warehouseLoading} className="flex flex-[1.4] items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-xs font-bold text-[#062117] disabled:opacity-60">{warehouseLoading ? <LoaderCircle className="animate-spin" size={15} /> : <Plus size={15} />}{warehouseLoading ? text.addingWarehouse : text.addWarehouse}</button></div>
        </form>
      </div>
    </div>}

    {run && resultOpen && run.status !== "running" && <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recovery-result-title">
      <div className={`relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-[#0b1813] shadow-[0_28px_100px_rgba(0,0,0,.65)] ${run.status === "verified" ? "border-[#3a8f61]" : run.status === "infeasible" ? "border-[#83602e]" : "border-red-900"}`}>
        <button onClick={() => { setResultOpen(false); setDismissedRunId(run.id); }} aria-label={text.closeResult} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-[#30473e] bg-[#101f19] text-[#91a99f] transition hover:border-[#547264] hover:text-white"><X size={17} /></button>
        <div className={`px-6 pb-5 pt-7 text-center ${run.status === "verified" ? "bg-[radial-gradient(circle_at_top,rgba(60,207,134,.16),transparent_70%)]" : run.status === "infeasible" ? "bg-[radial-gradient(circle_at_top,rgba(245,158,11,.14),transparent_70%)]" : "bg-[radial-gradient(circle_at_top,rgba(239,68,68,.12),transparent_70%)]"}`}>
          <div className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full ${run.status === "verified" ? "bg-[#56e39a] text-[#062117] shadow-[0_0_35px_rgba(86,227,154,.24)]" : run.status === "infeasible" ? "bg-amber-900/70 text-amber-300" : "bg-red-950 text-red-300"}`}>{run.status === "verified" ? <BadgeCheck size={29} /> : run.status === "infeasible" ? <AlertTriangle size={27} /> : <X size={27} />}</div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#799287]">{text.certificate}</p>
          <h2 id="recovery-result-title" className="mt-1 text-2xl font-bold tracking-tight">{run.status === "verified" ? text.accomplished : run.status === "infeasible" ? text.infeasible : text.couldNotComplete}</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#829a8f]">{run.status === "verified" ? text.successBody : run.status === "infeasible" ? text.infeasibleBody : text.failureBody}</p>
        </div>

        {finalRecovery && <div className="mx-5 rounded-xl border border-[#2c6047] bg-[#0e241a] p-4">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#62dfa0]"><Route size={13} />{text.finalPath}</div>
          <p className="text-sm font-semibold leading-5 text-white">{finalRecovery.path}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-[#09150f] px-3 py-2.5"><p className="text-[9px] uppercase tracking-wider text-[#607b6e]">{text.supplierSelected}</p><p className="mt-1 text-xs font-semibold text-[#d4e5dc]">{finalRecovery.supplier}</p><p className="mt-0.5 text-[10px] text-[#708b7e]">{finalRecovery.reliability}</p></div><div className="rounded-lg bg-[#09150f] px-3 py-2.5"><p className="text-[9px] uppercase tracking-wider text-[#607b6e]">{text.recoveryMethod}</p><p className="mt-1 text-xs font-semibold text-[#d4e5dc]">{finalRecovery.method}</p></div></div>
          <p className="mt-3 border-l-2 border-[#4fcf8e] pl-2.5 text-[10px] leading-4 text-[#8da79a]"><span className="font-semibold text-[#c0d4ca]">{text.whySelected}: </span>{finalRecovery.why}</p>
        </div>}

        <div className="p-5"><p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#708a7f]">{text.contractChecks}</p>{run.verification?.checks ? <div className="grid gap-2 sm:grid-cols-2">{run.verification.checks.map(check => <div key={check.name} className="flex gap-2.5 rounded-lg border border-[#20372e] bg-[#09140f] p-3"><div className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.passed ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}`}>{check.passed ? <Check size={12} /> : <X size={12} />}</div><div><p className="text-xs font-medium">{CHECK_LABELS[locale][check.name] || check.name}</p><p className="mt-0.5 text-[10px] leading-4 text-[#71897f]">{localizedCheckDetail(check.detail)}</p></div></div>)}</div> : <p className="rounded-lg bg-red-950/25 p-3 text-xs text-red-300">{text.noEvidence}</p>}</div>
        <div className={`flex items-center justify-between border-t px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] ${run.status === "verified" ? "border-[#28503e] bg-[#10271d] text-[#6be6a6]" : run.status === "infeasible" ? "border-[#5c4529] bg-amber-950/25 text-amber-200" : "border-red-900/50 bg-red-950/20 text-red-300"}`}><span>{run.status === "verified" ? text.evidenceComplete : run.status === "infeasible" ? text.analysisComplete : text.actionRequired}</span>{run.status === "verified" ? <BadgeCheck size={17} /> : <AlertTriangle size={16} />}</div>
      </div>
    </div>}
  </main>;
}
