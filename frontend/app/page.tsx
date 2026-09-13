"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Boxes, Check, CircleDollarSign,
  Cloud, FileCheck2, Gauge, LoaderCircle, LockKeyhole, LogIn, LogOut, MapPin, Network,
  Play, Plus, RotateCcw, Route, ShieldCheck, ShoppingCart, Sparkles, Timer, Truck, User,
  UserPlus, Warehouse, X, Languages, Trash2,
} from "lucide-react";
import { CHECK_LABELS, COPY, EVENT_LABELS, Locale, TOOL_LABELS } from "./i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const LiveNetworkMap = dynamic(() => import("./LiveNetworkMap"), { ssr: false });

type Candidate = { id: string; label: string; cost: number; carbon: number; delay_hours: number; score: number; feasible: boolean; infeasible_reason?: string | null; vendor_id?: string | null; vendor_name?: string | null; vendor_reliability?: number | null; route_id?: string };
type Comparison = { candidates: Candidate[]; recommended?: string; reason?: string };
type Event = { type: string; timestamp: string; content: { title?: string; message?: string; tool?: string; output?: Record<string, any> } };
type Run = { id: string; status: string; provider: string; events: Event[]; verification?: { passed: boolean; checks: CheckResult[] }; state: State };
type CheckResult = { name: string; passed: boolean; detail: string };
type SupplierLearning = { deliveries: number; on_time: number; failures: number; avg_delivery_hours: number; avg_cost: number; avg_carbon: number; mean_reward: number };
type State = { warehouses: { id: string; name: string; inventory: Record<string, number> }[]; vendors: { id: string; name: string; reliability: number; unit_cost: number; lead_time_hours: number; blocked: boolean }[]; routes: { id: string; from: string; to: string; status: string; lead_time_hours: number }[]; shipments: { id: string; product: string; qty: number; status: string }[]; metrics: Record<string, number>; supplier_learning?: Record<string, SupplierLearning> };
type AccountWarehouse = { id: number; name: string; location: string; inventory: Record<string, number> };
type WarehouseUser = { id: number; name: string; username: string; warehouse_name: string; warehouse_location: string; warehouses: AccountWarehouse[] };
type RecoveryHistory = { id: number; run_id: string; status: string; created_at: string; required_quantity: number; destination: { id: number; name: string; location: string; before: number; after: number }; source: { id: number | null; name: string; location: string; before: number; after: number }; run: Run };

const defaults = { min_fulfilment_pct: 100, max_extra_cost: 500, max_extra_carbon: 100, max_delay_hours: 8 };

const eventStyle: Record<string, { color: string; icon: typeof Activity }> = {
  goal: { color: "#73e6aa", icon: ShieldCheck }, monitor: { color: "#7db7ff", icon: Activity },
  detection: { color: "#ffb35c", icon: AlertTriangle }, investigation: { color: "#b29aff", icon: Network },
  comparison: { color: "#f2cf68", icon: Gauge }, action: { color: "#68dbe0", icon: Truck },
  transit: { color: "#56e39a", icon: MapPin },
  decision: { color: "#b29aff", icon: Sparkles },
  disruption: { color: "#ff6b6b", icon: X }, verification: { color: "#f59eaa", icon: FileCheck2 },
  replan: { color: "#ff9f6e", icon: RotateCcw }, certificate: { color: "#54e090", icon: BadgeCheck }, learning: { color: "#b29aff", icon: Sparkles },
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
  const [warehouseForm, setWarehouseForm] = useState({ name: "", location: "", inventory: 0 });
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<number, string>>({});
  const [savingInventoryId, setSavingInventoryId] = useState<number | null>(null);
  const [workspacePage, setWorkspacePage] = useState<"setup" | "live" | "result">("setup");
  const [runDestination, setRunDestination] = useState<AccountWarehouse | null>(null);
  const [runSource, setRunSource] = useState<AccountWarehouse | null>(null);
  const [authForm, setAuthForm] = useState({ name: "", username: "", password: "", warehouse_name: "", warehouse_location: "", warehouse_inventory: 0 });
  const [form, setForm] = useState(defaults);
  const [requiredQuantity, setRequiredQuantity] = useState(30);
  const [history, setHistory] = useState<RecoveryHistory[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [networkState, setNetworkState] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agentMode, setAgentMode] = useState<"checking" | "live_ai" | "local_deterministic" | "offline">("checking");
  const startingRef = useRef(false);
  const completionHandledRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const runActive = loading || run?.status === "running";
  const text = COPY[locale];
  const displayState = run?.state || networkState;
  const activeWarehouse = user?.warehouses?.find(warehouse => warehouse.id === activeWarehouseId) || user?.warehouses?.[0];
  const preferredSource = useMemo(() => {
    const alternatives = (user?.warehouses || []).filter(warehouse => warehouse.id !== activeWarehouse?.id);
    return alternatives.sort((a, b) => (b.inventory?.["SKU-100"] || 0) - (a.inventory?.["SKU-100"] || 0))[0] || { id: -1, name: "External Reserve Hub", location: activeWarehouse?.location.toLowerCase().includes("nagpur") ? "Mumbai" : "Nagpur", inventory: { "SKU-100": 40 } };
  }, [user, activeWarehouse]);
  const warehouseStock = (warehouse: AccountWarehouse) => {
    if (run && workspacePage === "live" && warehouse.id === runDestination?.id) return run.state.warehouses.find(item => item.id === "WH-NORTH")?.inventory["SKU-100"] ?? warehouse.inventory?.["SKU-100"];
    if (run && workspacePage === "live" && warehouse.id === runSource?.id) return run.state.warehouses.find(item => item.id === "WH-SOUTH")?.inventory["SKU-100"] ?? warehouse.inventory?.["SKU-100"];
    return warehouse.inventory?.["SKU-100"];
  };

  const loadHistory = async (token: string) => {
    const response = await fetch(`${API}/history`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const items: RecoveryHistory[] = await response.json();
    setHistory(items);
    setSelectedHistoryId(items[0]?.id ?? null);
    if (!run && items[0]) {
      const item = items[0];
      setRun(item.run);
      setRunDestination({ id: item.destination.id, name: item.destination.name, location: item.destination.location, inventory: { "SKU-100": item.destination.before } });
      setRunSource(item.source.id === null ? null : { id: item.source.id, name: item.source.name, location: item.source.location, inventory: { "SKU-100": item.source.before } });
    }
  };

  const openHistory = (item: RecoveryHistory) => {
    setSelectedHistoryId(item.id);
    setRun(item.run);
    setRunDestination({ id: item.destination.id, name: item.destination.name, location: item.destination.location, inventory: { "SKU-100": item.destination.before } });
    setRunSource(item.source.id === null ? null : { id: item.source.id, name: item.source.name, location: item.source.location, inventory: { "SKU-100": item.source.before } });
    setWorkspacePage("result");
  };

  const comparisons = useMemo(() => {
    const all = (run?.events || []).filter(event => event.type === "comparison" && Array.isArray(event.content.output?.candidates)).map(event => event.content.output as Comparison);
    return all.length > 2 ? [all[0], all[all.length - 1]] : all;
  }, [run]);
  const latestTransit = useMemo(() => [...(run?.events || [])].reverse().find(event => event.type === "transit"), [run?.events]);
  const latestEventType = run?.events[run.events.length - 1]?.type;
  const timelineEta = run?.status === "verified" ? text.arrived : latestEventType === "disruption" || latestEventType === "replan" ? text.routeInterrupted : latestTransit?.content.output?.eta_minutes !== undefined ? `${text.eta} · ${latestTransit.content.output.eta_minutes} min` : null;
  const runStatusLabel = run?.status === "verified" ? text.verified : run?.status === "infeasible" ? text.infeasible : run?.status === "failed" ? text.failed : text.running;
  const transferPath = `${runSource?.name || "Reserve warehouse"} → ${runDestination?.name || activeWarehouse?.name || "Destination warehouse"}`;
  const finalRecovery = useMemo(() => {
    if (run?.status !== "verified") return null;
    const action = [...run.events].reverse().find(event => event.type === "action" && event.content.output?.action_id && !event.content.output?.error);
    if (!action) return null;
    if (action.content.tool === "create_purchase_order") {
      const vendorId = String((action.content as any).input?.vendor_id || "");
      const vendor = run.state.vendors.find(item => item.id === vendorId);
      return {
        method: text.purchase,
        supplier: vendor ? `${vendor.name} (${vendor.id})` : vendorId,
        reliability: vendor ? `${Math.round(vendor.reliability * 100)}%` : text.supplier,
        path: `${vendor?.name || vendorId} → ${runDestination?.name || "Destination warehouse"}`,
        why: locale === "hi" ? "वेयरहाउस ट्रांसफर मार्ग बंद होने के बाद यह अनुबंध-अनुकूल विकल्प था।" : locale === "mr" ? "गोदाम हस्तांतरण मार्ग बंद झाल्यानंतर हा करार-अनुकूल पर्याय होता." : "Selected as the feasible recovery option after the warehouse transfer route closed.",
      };
    }
    const source = run.state.warehouses.find(item => item.id === "WH-SOUTH");
    return {
      method: text.transfer,
      supplier: source?.name || runSource?.name || "External Reserve Hub",
      reliability: locale === "hi" ? "आंतरिक इन्वेंटरी स्रोत" : locale === "mr" ? "अंतर्गत साठा स्रोत" : "Internal inventory source",
      path: `${source?.name || runSource?.name || "External Reserve Hub"} → ${runDestination?.name || "Destination warehouse"}`,
      why: locale === "hi" ? "सबसे कम अनुबंध-अनुकूल लागत, कार्बन और देरी स्कोर के कारण चयनित।" : locale === "mr" ? "सर्वात कमी करार-अनुकूल खर्च, कार्बन आणि विलंब गुणामुळे निवडले." : "Selected for the lowest contract-normalized cost, carbon, and delay score.",
    };
  }, [run, runDestination, runSource, locale, text.purchase, text.supplier, text.transfer]);

  const localizedReason = (reason?: string | null) => {
    if (reason === "Route R-SN is closed") return locale === "hi" ? "वेयरहाउस ट्रांसफर मार्ग बंद है" : locale === "mr" ? "गोदाम हस्तांतरण मार्ग बंद आहे" : "Warehouse transfer route is closed";
    if (!reason || locale === "en") return reason || text.constraintViolation;
    const reasons: Record<string, { hi: string; mr: string }> = {
      "Route R-SN is closed": { hi: "वेयरहाउस ट्रांसफर मार्ग बंद है", mr: "गोदाम हस्तांतरण मार्ग बंद आहे" },
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
    if (event.type === "transit") return text.driverLocation;
    if (event.type === "decision") return event.content.title?.toLowerCase().includes("alternate") ? text.alternateTitle : text.decisionTitle;
    return event.content.title || EVENT_LABELS[locale][event.type] || event.type;
  };

  const localizedEventMessage = (event: Event) => {
    if (event.type === "goal") return text.goalMessage;
    if (event.type === "disruption") return locale === "hi" ? `${transferPath} मार्ग ट्रांसफर के दौरान बंद हो गया।` : locale === "mr" ? `${transferPath} मार्ग हस्तांतरणादरम्यान बंद झाला.` : `The transfer route from ${transferPath} closed during dispatch.`;
    if (event.type === "replan") return text.replanMessage;
    if (event.type === "decision") return text.decisionMessage;
    if (event.type === "infeasible") return text.infeasibleBody;
    if (event.type === "transit" && event.content.output) {
      const progress = Number(event.content.output.progress);
      const routeId = String(event.content.output.route_id);
      const destination = `${event.content.output.destination_name}, ${event.content.output.destination_location}`;
      const path = routeId === "R-SN" ? transferPath : `RapidSupply → ${destination}`;
      return locale === "hi" ? `ड्राइवर ${path} पर ${progress}% दूरी पूरी करके ${destination} की ओर बढ़ रहा है।` : locale === "mr" ? `चालकाने ${path} वरील ${progress}% अंतर पूर्ण केले असून तो ${destination} कडे जात आहे.` : `Driver is ${progress}% along ${path} toward ${destination}.`;
    }
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
      .then(account => { setUser(account); setActiveWarehouseId(account.warehouses?.[0]?.id ?? null); setAuthStatus("signed_in"); loadHistory(token); })
      .catch(() => { window.localStorage.removeItem("supplyrestore-session"); setAuthStatus("signed_out"); });
  }, []);

  useEffect(() => {
    if (!user) return;
    setInventoryDrafts(Object.fromEntries(user.warehouses.map(warehouse => [warehouse.id, String(warehouse.inventory?.["SKU-100"] ?? 0)])));
  }, [user]);

  useEffect(() => {
    fetch(`${API}/health`).then(response => response.ok ? response.json() : Promise.reject()).then(data => setAgentMode(data.agent_mode)).catch(() => setAgentMode("offline"));
    fetch(`${API}/state`).then(response => response.ok ? response.json() : Promise.reject()).then(setNetworkState).catch(() => undefined);
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
    if (run && run.status !== "running" && completionHandledRef.current !== run.id) {
      completionHandledRef.current = run.id;
      setWorkspacePage("result");
      const token = window.localStorage.getItem("supplyrestore-session");
      if (token) window.setTimeout(async () => {
        const accountResponse = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (accountResponse.ok) setUser(await accountResponse.json());
        await loadHistory(token);
      }, 700);
    }
  }, [run?.id, run?.status]);

  async function startRun() {
    if (startingRef.current || run?.status === "running") return;
    startingRef.current = true;
    const configuredWarehouses = (user?.warehouses || []).map(warehouse => ({ ...warehouse, inventory: { ...warehouse.inventory, "SKU-100": Number(inventoryDrafts[warehouse.id] ?? warehouse.inventory?.["SKU-100"] ?? 0) } }));
    if (configuredWarehouses.some(warehouse => !Number.isInteger(warehouse.inventory["SKU-100"]) || warehouse.inventory["SKU-100"] < 0)) {
      setError("Enter a valid non-negative inventory for every warehouse."); startingRef.current = false; return;
    }
    const destination = configuredWarehouses.find(warehouse => warehouse.id === activeWarehouseId) || configuredWarehouses[0] || null;
    const sourceAlternatives = configuredWarehouses.filter(warehouse => warehouse.id !== destination?.id).sort((a, b) => b.inventory["SKU-100"] - a.inventory["SKU-100"]);
    const source = sourceAlternatives[0] || { id: -1, name: "External Reserve Hub", location: destination?.location.toLowerCase().includes("nagpur") ? "Mumbai" : "Nagpur", inventory: { "SKU-100": 40 } };
    setLoading(true); setError(""); setRun(null); setRunDestination(destination); setRunSource(source); setWorkspacePage("live");
    completionHandledRef.current = null;
    try {
      const token = window.localStorage.getItem("supplyrestore-session");
      await Promise.all(configuredWarehouses.filter(warehouse => warehouse.inventory["SKU-100"] !== user?.warehouses.find(item => item.id === warehouse.id)?.inventory?.["SKU-100"]).map(async warehouse => {
        const response = await fetch(`${API}/warehouses/${warehouse.id}/inventory`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ inventory: warehouse.inventory["SKU-100"] }) });
        if (!response.ok) throw new Error("Could not save warehouse inventory before starting");
      }));
      const resetResponse = await fetch(`${API}/reset`, { method: "POST" });
      if (!resetResponse.ok) {
        const resetError = await resetResponse.json();
        throw new Error(resetError.detail || "Could not reset the recovery environment");
      }
      const contractResponse = await fetch(`${API}/contracts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!contractResponse.ok) throw new Error("Could not create Recovery Contract");
      const contract = await contractResponse.json();
      const runResponse = await fetch(`${API}/runs`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ contract_id: contract.id, destination_id: destination?.id, destination_name: destination?.name || "North Fulfilment Hub", destination_location: destination?.location || "Mumbai", destination_stock: destination?.inventory?.["SKU-100"] ?? 0, source_id: source.id > 0 ? source.id : null, source_name: source.name, source_location: source.location, source_stock: source.inventory?.["SKU-100"] ?? 40, required_quantity: requiredQuantity }) });
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
      setUser(result.user); setActiveWarehouseId(result.user.warehouses?.[0]?.id ?? null); setAuthStatus("signed_in"); setAuthForm({ name: "", username: "", password: "", warehouse_name: "", warehouse_location: "", warehouse_inventory: 0 }); loadHistory(result.token);
    } catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Authentication failed"); }
    finally { setAuthLoading(false); }
  }

  async function signOut() {
    const token = window.localStorage.getItem("supplyrestore-session");
    if (token) await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    window.localStorage.removeItem("supplyrestore-session");
    setUser(null); setActiveWarehouseId(null); setRun(null); setRunDestination(null); setRunSource(null); setHistory([]); setWorkspacePage("setup"); setAuthStatus("signed_out"); setAuthMode("login");
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
      setUser(result); setActiveWarehouseId(newest.id); setWarehouseForm({ name: "", location: "", inventory: 0 }); setWarehouseOpen(false);
    } catch (cause) { setWarehouseError(cause instanceof Error ? cause.message : "Could not add warehouse"); }
    finally { setWarehouseLoading(false); }
  }

  async function saveInventory(warehouseId: number) {
    const inventory = Number(inventoryDrafts[warehouseId]);
    if (!Number.isInteger(inventory) || inventory < 0) return;
    setSavingInventoryId(warehouseId); setWarehouseError("");
    try {
      const token = window.localStorage.getItem("supplyrestore-session");
      const response = await fetch(`${API}/warehouses/${warehouseId}/inventory`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ inventory }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not update inventory");
      setUser(result);
    } catch (cause) { setWarehouseError(cause instanceof Error ? cause.message : "Could not update inventory"); }
    finally { setSavingInventoryId(null); }
  }

  async function deleteWarehouse(warehouse: AccountWarehouse) {
    if (!user || user.warehouses.length <= 1 || runActive) return;
    if (!window.confirm(`Delete ${warehouse.name}? This cannot be undone.`)) return;
    setWarehouseError("");
    try {
      const token = window.localStorage.getItem("supplyrestore-session");
      const response = await fetch(`${API}/warehouses/${warehouse.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not delete warehouse");
      setUser(result);
      if (activeWarehouseId === warehouse.id) setActiveWarehouseId(result.warehouses[0]?.id ?? null);
    } catch (cause) { setWarehouseError(cause instanceof Error ? cause.message : "Could not delete warehouse"); }
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
          {authMode === "signup" && <><label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseName}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Warehouse size={16} className="text-[#628073]" /><input required minLength={2} value={authForm.warehouse_name} onChange={event => setAuthForm({ ...authForm, warehouse_name: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label><label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseLocation}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><MapPin size={16} className="text-[#628073]" /><input required minLength={3} placeholder={text.locationHint} value={authForm.warehouse_location} onChange={event => setAuthForm({ ...authForm, warehouse_location: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#40594e]" /></div></label><label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.startingInventory}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Boxes size={16} className="text-[#628073]" /><input required min={0} type="number" value={authForm.warehouse_inventory} onChange={event => setAuthForm({ ...authForm, warehouse_inventory: Number(event.target.value) })} className="w-full bg-transparent py-3 font-mono text-sm outline-none" /></div></label></>}
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
        <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${agentMode === "live_ai" ? "animate-pulse bg-[#56e39a]" : agentMode === "offline" ? "bg-red-500" : "bg-amber-400"}`} />{agentMode === "live_ai" ? text.aiConnected : agentMode === "local_deterministic" ? text.localReady : agentMode === "offline" ? text.backendOffline : text.checkingAgent}</span><span className="h-4 w-px bg-[#2a4138]" /><span className="font-mono">{text.liveOperations}</span>
        <button onClick={signOut} title={text.logout} aria-label={text.logout} className="grid h-8 w-8 place-items-center rounded-lg border border-[#294239] bg-[#0b1813] text-[#88a298] transition hover:border-red-900 hover:text-red-300"><LogOut size={14} /></button>
      </div>
    </header>

    <nav className="mb-6 grid overflow-hidden rounded-2xl border border-[#203b31] bg-[#0a1712] sm:grid-cols-3" aria-label="Recovery workspace">
      {([
        ["setup", "01", text.setupPage, text.setupHint],
        ["live", "02", text.livePage, text.liveHint],
        ["result", "03", text.resultPage, text.resultHint],
      ] as const).map(([page, number, label, hint]) => {
        const disabled = page === "result" && ((!run || run.status === "running") && history.length === 0);
        return <button key={page} disabled={disabled} onClick={() => setWorkspacePage(page)} className={`flex items-center gap-3 border-b border-[#203b31] px-4 py-4 text-left transition last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${workspacePage === page ? "bg-[#13291f]" : "hover:bg-[#0e1e17]"} disabled:cursor-not-allowed disabled:opacity-40`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${workspacePage === page ? "bg-[#56e39a] text-[#062117]" : "border border-[#315043] text-[#6f8e80]"}`}>{number}</span><span className="min-w-0"><span className={`block text-sm font-bold ${workspacePage === page ? "text-[#79e9ae]" : "text-[#b3c7bd]"}`}>{label}</span><span className="mt-1 hidden truncate text-[10px] text-[#647d72] lg:block">{hint}</span></span></button>;
      })}
    </nav>

    {workspacePage !== "result" && <div className={`grid gap-5 ${workspacePage === "setup" ? "xl:grid-cols-[.9fr_1.1fr_.9fr]" : "xl:grid-cols-[.9fr_1.1fr]"}`}>
      <div className={`space-y-5 ${workspacePage === "live" ? "xl:col-start-2 xl:row-start-1" : ""}`}>
        {workspacePage === "setup" && <Panel className="p-5">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#5cdd99]">{text.recoveryContract}</p><h2 className="mt-1 text-lg font-semibold">{text.guardrails}</h2></div><ShieldCheck className="text-[#4ad58e]" size={22} /></div>
          <div className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.destinationWarehouse}</span><select value={activeWarehouseId || ""} onChange={event => setActiveWarehouseId(Number(event.target.value))} className="w-full rounded-lg border border-[#315043] bg-[#08130f] px-3 py-2.5 text-sm font-semibold text-[#d6e5de] outline-none focus:border-[#50d895]">{(user?.warehouses || []).map(warehouse => <option className="bg-white text-black" key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.location}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 flex justify-between text-xs text-[#91a99f]"><span>{text.requiredQuantity}</span><span>{text.units}</span></span><input required min={1} type="number" value={requiredQuantity} onChange={event => setRequiredQuantity(Math.max(1, Number(event.target.value)))} className="w-full rounded-lg border border-[#315043] bg-[#08130f] px-3 py-2.5 font-mono text-sm outline-none focus:border-[#50d895]" /></label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">{[
              ["min_fulfilment_pct", text.minFulfilment, "%"], ["max_extra_cost", text.maxCost, "$"],
              ["max_extra_carbon", text.maxCarbon, "kg"], ["max_delay_hours", text.maxDelay, "h"],
            ].map(([key, label, unit]) => <label className="block" key={key}><span className="mb-1.5 flex justify-between gap-1 text-[10px] text-[#91a99f]"><span className="truncate">{label}</span><span>{unit}</span></span><input type="number" value={form[key as keyof typeof form]} onChange={e => setForm({ ...form, [key]: Number(e.target.value) })} className="w-full rounded-lg border border-[#284238] bg-[#08130f] px-2.5 py-2.5 font-mono text-sm outline-none transition focus:border-[#50d895]" /></label>)}</div>
            <button onClick={startRun} disabled={runActive} aria-busy={runActive} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-sm font-bold text-[#062117] transition hover:bg-[#73ecad] disabled:cursor-not-allowed disabled:opacity-60">{runActive ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} fill="currentColor" />}{runActive ? text.recovering : text.start}</button>
            {error && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</p>}
          </div>
        </Panel>}
        {workspacePage === "live" && <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><div><h3 className="text-sm font-semibold">{text.liveNetwork}</h3><p className="mt-0.5 max-w-[280px] truncate text-[10px] text-[#698277]">{runDestination?.name || activeWarehouse?.name} · {runDestination?.location || activeWarehouse?.location}</p></div><Network size={16} className="text-[#6a8b7d]" /></div>
          <LiveNetworkMap warehouses={user?.warehouses || []} activeWarehouseId={runDestination?.id || activeWarehouseId} sourceWarehouse={runSource || preferredSource} events={run?.events || []} runStatus={run?.status} labels={{ active: text.mapActive, warehouse: text.mapWarehouse, supplier: text.mapSupplier, available: text.availableRoute, selected: text.selectedPath, closed: text.closed, verified: text.mapVerified }} />
        </Panel>}
      </div>

      <div className={`min-w-0 space-y-5 ${workspacePage === "live" ? "xl:contents" : ""}`}>
        {workspacePage === "live" && <Panel className="overflow-hidden xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <div className="flex items-center justify-between gap-3 border-b border-[#203b31] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#68897b]">{text.autonomousExecution}</p><h2 className="mt-0.5 font-semibold">{text.timeline}</h2></div><div className="flex items-center gap-2">{timelineEta && <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${run?.status === "verified" ? "border-emerald-800 bg-emerald-950/60 text-emerald-300" : latestEventType === "disruption" || latestEventType === "replan" ? "border-red-900 bg-red-950/50 text-red-300" : "border-[#315442] bg-[#10271d] text-[#70e6aa]"}`}><Timer size={11} />{timelineEta}</span>}{run && <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${run.status === "verified" ? "bg-emerald-900/40 text-emerald-300" : run.status === "infeasible" ? "bg-amber-900/40 text-amber-300" : run.status === "failed" ? "bg-red-900/40 text-red-300" : "bg-blue-900/40 text-blue-300"}`}>{runStatusLabel}</span>}</div></div>
          <div ref={timelineRef} className="max-h-[620px] min-h-[420px] overflow-y-auto p-5">
            {!run ? <div className="grid min-h-[380px] place-items-center text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-[#29493c] bg-[#10241c]"><Sparkles className="text-[#56e39a]" size={24} /></div><h3 className="font-semibold">{text.readyTitle}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#70897e]">{text.readyBody}</p></div></div> :
              <div>{run.events.map((event, index) => {
                const style = eventStyle[event.type] || eventStyle.monitor; const Icon = style.icon;
                return <div key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">{index < run.events.length - 1 && <div className="absolute left-[15px] top-8 h-[calc(100%-20px)] w-px bg-[#284137]" />}<div className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-[#0b1813]" style={{ borderColor: `${style.color}66`, color: style.color }}><Icon size={15} /></div><div className="min-w-0 flex-1 rounded-xl border border-[#1c352b] bg-[#09140f] p-3.5"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: style.color }}>{EVENT_LABELS[locale][event.type] || event.type}</span><h4 className="mt-0.5 text-sm font-semibold">{localizedEventTitle(event)}</h4></div><time className="whitespace-nowrap font-mono text-[10px] text-[#587166]">{new Date(event.timestamp).toLocaleTimeString(locale === "hi" ? "hi-IN" : locale === "mr" ? "mr-IN" : "en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>{localizedEventMessage(event) && <p className="mt-2 text-xs leading-5 text-[#8ca399]">{localizedEventMessage(event)}</p>}{event.type === "verification" && event.content.output && <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${event.content.output.passed ? "bg-emerald-950/50 text-emerald-300" : "bg-red-950/45 text-red-300"}`}>{event.content.output.passed ? <Check size={14} /> : <X size={14} />}{localizedCheckDetail(String(event.content.output.detail))}</div>}</div></div>;
              })}{run.status === "running" && <div className="ml-12 flex items-center gap-2.5 rounded-xl border border-[#274338] bg-[#0c1b15] px-3.5 py-3 text-xs text-[#8da79b]"><LoaderCircle className="animate-spin text-[#56e39a]" size={15} /><span>{text.processing}</span></div>}</div>}
          </div>
        </Panel>}

        {workspacePage === "live" && comparisons.length > 0 && <Panel className="p-5 xl:col-start-2 xl:row-start-2">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#f2cf68]">{text.optimizer}</p><h3 className="mt-1 font-semibold">{text.evolution}</h3><p className="mt-1 text-xs text-[#6f887d]">{text.evolutionBody}</p></div><Gauge className="text-[#f2cf68]" size={20} /></div>
          <div className={`grid gap-3 ${comparisons.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {comparisons.map((comparison, stageIndex) => <div key={stageIndex} className="overflow-hidden rounded-xl border border-[#263f35] bg-[#09140f]">
              <div className="flex items-center justify-between border-b border-[#20372e] px-4 py-3">
                <div className="flex items-center gap-3"><span className={`grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-bold ${stageIndex === 0 ? "bg-[#26382e] text-[#b2c7bd]" : "bg-[#1d4934] text-[#68e6a4]"}`}>0{stageIndex + 1}</span><div><p className="text-xs font-semibold">{stageIndex === 0 ? text.initial : text.replan}</p><p className="mt-0.5 text-[10px] text-[#6d867b]">{stageIndex === 0 ? text.beforeDisruption : text.afterClosure}</p></div></div>
                {stageIndex > 0 && <span className="rounded-full bg-[#42251d] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ffa57e]">{text.replanned}</span>}
              </div>
              <div className="space-y-2 p-3">{comparison.candidates.map(candidate => { const selected = comparison.recommended === candidate.id; return <div key={candidate.id} className={`rounded-lg border px-3 py-3 ${selected ? "border-[#3b9d69] bg-[#10271d]" : !candidate.feasible ? "border-[#56332f] bg-[#211412]" : "border-[#263a32] bg-[#0c1813]"}`}>
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-2.5">{candidate.id === "transfer" ? <Truck className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} /> : <ShoppingCart className={selected ? "text-[#60e49d]" : "text-[#7d958a]"} size={16} />}<div className="min-w-0"><p className="truncate text-xs font-semibold">{candidate.id === "transfer" ? text.transfer : text.purchase}</p>{candidate.id === "transfer" && <p className="mt-0.5 truncate text-[10px] font-medium text-[#9bb5a9]">{runSource?.name || preferredSource.name} → {runDestination?.name || activeWarehouse?.name}</p>}{candidate.id === "purchase" && candidate.vendor_name && <p className="mt-0.5 truncate text-[10px] font-medium text-[#9bb5a9]">{text.supplier} · {candidate.vendor_name} ({candidate.vendor_id})</p>}<p className="mt-1 font-mono text-[10px] text-[#789085]">${candidate.cost} · {candidate.carbon}kg · {candidate.delay_hours}h</p></div></div>
                  <div className="shrink-0 text-right">{selected ? <span className="rounded bg-[#56e39a] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#052117]">{text.selected}</span> : !candidate.feasible ? <span className="rounded bg-[#5b2b25] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#ff9d8b]">{text.unavailable}</span> : <span className="font-mono text-[11px] text-[#82998f]">{candidate.score.toFixed(4)}</span>}{!candidate.feasible && <p className="mt-1.5 max-w-[135px] text-[9px] leading-3 text-[#d48778]">{localizedReason(candidate.infeasible_reason)}</p>}</div></div>
              </div>})}</div>
              <div className="border-t border-[#20372e] px-4 py-3 text-[10px] leading-4 text-[#718a7f]">{comparison.recommended ? `${comparison.recommended === "transfer" ? text.transfer : text.purchase} ${text.selectedReason} (${comparison.candidates.find(candidate => candidate.id === comparison.recommended)?.score.toFixed(4)}).` : text.noCandidate}</div>
            </div>)}
          </div>
        </Panel>}
        {workspacePage === "live" && comparisons.length === 0 && <Panel className="grid min-h-[180px] place-items-center p-5 text-center xl:col-start-2 xl:row-start-2"><div><Gauge className="mx-auto text-[#827342]" size={22} /><p className="mt-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#a38d48]">{text.optimizer}</p><h3 className="mt-1 text-sm font-semibold">{text.evolution}</h3><p className="mt-1 text-xs text-[#61796e]">{text.processing}</p></div></Panel>}
        {workspacePage === "setup" && <>
          <Panel className="p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#668579]">{text.setupPage}</p><h3 className="mt-1 text-sm font-semibold">{text.operationalState}</h3></div><Warehouse size={17} className="text-[#789287]" /></div><div className="grid grid-cols-2 gap-2">{(user?.warehouses || []).map(warehouse => <Metric key={warehouse.id} icon={Warehouse} label={`${warehouse.name} · SKU-100`} value={warehouseStock(warehouse) ?? "—"} unit={text.units} />)}<Metric icon={CircleDollarSign} label={text.extraCost} value={displayState ? `$${displayState.metrics.extra_cost}` : "—"} /><Metric icon={Cloud} label={text.carbon} value={displayState?.metrics.extra_carbon ?? "—"} unit="kg" /></div></Panel>
          <Panel className="overflow-hidden"><div className="border-b border-[#203b31] px-5 py-4"><h3 className="text-sm font-semibold">{text.supplyPartners}</h3><p className="mt-1 text-[10px] text-[#70887d]">Supplier intelligence learns from simulated, verified delivery outcomes.</p></div><div className="grid gap-2 p-3 sm:grid-cols-2">{(displayState?.vendors || []).map(v => { const learning = displayState?.supplier_learning?.[v.id]; const onTime = learning && learning.deliveries ? Math.round(learning.on_time / learning.deliveries * 100) : 0; return <div key={v.id} className="rounded-xl border border-[#1d332a] bg-[#091510] p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{v.name}</span><span className="font-mono text-xs text-[#5bdfa0]">{Math.round(v.reliability * 100)}%</span></div><div className="mt-2 flex justify-between text-[10px] text-[#6e887c]"><span>${v.unit_cost}/{text.units}</span><span>{v.lead_time_hours}h {locale === "hi" ? "लीड टाइम" : locale === "mr" ? "वितरण वेळ" : "lead time"}</span></div>{learning && <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-[#1d362c] pt-2.5 text-center"><div><p className="text-[8px] uppercase text-[#647d72]">On-time</p><p className="mt-0.5 font-mono text-[11px] font-bold text-[#86e6b4]">{onTime}%</p></div><div><p className="text-[8px] uppercase text-[#647d72]">Actual</p><p className="mt-0.5 font-mono text-[11px] font-bold">{learning.avg_delivery_hours}h</p></div><div><p className="text-[8px] uppercase text-[#647d72]">Reward</p><p className={`mt-0.5 font-mono text-[11px] font-bold ${learning.mean_reward >= 0 ? "text-[#86e6b4]" : "text-red-300"}`}>{learning.mean_reward >= 0 ? "+" : ""}{learning.mean_reward}</p></div></div>}</div>})}{!displayState && <p className="col-span-full py-8 text-center text-xs text-[#627b70]">{text.awaitingScan}</p>}</div></Panel>
        </>}
      </div>

      {workspacePage === "setup" && <div className="space-y-5"><Panel className="overflow-hidden"><div className="flex items-center justify-between border-b border-[#203b31] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#668579]">{user?.warehouses.length || 0}</p><h3 className="mt-1 text-sm font-semibold">{text.yourWarehouses}</h3></div><button onClick={() => { setWarehouseError(""); setWarehouseOpen(true); }} className="flex items-center gap-1.5 rounded-lg bg-[#56e39a] px-2.5 py-2 text-[10px] font-bold text-[#062117]"><Plus size={13} />{text.addWarehouse}</button></div><div className="space-y-2 p-3">{(user?.warehouses || []).map(warehouse => <div key={warehouse.id} className={`rounded-xl border p-3 transition ${warehouse.id === activeWarehouseId ? "border-[#3e8e63] bg-[#10271d]" : "border-[#20372e] bg-[#09140f]"}`}><div className="flex items-start gap-2"><button onClick={() => setActiveWarehouseId(warehouse.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${warehouse.id === activeWarehouseId ? "bg-[#56e39a] text-[#062117]" : "bg-[#15271f] text-[#739184]"}`}><Warehouse size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{warehouse.name}</span><span className="mt-1 flex items-center gap-1 truncate text-[10px] text-[#6f897d]"><MapPin size={10} />{warehouse.location}</span></span>{warehouse.id === activeWarehouseId && <span className="rounded-full bg-[#1c5136] px-2 py-1 text-[8px] font-bold uppercase text-[#74e9ae]">{text.destinationWarehouse}</span>}</button><button onClick={() => deleteWarehouse(warehouse)} disabled={runActive || (user?.warehouses.length || 0) <= 1} title="Delete warehouse" aria-label={`Delete ${warehouse.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-900/60 bg-red-950/20 text-red-300 transition hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={14} /></button></div><div className="mt-3 flex items-end gap-2 border-t border-[#213b30] pt-3"><label className="min-w-0 flex-1"><span className="mb-1 block text-[9px] uppercase tracking-wider text-[#698277]">SKU-100 · {text.units}</span><input min={0} type="number" value={inventoryDrafts[warehouse.id] ?? ""} onChange={event => setInventoryDrafts({ ...inventoryDrafts, [warehouse.id]: event.target.value })} disabled={runActive} className="w-full rounded-lg border border-[#29463a] bg-[#08130f] px-2.5 py-2 font-mono text-xs outline-none focus:border-[#50d895] disabled:opacity-50" /></label><button onClick={() => saveInventory(warehouse.id)} disabled={runActive || savingInventoryId === warehouse.id || Number(inventoryDrafts[warehouse.id]) === warehouse.inventory?.["SKU-100"]} className="rounded-lg border border-[#356148] bg-[#143021] px-3 py-2 text-[10px] font-bold text-[#6ee5a8] disabled:opacity-35">{savingInventoryId === warehouse.id ? <LoaderCircle className="animate-spin" size={13} /> : text.saveInventory}</button></div></div>)}</div>{warehouseError && <p className="mx-3 mb-3 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{warehouseError}</p>}</Panel></div>}
    </div>}

    {warehouseOpen && <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="add-warehouse-title">
      <div className="relative w-full max-w-md rounded-2xl border border-[#315442] bg-[#0b1813] p-6 shadow-[0_28px_100px_rgba(0,0,0,.65)]">
        <button onClick={() => setWarehouseOpen(false)} aria-label={text.cancel} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-[#30473e] bg-[#101f19] text-[#91a99f] hover:text-white"><X size={17} /></button>
        <div className="mb-5 flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173426] text-[#63e1a1]"><Warehouse size={20} /></div><div><h2 id="add-warehouse-title" className="text-lg font-bold">{text.addWarehouse}</h2><p className="mt-1 text-xs text-[#789187]">{text.addWarehouseBody}</p></div></div>
        {user && user.warehouses?.length > 0 && <div className="mb-5 rounded-xl border border-[#20382f] bg-[#08130f] p-3"><p className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#688579]">{text.yourWarehouses} · {user.warehouses.length}</p><div className="max-h-28 space-y-1 overflow-y-auto">{user.warehouses.map(warehouse => <div key={warehouse.id} className="flex items-center gap-2 text-xs text-[#9db2a8]"><MapPin size={12} className="shrink-0 text-[#5cd99a]" /><span className="font-semibold text-[#c9dbd2]">{warehouse.name}</span><span className="truncate text-[#678074]">· {warehouse.location}</span></div>)}</div></div>}
        <form onSubmit={addWarehouse} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseName}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Warehouse size={16} className="text-[#628073]" /><input required minLength={2} autoFocus value={warehouseForm.name} onChange={event => setWarehouseForm({ ...warehouseForm, name: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none" /></div></label>
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.warehouseLocation}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><MapPin size={16} className="text-[#628073]" /><input required minLength={3} placeholder={text.locationHint} value={warehouseForm.location} onChange={event => setWarehouseForm({ ...warehouseForm, location: event.target.value })} className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#40594e]" /></div></label>
          <label className="block"><span className="mb-1.5 block text-xs text-[#91a99f]">{text.startingInventory}</span><div className="flex items-center gap-2.5 rounded-lg border border-[#284238] bg-[#08130f] px-3 focus-within:border-[#50d895]"><Boxes size={16} className="text-[#628073]" /><input required min={0} type="number" value={warehouseForm.inventory} onChange={event => setWarehouseForm({ ...warehouseForm, inventory: Number(event.target.value) })} className="w-full bg-transparent py-3 font-mono text-sm outline-none" /></div></label>
          {warehouseError && <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{warehouseError}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => setWarehouseOpen(false)} className="flex-1 rounded-lg border border-[#30483e] px-4 py-3 text-xs font-bold text-[#92a99e]">{text.cancel}</button><button disabled={warehouseLoading} className="flex flex-[1.4] items-center justify-center gap-2 rounded-lg bg-[#56e39a] px-4 py-3 text-xs font-bold text-[#062117] disabled:opacity-60">{warehouseLoading ? <LoaderCircle className="animate-spin" size={15} /> : <Plus size={15} />}{warehouseLoading ? text.addingWarehouse : text.addWarehouse}</button></div>
        </form>
      </div>
    </div>}

    {workspacePage === "result" && run && run.status !== "running" && <section className="mx-auto grid w-full max-w-[1200px] items-start gap-5 pb-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel className="overflow-hidden lg:sticky lg:top-5"><div className="border-b border-[#203b31] px-4 py-4"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#5cdd99]">{text.recoveryHistory}</p><p className="mt-1 text-[10px] text-[#6e877c]">{history.length} {text.resultPage.toLowerCase()}</p></div><div className="max-h-[640px] space-y-2 overflow-y-auto p-2.5">{history.map((item, index) => <button key={item.id} onClick={() => openHistory(item)} className={`w-full rounded-xl border p-3 text-left transition ${item.id === selectedHistoryId ? "border-[#3f9064] bg-[#11291e]" : "border-[#20372e] bg-[#09140f] hover:border-[#355548]"}`}><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase ${item.status === "verified" ? "bg-emerald-900/60 text-emerald-300" : item.status === "infeasible" ? "bg-amber-900/50 text-amber-300" : "bg-red-950 text-red-300"}`}>{item.status === "verified" ? text.verified : item.status === "infeasible" ? text.infeasible : text.failed}</span>{index === 0 && <span className="text-[8px] font-bold uppercase text-[#5edb9b]">{text.latest}</span>}</div><p className="mt-2 truncate text-xs font-semibold text-[#d2e2da]">{item.destination.name}</p><p className="mt-0.5 truncate text-[9px] text-[#688277]">{item.destination.location}</p><div className="mt-2 flex items-center justify-between border-t border-[#1e352c] pt-2 font-mono text-[9px] text-[#7d978b]"><span>{item.destination.before} → {item.destination.after} SKU-100</span><span>{new Date(item.created_at).toLocaleDateString()}</span></div></button>)}{history.length === 0 && <div className="px-3 py-10 text-center text-xs text-[#647d72]">{text.noHistory}</div>}</div></Panel>
      <div className={`relative w-full overflow-hidden rounded-2xl border bg-[#0b1813] shadow-[0_22px_80px_rgba(0,0,0,.35)] ${run.status === "verified" ? "border-[#3a8f61]" : run.status === "infeasible" ? "border-[#83602e]" : "border-red-900"}`}>
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

        {history.find(item => item.id === selectedHistoryId) && <div className="mx-5 mt-4 grid grid-cols-3 gap-2 rounded-xl border border-[#203b31] bg-[#09140f] p-3"><div><p className="text-[8px] uppercase tracking-wider text-[#667f74]">{text.before}</p><p className="mt-1 font-mono text-sm font-bold">{history.find(item => item.id === selectedHistoryId)?.destination.before}</p></div><div><p className="text-[8px] uppercase tracking-wider text-[#667f74]">{text.after}</p><p className="mt-1 font-mono text-sm font-bold text-[#67dfa1]">{history.find(item => item.id === selectedHistoryId)?.destination.after}</p></div><div><p className="text-[8px] uppercase tracking-wider text-[#667f74]">{text.demand}</p><p className="mt-1 font-mono text-sm font-bold">{history.find(item => item.id === selectedHistoryId)?.required_quantity}</p></div></div>}
        <div className="p-5"><p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#708a7f]">{text.contractChecks}</p>{run.verification?.checks ? <div className="grid gap-2 sm:grid-cols-2">{run.verification.checks.map(check => <div key={check.name} className="flex gap-2.5 rounded-lg border border-[#20372e] bg-[#09140f] p-3"><div className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${check.passed ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}`}>{check.passed ? <Check size={12} /> : <X size={12} />}</div><div><p className="text-xs font-medium">{CHECK_LABELS[locale][check.name] || check.name}</p><p className="mt-0.5 text-[10px] leading-4 text-[#71897f]">{localizedCheckDetail(check.detail)}</p></div></div>)}</div> : <p className="rounded-lg bg-red-950/25 p-3 text-xs text-red-300">{text.noEvidence}</p>}</div>
        <div className={`flex items-center justify-between border-t px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] ${run.status === "verified" ? "border-[#28503e] bg-[#10271d] text-[#6be6a6]" : run.status === "infeasible" ? "border-[#5c4529] bg-amber-950/25 text-amber-200" : "border-red-900/50 bg-red-950/20 text-red-300"}`}><span>{run.status === "verified" ? text.evidenceComplete : run.status === "infeasible" ? text.analysisComplete : text.actionRequired}</span>{run.status === "verified" ? <BadgeCheck size={17} /> : <AlertTriangle size={16} />}</div>
      </div>
    </section>}
    {workspacePage === "result" && !run && history.length === 0 && <Panel className="mx-auto max-w-xl p-10 text-center"><FileCheck2 className="mx-auto text-[#607b6f]" size={28} /><h2 className="mt-4 font-semibold">{text.noResultTitle}</h2><p className="mt-2 text-xs text-[#718a7f]">{text.noResultBody}</p></Panel>}
  </main>;
}
