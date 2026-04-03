import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw, Play, X, ExternalLink, Send,
  Star, Trash2, Plus, ArrowLeft, Square, Download,
  Home, MapPin, DollarSign, Bed, LayoutGrid, List, GripVertical,
  Link, Loader2, CheckCircle2,
} from "lucide-react";

const API    = "http://localhost:8000";
const WS_API = "ws://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  created_at: string;
  configured: boolean;
}

interface Listing {
  id: string;
  property_name: string;
  property_type: string;
  locality: string;
  city: string;
  price: string;
  bedrooms: string;
  area_sqft: string;
  match_score: number;
  match_reason: string;
  priority: "hot" | "warm" | "cold";
  key_features: string[];
  source_url: string;
  listing_type: string;
  raw_snippet: string;
  found_at: string;
  status: "new" | "reviewed" | "contacted" | "archived";
  notes: string;
  starred?: boolean;
  channel?: string;
  channel_label?: string;
  [key: string]: unknown;
}

interface Stats { total: number; new: number; hot: number; contacted: number; reviewed: number; starred?: number; }
interface AgentConfig { agent_name: string; listing_type: string; budget_range: string; bedrooms: string; location_preference: string; [key: string]: unknown; }
interface ChatMsg { role: "user" | "agent"; text: string; }

interface AgentContext {
  config: {
    agent_name: string; listing_type: string; budget_range: string;
    bedrooms: string; location_preference: string; additional_requirements: string;
  };
  must_haves: string[];
  nice_to_haves: string[];
  deal_breakers: string[];
  search_queries: { signal: string; queries: string[] }[];
  result_schema: { property_types: string[]; localities: string[] };
  score_thresholds: { hot_min: number; warm_min: number; save_min: number };
  starred_listings: { property_name: string; locality: string; city: string; price: string; bedrooms: string; match_score: number; match_reason: string }[];
  search_geo: string;
  search_channels: string[];
  max_results_per_query: number;
  batch_size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const PRIORITY_BADGE: Record<string, string> = {
  hot:  "text-orange-950 bg-orange-100 border-orange-200",
  warm: "text-amber-950 bg-amber-100 border-amber-200",
  cold: "text-slate-700 bg-slate-100 border-slate-200",
};
const PRIORITY_BORDER: Record<string, string> = {
  hot:  "border-l-orange-500",
  warm: "border-l-amber-500",
  cold: "border-l-slate-400",
};
const STATUS_BADGE: Record<string, string> = {
  new:       "text-blue-900 bg-blue-50 border-blue-200",
  reviewed:  "text-amber-950 bg-amber-50 border-amber-200",
  contacted: "text-emerald-950 bg-emerald-50 border-emerald-200",
  archived:  "text-slate-600 bg-slate-100 border-slate-200",
};
const LISTING_TYPE_BADGE: Record<string, string> = {
  buy:  "text-purple-950 bg-purple-100 border-purple-200",
  rent: "text-teal-950 bg-teal-100 border-teal-200",
  both: "text-indigo-950 bg-indigo-100 border-indigo-200",
};
const CHANNEL_BADGE: Record<string, string> = {
  "99acres":      "text-blue-950 bg-blue-100 border-blue-200",
  magicbricks:    "text-red-950 bg-red-100 border-red-200",
  housing:        "text-orange-950 bg-orange-100 border-orange-200",
  nobroker:       "text-emerald-950 bg-emerald-100 border-emerald-200",
  zillow:         "text-blue-950 bg-blue-100 border-blue-200",
  realtor:        "text-red-950 bg-red-100 border-red-200",
  propertyguru:   "text-teal-950 bg-teal-100 border-teal-200",
  rightmove:      "text-green-950 bg-green-100 border-green-200",
  news:           "text-violet-950 bg-violet-100 border-violet-200",
  google:         "text-emerald-950 bg-emerald-100 border-emerald-200",
};
const CHANNEL_LABEL: Record<string, string> = {
  "99acres": "99acres", magicbricks: "MagicBricks", housing: "Housing.com",
  nobroker: "NoBroker", zillow: "Zillow", realtor: "Realtor.com",
  propertyguru: "PropertyGuru", rightmove: "Rightmove", news: "News", google: "Google",
};

const RE_CHANNELS = ["99acres", "magicbricks", "housing", "nobroker", "zillow", "realtor", "propertyguru", "rightmove", "news", "google"] as const;
const RE_CHANNEL_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  "99acres":    { label: "99acres",     color: "bg-blue-100 border-blue-200 text-blue-950",       dot: "bg-blue-500" },
  magicbricks:  { label: "MagicBricks", color: "bg-red-100 border-red-200 text-red-950",          dot: "bg-red-500" },
  housing:      { label: "Housing.com", color: "bg-orange-100 border-orange-200 text-orange-950",  dot: "bg-orange-500" },
  nobroker:     { label: "NoBroker",    color: "bg-emerald-100 border-emerald-200 text-emerald-950", dot: "bg-emerald-500" },
  zillow:       { label: "Zillow",      color: "bg-blue-100 border-blue-200 text-blue-950",       dot: "bg-blue-500" },
  realtor:      { label: "Realtor.com", color: "bg-red-100 border-red-200 text-red-950",          dot: "bg-red-500" },
  propertyguru: { label: "PropertyGuru",color: "bg-teal-100 border-teal-200 text-teal-950",       dot: "bg-teal-500" },
  rightmove:    { label: "Rightmove",   color: "bg-green-100 border-green-200 text-green-950",     dot: "bg-green-500" },
  news:         { label: "News",        color: "bg-violet-100 border-violet-200 text-violet-950", dot: "bg-violet-500" },
  google:       { label: "Google",      color: "bg-emerald-100 border-emerald-200 text-emerald-950",  dot: "bg-emerald-500" },
};

// ── Project Selector ───────────────────────────────────────────────────────────

function ProjectSelector({
  projects, loading, onSelect, onRefresh, onDelete,
}: {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
  onDelete: (pid: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState("");
  const [saving, setSaving]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/realestate/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const project: Project = await r.json();
        setCreating(false);
        setNewName("");
        onSelect(project);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-12 bg-ui-bg">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Home className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-semibold text-ui-text">Real Estate Agent</h1>
          </div>
          <p className="text-sm text-ui-accent">
            Each project has its own property search criteria, listings, and configuration.
            Select a project or create a new one.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-ui-accent text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading projects…
          </div>
        ) : projects.length === 0 && !creating ? (
          <div className="bg-ui-card border border-ui-border rounded-xl p-10 text-center mb-6">
            <Home className="w-8 h-8 text-ui-accent mx-auto mb-3" />
            <p className="text-ui-text font-medium mb-1">No projects yet</p>
            <p className="text-sm text-ui-accent">Create your first property search to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-6">
            {projects.map(p => (
              <div key={p.id} className="bg-ui-card border border-ui-border hover:border-gray-400 rounded-xl p-5 text-left transition-colors group relative">
                <button onClick={() => onSelect(p)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-2 mb-3 pr-7">
                    <span className="font-semibold text-ui-text group-hover:text-white transition-colors truncate">{p.name}</span>
                    <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                      p.configured ? "text-green-900 bg-green-100 border-green-200" : "text-amber-950 bg-amber-50 border-amber-200"
                    }`}>
                      {p.configured ? "Ready" : "Setup needed"}
                    </span>
                  </div>
                  <p className="text-xs text-ui-accent">Created {fmtDate(p.created_at)}</p>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete project "${p.name}"?`)) onDelete(p.id); }}
                  title="Delete project"
                  className="absolute top-4 right-4 p-1.5 rounded-lg text-ui-accent hover:text-red-400 hover:bg-red-950/50 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {creating ? (
          <div className="bg-ui-card border border-ui-border rounded-xl p-5">
            <p className="text-sm font-medium text-ui-text mb-3">Name your property search</p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); }}}
                placeholder="e.g. 2BHK Bangalore Buy"
                className="flex-1 bg-ui-bg border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent"
              />
              <button onClick={handleCreate} disabled={!newName.trim() || saving}
                className="px-4 py-2 rounded-xl bg-ui-text text-white text-sm font-medium disabled:opacity-40 transition-opacity">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Create"}
              </button>
              <button onClick={() => { setCreating(false); setNewName(""); }}
                className="w-10 h-10 flex items-center justify-center rounded-xl border border-ui-border text-ui-accent hover:text-ui-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-ui-border text-ui-accent hover:text-ui-text hover:border-gray-400 text-sm transition-colors">
            <Plus className="w-4 h-4" /> New search
          </button>
        )}

        {projects.length > 0 && (
          <button onClick={onRefresh} className="mt-4 flex items-center gap-1.5 text-xs text-ui-accent hover:text-ui-text transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        )}
      </div>
    </div>
  );
}

// ── Manual Setup Form ─────────────────────────────────────────────────────────

function ManualSetupForm({
  projectId, onDone, onBack,
}: {
  projectId: string;
  onDone: (cfg: AgentConfig) => void;
  onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [form, setForm]     = useState({
    agent_name: "",
    listing_type: "buy",
    budget_range: "",
    bedrooms: "",
    location_preference: "",
    additional_requirements: "",
    must_haves: "",
    nice_to_haves: "",
    deal_breakers: "",
    search_queries_raw: "",
    search_channels: ["99acres", "magicbricks", "housing", "google"] as string[],
    search_geo: "in",
    max_results_per_query: 5,
    hot_min: 8,
    warm_min: 5,
    save_min: 3,
  });

  const set = (k: keyof typeof form, v: unknown) => setForm(prev => ({ ...prev, [k]: v }));

  const toggleChannel = (ch: string) =>
    set("search_channels", form.search_channels.includes(ch)
      ? form.search_channels.filter(c => c !== ch)
      : [...form.search_channels, ch]);

  const handleSave = async () => {
    if (!form.location_preference.trim()) { setErr("Location preference is required."); return; }
    setSaving(true); setErr("");

    const must = form.must_haves.split("\n").map(s => s.trim()).filter(Boolean);
    const nice = form.nice_to_haves.split("\n").map(s => s.trim()).filter(Boolean);
    const deal = form.deal_breakers.split("\n").map(s => s.trim()).filter(Boolean);

    const rawQueries = form.search_queries_raw.split("\n").map(s => s.trim()).filter(Boolean);
    const search_queries = rawQueries.length
      ? [{ signal: "general", queries: rawQueries }]
      : [{ signal: "general", queries: [`${form.bedrooms} ${form.listing_type} ${form.location_preference}`] }];

    const cfg = {
      agent_name: form.agent_name || `RE Agent — ${form.location_preference}`,
      listing_type: form.listing_type,
      budget_range: form.budget_range,
      bedrooms: form.bedrooms,
      location_preference: form.location_preference,
      additional_requirements: form.additional_requirements,
      must_haves: must.length ? must : ["Within budget range"],
      nice_to_haves: nice.length ? nice : ["Good amenities"],
      deal_breakers: deal.length ? deal : ["Price significantly above budget"],
      result_schema: {
        property_types: ["apartment", "flat", "villa", "house", "penthouse", "studio", "other"],
        localities: form.location_preference.split(",").map(s => s.trim()).filter(Boolean),
      },
      score_thresholds: { hot_min: form.hot_min, warm_min: form.warm_min, save_min: form.save_min },
      search_queries,
      search_channels: form.search_channels.length ? form.search_channels : ["99acres", "google"],
      max_results_per_query: form.max_results_per_query,
      search_geo: form.search_geo || "in",
    };

    try {
      const r = await fetch(`${API}/realestate/${projectId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (r.ok) onDone(cfg as AgentConfig);
      else { const e = await r.json().catch(() => ({})); setErr(e.detail ?? "Failed to save."); }
    } catch { setErr("Network error. Is the backend running?"); }
    finally { setSaving(false); }
  };

  const field = (label: string, key: keyof typeof form, placeholder = "", multiline = false) => (
    <div>
      <label className="block text-xs font-medium text-ui-accent mb-1">{label}</label>
      {multiline ? (
        <textarea value={form[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder} rows={3}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent resize-y" />
      ) : (
        <input value={form[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent" />
      )}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-ui-accent hover:text-ui-text text-sm flex items-center gap-1 transition-colors">← Back to chat</button>
      </div>
      <h1 className="text-xl font-semibold text-ui-text mb-1">Manual setup</h1>
      <p className="text-sm text-ui-accent mb-6">Fill in your property requirements directly.</p>

      <div className="space-y-4">
        <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold">Requirements</p>
        {field("Agent name", "agent_name", "2BHK Bangalore Search")}
        <div>
          <label className="block text-xs font-medium text-ui-accent mb-1">Looking to</label>
          <select value={form.listing_type} onChange={e => set("listing_type", e.target.value)}
            className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text">
            <option value="buy">Buy</option>
            <option value="rent">Rent</option>
            <option value="both">Both</option>
          </select>
        </div>
        {field("Budget range *", "budget_range", "₹40 Lac - ₹80 Lac or $2000-$3000/month")}
        {field("Bedrooms", "bedrooms", "2-3 BHK")}
        {field("Location preference *", "location_preference", "Bangalore — Whitefield, Sarjapur Road")}
        {field("Additional requirements", "additional_requirements", "Gated community, ready-to-move preferred", true)}

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Criteria</p>
          {field("Must-haves (one per line)", "must_haves", "Within budget range\n2 or 3 BHK\nGated community", true)}
          {field("Nice-to-haves (one per line)", "nice_to_haves", "Swimming pool\nNear metro\nCar parking", true)}
          {field("Deal breakers (one per line)", "deal_breakers", "Price above budget\nUnder construction >2 years\nPlot/land", true)}
        </div>

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Search</p>
          {field("Search queries (one per line)", "search_queries_raw", "2 BHK flat Whitefield Bangalore under 70 lakhs\n3 BHK apartment Sarjapur Road gated community", true)}
          {field("Geography code", "search_geo", "in")}
          <div>
            <label className="block text-xs font-medium text-ui-accent mb-2">Portals</label>
            <div className="flex flex-wrap gap-2">
              {RE_CHANNELS.map(ch => (
                <button key={ch} onClick={() => toggleChannel(ch)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    form.search_channels.includes(ch) ? "bg-ui-text text-white border-ui-text" : "border-ui-border text-ui-accent hover:text-ui-text"
                  }`}>
                  {CHANNEL_LABEL[ch] ?? ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Scoring thresholds</p>
          <div className="grid grid-cols-3 gap-3">
            {(["hot_min", "warm_min", "save_min"] as const).map(k => (
              <div key={k}>
                <label className="block text-xs text-ui-accent mb-1">
                  {k === "hot_min" ? "Hot (min)" : k === "warm_min" ? "Warm (min)" : "Save (min)"}
                </label>
                <input type="number" min={1} max={10} value={form[k]}
                  onChange={e => set(k, Number(e.target.value))}
                  className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text" />
              </div>
            ))}
          </div>
        </div>

        {err && <p className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{err}</p>}

        <button onClick={handleSave} disabled={saving}
          className="w-full py-3 rounded-xl bg-ui-text text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2">
          {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : "Save & go to dashboard →"}
        </button>
      </div>
    </div>
  );
}

// ── Onboarding Chat ────────────────────────────────────────────────────────────

const TOTAL_QUESTIONS = 7;

function OnboardingChat({ projectId, onDone }: { projectId: string; onDone: (cfg: AgentConfig) => void; }) {
  const [messages, setMessages]     = useState<ChatMsg[]>([]);
  const [input, setInput]           = useState("");
  const [sending, setSending]       = useState(false);
  const [connected, setConnected]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [existingConfig, setExistingConfig] = useState<AgentConfig | null>(null);
  const wsRef     = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentMsgCount = messages.filter(m => m.role === "agent").length;
  const progress = Math.min(agentMsgCount / TOTAL_QUESTIONS, 1);
  const canGenerate = agentMsgCount >= 1 && connected;

  useEffect(() => {
    fetch(`${API}/realestate/${projectId}/config`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) setExistingConfig(cfg); })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_API}/realestate/ws/onboard?project_id=${projectId}`);
    wsRef.current = ws;
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "config_ready") { setGenerating(false); onDone(msg.content as AgentConfig); }
      else if (msg.type === "agent") { setMessages(prev => [...prev, { role: "agent", text: msg.content }]); setSending(false); setGenerating(false); }
    };
    return () => ws.close();
  }, [projectId, onDone]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    wsRef.current.send(JSON.stringify({ content: text }));
    setInput(""); setSending(true);
  };

  const forceGenerate = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setGenerating(true);
    ws.send(JSON.stringify({ content: "[FORCE_GENERATE]", force: true }));
  };

  if (showManual) return <ManualSetupForm projectId={projectId} onDone={onDone} onBack={() => setShowManual(false)} />;

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto px-6 py-8">
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold text-ui-text">Tell me what you're looking for</h1>
          <button onClick={() => setShowManual(true)} className="text-xs text-ui-accent hover:text-ui-text transition-colors underline underline-offset-2">
            Set up manually
          </button>
        </div>
        <p className="text-sm text-ui-accent">Answer a few questions and I'll configure your property search agent.</p>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-ui-accent">
            {agentMsgCount === 0 ? "Starting…" : `Question ${Math.min(agentMsgCount, TOTAL_QUESTIONS)} of ~${TOTAL_QUESTIONS}`}
          </span>
          {agentMsgCount > 0 && <span className="text-[11px] text-ui-accent">{Math.round(progress * 100)}% complete</span>}
        </div>
        <div className="h-1 bg-ui-card rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {existingConfig && (
        <div className="mb-4 flex items-center justify-between gap-4 bg-blue-950 border border-blue-800 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-300">A configuration already exists for this project.</p>
          <button onClick={() => onDone(existingConfig)}
            className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold transition-colors">
            Go to Dashboard →
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 mb-4">
        {!connected && messages.length === 0 && (
          <p className="text-sm text-ui-accent flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user" ? "bg-ui-text text-white rounded-br-sm" : "bg-ui-card border border-ui-border text-ui-text rounded-bl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {(sending || generating) && (
          <div className="flex justify-start">
            <div className="bg-ui-card border border-ui-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-ui-accent flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {generating ? "Generating your search config…" : "Thinking…"}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 mb-3">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Type your answer…"
          disabled={!connected || sending || generating}
          className="flex-1 bg-ui-card border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent disabled:opacity-50" />
        <button onClick={send} disabled={!connected || sending || generating || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-ui-text text-white disabled:opacity-40 transition-opacity">
          <Send className="w-4 h-4" />
        </button>
      </div>

      <button onClick={forceGenerate} disabled={!canGenerate || sending || generating}
        className="w-full py-2.5 rounded-xl border border-blue-700 text-blue-400 text-sm font-medium hover:bg-blue-950 disabled:opacity-30 transition-colors flex items-center justify-center gap-2">
        {generating ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating config…</> : "Generate config now →"}
      </button>
      <p className="text-center text-[11px] text-ui-accent mt-1.5">Can use this anytime — sensible defaults fill any gaps</p>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-ui-card border border-ui-border rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wider text-ui-accent">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ?? "text-ui-text"}`}>{value}</p>
    </div>
  );
}

function Badge({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold border leading-snug ${className}`}>
      {children}
    </span>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ listing, onClose, onSave, onDelete }: {
  listing: Listing;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Listing>) => void;
  onDelete: (id: string) => void;
}) {
  const [status, setStatus]   = useState(listing.status);
  const [notes, setNotes]     = useState(listing.notes || "");
  const [starred, setStarred] = useState(!!listing.starred);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus(listing.status);
    setNotes(listing.notes || "");
    setStarred(!!listing.starred);
  }, [listing]);

  const handleSave = useCallback((s: string, n: string) => {
    onSave(listing.id, { status: s as Listing["status"], notes: n });
  }, [listing.id, onSave]);

  const scheduleNoteSave = (n: string) => {
    setNotes(n);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => handleSave(status, n), 1200);
  };

  return (
    <div className="absolute inset-y-0 right-0 w-[480px] bg-ui-card border-l border-ui-border z-20 overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-ui-border">
        <span className="font-semibold text-ui-text truncate max-w-[280px]">{listing.property_name || "Property"}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => { const next = !starred; setStarred(next); onSave(listing.id, { starred: next }); }}
            title={starred ? "Remove favorite" : "Mark as favorite"}
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${starred ? "text-yellow-900 bg-yellow-100 border-yellow-300" : "border-transparent bg-ui-bg text-ui-accent hover:text-yellow-800 hover:bg-yellow-50"}`}>
            <Star className={`w-4 h-4 ${starred ? "fill-yellow-400" : ""}`} />
          </button>
          <button onClick={() => onDelete(listing.id)} title="Remove listing"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-bg text-ui-accent hover:text-red-500 hover:bg-red-950 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-bg text-ui-accent hover:text-ui-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 p-5 space-y-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge className={PRIORITY_BADGE[listing.priority]}>{listing.priority} · {listing.match_score}/10</Badge>
          <Badge className={LISTING_TYPE_BADGE[listing.listing_type] ?? LISTING_TYPE_BADGE.buy}>{listing.listing_type}</Badge>
          {listing.channel && (
            <Badge className={CHANNEL_BADGE[listing.channel] ?? "text-ui-accent bg-ui-bg border-ui-border"}>
              {CHANNEL_LABEL[listing.channel] ?? listing.channel_label ?? listing.channel}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-ui-bg border border-ui-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-ui-accent mb-1">
              <DollarSign className="w-3 h-3" /><span className="text-[10px] uppercase tracking-wider">Price</span>
            </div>
            <p className="text-sm font-semibold text-ui-text">{listing.price || "—"}</p>
          </div>
          <div className="bg-ui-bg border border-ui-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-ui-accent mb-1">
              <Bed className="w-3 h-3" /><span className="text-[10px] uppercase tracking-wider">Bedrooms</span>
            </div>
            <p className="text-sm font-semibold text-ui-text">{listing.bedrooms || "—"}</p>
          </div>
          <div className="bg-ui-bg border border-ui-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-ui-accent mb-1">
              <MapPin className="w-3 h-3" /><span className="text-[10px] uppercase tracking-wider">Location</span>
            </div>
            <p className="text-sm font-semibold text-ui-text">{listing.locality || "—"}{listing.city ? `, ${listing.city}` : ""}</p>
          </div>
          <div className="bg-ui-bg border border-ui-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-ui-accent mb-1">
              <Home className="w-3 h-3" /><span className="text-[10px] uppercase tracking-wider">Type / Area</span>
            </div>
            <p className="text-sm font-semibold text-ui-text">{listing.property_type || "—"}{listing.area_sqft ? ` · ${listing.area_sqft}` : ""}</p>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Why it matches</p>
          <p className="text-sm text-ui-accent leading-relaxed">{listing.match_reason || "—"}</p>
        </div>

        {listing.key_features && listing.key_features.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Key features</p>
            <div className="flex flex-wrap gap-1.5">
              {listing.key_features.map((f, i) => (
                <span key={i} className="text-xs bg-blue-50 border border-blue-200 text-blue-950 rounded-lg px-2.5 py-1">{f}</span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Source</p>
          <a href={listing.source_url} target="_blank" rel="noreferrer"
            className="text-xs text-blue-400 hover:underline break-all flex items-center gap-1">
            {listing.source_url || "—"} {listing.source_url && <ExternalLink className="w-3 h-3 flex-shrink-0" />}
          </a>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Status</p>
          <select value={status} onChange={e => { setStatus(e.target.value as Listing["status"]); handleSave(e.target.value, notes); }}
            className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text">
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="contacted">Contacted</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Notes</p>
          <textarea value={notes} onChange={e => scheduleNoteSave(e.target.value)}
            placeholder="Add notes…" rows={3}
            className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text resize-y placeholder:text-ui-accent" />
        </div>
      </div>
    </div>
  );
}

// ── Refine Search Chat ─────────────────────────────────────────────────────────

const REFINE_GREETING = "Sure — what would you like to change about the current search? I'll make targeted adjustments while keeping everything that's working.";

function RefineSearchChat({
  projectId, onDone, onClose,
}: {
  projectId: string;
  onDone: (cfg: AgentConfig) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [wsReady, setWsReady]   = useState(false);
  const [revised, setRevised]   = useState(false);
  const wsRef     = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wsRef.current) return;
    const ws = new WebSocket(`${WS_API}/realestate/ws/refine?project_id=${projectId}`);
    wsRef.current = ws;
    ws.onopen = () => setWsReady(true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "agent" && msg.content === REFINE_GREETING) return;
      if (msg.type === "config_ready") {
        setRevised(true);
        setMessages(prev => [...prev, { role: "agent", text: "Search criteria updated. Close this panel and click \"Run search\" to find new listings." }]);
        setSending(false); onDone(msg.content as AgentConfig);
      } else if (msg.type === "error" || msg.type === "agent") {
        setMessages(prev => [...prev, { role: "agent", text: msg.content }]); setSending(false);
      }
    };
    ws.onerror = () => { setMessages(prev => [...prev, { role: "agent", text: "Connection error. Please close and reopen this panel." }]); setSending(false); };
    return () => {};
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  const send = () => {
    const text = input.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || revised || sending) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    ws.send(JSON.stringify({ content: text }));
    setInput(""); setSending(true);
  };

  return (
    <div className="absolute inset-0 bg-ui-bg z-30 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border">
        <div>
          <h2 className="font-semibold text-ui-text">Refine search criteria</h2>
          <p className="text-xs text-ui-accent mt-0.5">Tell the agent what to change — it'll adjust the search approach.</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-card text-ui-accent hover:text-ui-text transition-colors border border-ui-border">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 max-w-2xl w-full mx-auto">
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed bg-ui-card border border-ui-border text-ui-text">
            {REFINE_GREETING}
          </div>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user" ? "bg-ui-text text-white rounded-br-sm" : "bg-ui-card border border-ui-border text-ui-text rounded-bl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-ui-card border border-ui-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-ui-accent flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Refining search…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {!revised && (
        <div className="px-6 pb-6 max-w-2xl w-full mx-auto flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={wsReady ? "Describe what to change…" : "Connecting…"}
            disabled={!wsReady || sending}
            className="flex-1 bg-ui-card border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent disabled:opacity-50" />
          <button onClick={send} disabled={!wsReady || sending || !input.trim()}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-ui-text text-white disabled:opacity-40 transition-opacity">
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Context Inspector ──────────────────────────────────────────────────────────

function ContextInspector({ context }: { context: AgentContext }) {
  const totalQueries = (context.search_queries ?? []).reduce((n, g) => n + (g.queries?.length ?? 0), 0);
  const hot  = context.score_thresholds?.hot_min  ?? 8;
  const warm = context.score_thresholds?.warm_min ?? 5;
  const save = context.score_thresholds?.save_min ?? 3;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-ui-card border border-ui-border rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              <Home className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ui-text truncate">{context.config.agent_name || "RE Agent"}</p>
              <p className="text-xs text-ui-accent truncate capitalize">{context.config.listing_type} · {context.config.bedrooms}</p>
            </div>
          </div>
          <div className="border-t border-ui-border pt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Budget</span>
              <span className="text-ui-text font-medium truncate max-w-[60%] text-right">{context.config.budget_range || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Location</span>
              <span className="text-ui-text font-medium truncate max-w-[60%] text-right">{context.config.location_preference || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Geo</span>
              <span className="text-ui-text font-medium">{context.search_geo || "—"}</span>
            </div>
          </div>
        </div>

        <div className="bg-ui-card border border-ui-border rounded-xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-1">Scoring thresholds</p>
          <div className="flex gap-3 mb-3">
            {[
              { label: "Hot",  score: hot,  cls: PRIORITY_BADGE.hot },
              { label: "Warm", score: warm, cls: PRIORITY_BADGE.warm },
              { label: "Save", score: save, cls: "text-slate-700 bg-slate-100 border-slate-200" },
            ].map(({ label, score, cls }) => (
              <div key={label} className={`flex-1 flex flex-col items-center py-2 rounded-lg border ${cls}`}>
                <span className="text-lg font-bold leading-none">{score}+</span>
                <span className="text-[10px] mt-0.5 font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-ui-card border border-ui-border rounded-xl p-5 flex flex-col justify-between">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Search coverage</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Signal groups", value: context.search_queries.length },
              { label: "Total queries",  value: totalQueries },
              { label: "Results / query", value: context.max_results_per_query },
              { label: "Batch size",     value: context.batch_size === 0 ? "∞" : context.batch_size },
            ].map(({ label, value }) => (
              <div key={label} className="bg-ui-bg border border-ui-border rounded-lg p-2.5">
                <p className="text-[10px] text-ui-accent">{label}</p>
                <p className="text-xl font-bold text-ui-text">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {context.search_channels.map(ch => {
              const cfg = RE_CHANNEL_CONFIG[ch] ?? { label: ch, color: "bg-ui-bg border-ui-border text-ui-accent", dot: "bg-gray-500" };
              return (
                <span key={ch} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${cfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-ui-card border border-ui-border rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-2">Must-haves</p>
          <div className="space-y-2">
            {context.must_haves.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-green-950/40 border border-green-900 rounded-lg px-3 py-2">
                <span className="text-green-400 font-bold flex-shrink-0 mt-px">+</span>
                <span className="text-green-200 leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-ui-card border border-ui-border rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-2">Nice-to-haves</p>
          <div className="space-y-2">
            {context.nice_to_haves.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-blue-950/40 border border-blue-900 rounded-lg px-3 py-2">
                <span className="text-blue-400 font-bold flex-shrink-0 mt-px">~</span>
                <span className="text-blue-200 leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-ui-card border border-ui-border rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-red-400 font-semibold mb-2">Deal breakers</p>
          <div className="space-y-2">
            {context.deal_breakers.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
                <span className="text-red-400 font-bold flex-shrink-0 mt-px">✕</span>
                <span className="text-red-200 leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-2">
          Search queries — {totalQueries} queries across {context.search_queries.length} groups
        </p>
        <div className="space-y-2">
          {context.search_queries.map((g, i) => (
            <div key={i} className="border border-ui-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-ui-bg flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wider">{g.signal}</span>
                <span className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-900 px-1.5 py-0.5 rounded-full font-medium">{g.queries.length} queries</span>
              </div>
              <div className="p-3 flex flex-wrap gap-1.5 border-t border-ui-border bg-ui-card">
                {g.queries.map((q, j) => (
                  <span key={j} className="text-[11px] bg-ui-bg border border-ui-border rounded-lg px-2.5 py-1 text-ui-text font-mono leading-snug">{q}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {context.starred_listings.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-amber-900 font-semibold mb-2">
            Favorites — {context.starred_listings.length} starred listing{context.starred_listings.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {context.starred_listings.map((l, i) => (
              <div key={i} className={`bg-ui-card border-l-4 border border-ui-border rounded-xl p-3 ${
                l.match_score >= hot ? PRIORITY_BORDER.hot : l.match_score >= warm ? PRIORITY_BORDER.warm : PRIORITY_BORDER.cold
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-ui-text truncate">{l.property_name}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${
                    l.match_score >= hot ? PRIORITY_BADGE.hot : l.match_score >= warm ? PRIORITY_BADGE.warm : PRIORITY_BADGE.cold
                  }`}>{l.match_score}/10</span>
                </div>
                <p className="text-[11px] text-ui-accent">{l.locality}, {l.city} · {l.price} · {l.bedrooms}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Link ───────────────────────────────────────────────────────────────────

function AddLinkInput({ projectId, onAdded }: {
  projectId: string;
  onAdded: (listing: Listing) => void;
}) {
  const [url, setUrl]         = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState("");

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setSuccess(false);
    try {
      const r = await fetch(`${API}/realestate/${projectId}/listings/from-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.detail ?? "Failed to extract listing");
        return;
      }
      const listing: Listing = await r.json();
      onAdded(listing);
      setUrl("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Network error — check if backend is running");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ui-accent" />
          <input
            value={url}
            onChange={e => { setUrl(e.target.value); setError(""); setSuccess(false); }}
            onKeyDown={e => e.key === "Enter" && !loading && submit()}
            placeholder="Paste a property URL to auto-extract details…"
            disabled={loading}
            className="w-full bg-ui-card border border-ui-border rounded-lg pl-9 pr-3 py-2 text-sm text-ui-text placeholder:text-ui-accent focus:outline-none focus:border-blue-400 disabled:opacity-60 transition-colors"
          />
        </div>
        <button
          onClick={submit}
          disabled={loading || !url.trim()}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            loading
              ? "bg-blue-100 text-blue-600 border border-blue-200"
              : success
                ? "bg-emerald-600 text-white"
                : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          }`}
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Extracting…</>
          ) : success ? (
            <><CheckCircle2 className="w-3.5 h-3.5" /> Added</>
          ) : (
            <><Plus className="w-3.5 h-3.5" /> Add listing</>
          )}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500 px-1">{error}</p>}
    </div>
  );
}

// ── Kanban Board ───────────────────────────────────────────────────────────────

const KANBAN_COLUMNS: { key: Listing["status"]; label: string; accent: string; headerBg: string; dropBg: string; count_accent: string }[] = [
  { key: "new",       label: "New",       accent: "border-t-blue-500",    headerBg: "bg-blue-50",    dropBg: "bg-blue-50/50",  count_accent: "text-blue-700 bg-blue-100 border-blue-200" },
  { key: "reviewed",  label: "Reviewed",  accent: "border-t-amber-500",   headerBg: "bg-amber-50",   dropBg: "bg-amber-50/50", count_accent: "text-amber-700 bg-amber-100 border-amber-200" },
  { key: "contacted", label: "Contacted", accent: "border-t-emerald-500", headerBg: "bg-emerald-50", dropBg: "bg-emerald-50/50", count_accent: "text-emerald-700 bg-emerald-100 border-emerald-200" },
  { key: "archived",  label: "Archived",  accent: "border-t-slate-400",   headerBg: "bg-slate-50",   dropBg: "bg-slate-50/50", count_accent: "text-slate-600 bg-slate-100 border-slate-200" },
];

function KanbanCard({ listing, onSelect, onSave, onDelete }: {
  listing: Listing;
  onSelect: (l: Listing) => void;
  onSave: (id: string, patch: Partial<Listing>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", listing.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(listing)}
      className={`bg-white border border-ui-border rounded-xl p-3 cursor-grab active:cursor-grabbing
        hover:shadow-md transition-shadow group border-l-4 ${PRIORITY_BORDER[listing.priority]}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border flex-shrink-0 ${PRIORITY_BADGE[listing.priority] ?? ""}`}>
            {listing.match_score}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ui-text truncate leading-tight flex items-center gap-1">
              {listing.starred && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
              {listing.property_name || "—"}
            </p>
          </div>
        </div>
        <GripVertical className="w-3.5 h-3.5 text-ui-accent opacity-0 group-hover:opacity-40 flex-shrink-0 mt-0.5" />
      </div>

      <div className="space-y-1.5 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-ui-accent">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{listing.locality || "—"}{listing.city ? `, ${listing.city}` : ""}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[11px] text-ui-text font-medium">
            <DollarSign className="w-3 h-3 text-ui-accent flex-shrink-0" />
            <span className="truncate">{listing.price || "—"}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-ui-accent">
            <Bed className="w-3 h-3 flex-shrink-0" />
            <span>{listing.bedrooms || "—"}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-1">
        <div className="flex flex-wrap gap-1">
          <Badge className={`${PRIORITY_BADGE[listing.priority]} !text-[9px] !px-1.5 !py-0.5`}>{listing.priority}</Badge>
          <Badge className={`${LISTING_TYPE_BADGE[listing.listing_type] ?? "text-slate-700 bg-slate-100 border-slate-200"} !text-[9px] !px-1.5 !py-0.5`}>
            {listing.listing_type || "—"}
          </Badge>
          {listing.channel && (
            <Badge className={`${CHANNEL_BADGE[listing.channel] ?? "text-slate-800 bg-slate-100 border-slate-200"} !text-[9px] !px-1.5 !py-0.5`}>
              {CHANNEL_LABEL[listing.channel] ?? listing.channel}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); const next = !listing.starred; onSave(listing.id, { starred: next }); }}
            title={listing.starred ? "Unstar" : "Star"}
            className={`p-1 rounded transition-colors ${listing.starred ? "text-yellow-500" : "text-ui-accent hover:text-yellow-500"}`}>
            <Star className={`w-3 h-3 ${listing.starred ? "fill-yellow-400" : ""}`} />
          </button>
          {listing.source_url && (
            <button onClick={e => { e.stopPropagation(); window.open(listing.source_url, "_blank"); }}
              className="p-1 rounded text-ui-accent hover:text-blue-500 transition-colors">
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); handleKanbanDelete(listing.id); }}
            className="p-1 rounded text-ui-accent hover:text-red-500 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {listing.match_reason && (
        <p className="text-[10px] text-ui-accent mt-2 line-clamp-2 leading-snug">{listing.match_reason}</p>
      )}
    </div>
  );

  function handleKanbanDelete(id: string) { onDelete(id); }
}

function KanbanColumn({ col, listings, onDrop, onSelect, onSave, onDelete }: {
  col: typeof KANBAN_COLUMNS[number];
  listings: Listing[];
  onDrop: (listingId: string, newStatus: Listing["status"]) => void;
  onSelect: (l: Listing) => void;
  onSave: (id: string, patch: Partial<Listing>) => void;
  onDelete: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col min-w-[260px] max-w-[320px] flex-1 rounded-xl border border-ui-border border-t-[3px] ${col.accent} bg-ui-card transition-colors ${dragOver ? col.dropBg : ""}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const listingId = e.dataTransfer.getData("text/plain");
        if (listingId) onDrop(listingId, col.key);
      }}
    >
      <div className={`flex items-center justify-between px-4 py-3 ${col.headerBg} rounded-t-xl border-b border-ui-border`}>
        <span className="text-xs font-semibold text-ui-text uppercase tracking-wider">{col.label}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${col.count_accent}`}>{listings.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {listings.length === 0 && (
          <div className={`flex items-center justify-center h-20 rounded-lg border-2 border-dashed border-ui-border text-ui-accent text-[11px] transition-colors ${dragOver ? "border-blue-300 text-blue-500" : ""}`}>
            {dragOver ? "Drop here" : "No listings"}
          </div>
        )}
        {listings.map(l => (
          <KanbanCard key={l.id} listing={l} onSelect={onSelect} onSave={onSave} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function KanbanBoard({ listings, onStatusChange, onSelect, onSave, onDelete }: {
  listings: Listing[];
  onStatusChange: (id: string, newStatus: Listing["status"]) => void;
  onSelect: (l: Listing) => void;
  onSave: (id: string, patch: Partial<Listing>) => void;
  onDelete: (id: string) => void;
}) {
  const grouped = KANBAN_COLUMNS.map(col => ({
    col,
    items: listings.filter(l => l.status === col.key),
  }));

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 h-full">
      {grouped.map(({ col, items }) => (
        <KanbanColumn
          key={col.key}
          col={col}
          listings={items}
          onDrop={onStatusChange}
          onSelect={onSelect}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

type Filter = { field: string; value: string };
type View = "listings" | "log" | "context";
type ListingMode = "table" | "kanban";

function Dashboard({
  project, config, onConfigUpdated, onSwitchProject,
}: {
  project: Project; config: AgentConfig;
  onConfigUpdated: (cfg: AgentConfig) => void;
  onSwitchProject: () => void;
}) {
  const pid = project.id;
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats]       = useState<Stats>({ total: 0, new: 0, hot: 0, contacted: 0, reviewed: 0 });
  const [log, setLog]           = useState("");
  const [view, setView]         = useState<View>("listings");
  const [filter, setFilter]     = useState<Filter>({ field: "", value: "" });
  const [selected, setSelected] = useState<Listing | null>(null);
  const [jobStatus, setJobStatus] = useState<{ job: string; state: string; detail: string; ts: string } | null>(null);
  const [toast, setToast]       = useState("");
  const [refining, setRefining] = useState(false);
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);
  const [search, setSearch]     = useState("");
  const [searchHistoryCount, setSearchHistoryCount] = useState(0);
  const [listingMode, setListingMode] = useState<ListingMode>("table");

  const running = jobStatus?.job === "run" && jobStatus?.state === "running";
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const fetchStats    = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/stats`); if (r.ok) setStats(await r.json()); }, [pid]);
  const fetchListings = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/listings`); if (r.ok) setListings(await r.json()); }, [pid]);
  const fetchLog      = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/log`); if (r.ok) { const d = await r.json(); setLog(d.log); } }, [pid]);
  const fetchContext   = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/context`); if (r.ok) setAgentContext(await r.json()); }, [pid]);
  const fetchStatus    = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/status`); if (r.ok) setJobStatus(await r.json()); }, [pid]);
  const fetchSearchHistory = useCallback(async () => { const r = await fetch(`${API}/realestate/${pid}/search-history`); if (r.ok) { const d = await r.json(); setSearchHistoryCount(d.total ?? 0); } }, [pid]);

  const clearSearchHistory = async () => {
    await fetch(`${API}/realestate/${pid}/search-history`, { method: "DELETE" });
    setSearchHistoryCount(0);
    showToast("Search history cleared — all queries will run fresh");
  };

  const prevStateRef   = useRef<string>("");
  const liveRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStatus(); fetchStats(); fetchListings(); fetchSearchHistory();
    const statusIv = setInterval(async () => {
      const r = await fetch(`${API}/realestate/${pid}/status`);
      if (!r.ok) return;
      const s = await r.json();
      setJobStatus(s);
      const wasRunning = prevStateRef.current === "running";
      const isRunning  = s.state === "running";
      if (isRunning && !liveRefreshRef.current) {
        liveRefreshRef.current = setInterval(() => { fetchStats(); fetchListings(); }, 8000);
      }
      if (wasRunning && !isRunning) {
        if (liveRefreshRef.current) { clearInterval(liveRefreshRef.current); liveRefreshRef.current = null; }
        fetchStats(); fetchListings(); fetchSearchHistory();
      }
      prevStateRef.current = s.state;
    }, 3000);
    const idleIv = setInterval(() => { if (!liveRefreshRef.current) { fetchStats(); fetchListings(); } }, 30_000);
    return () => { clearInterval(statusIv); clearInterval(idleIv); if (liveRefreshRef.current) clearInterval(liveRefreshRef.current); };
  }, [pid, fetchStatus, fetchStats, fetchListings]);

  useEffect(() => { if (view === "log") fetchLog(); }, [view, fetchLog]);
  useEffect(() => { if (view === "context") fetchContext(); }, [view, fetchContext]);

  const handleSave = useCallback(async (id: string, patch: Partial<Listing>) => {
    const r = await fetch(`${API}/realestate/${pid}/listings/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (r.ok) {
      const updated: Listing = await r.json();
      setListings(prev => prev.map(l => l.id === id ? updated : l));
      if (selected?.id === id) setSelected(updated);
      fetchStats(); showToast("Saved");
    }
  }, [pid, selected, fetchStats]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`${API}/realestate/${pid}/listings/${id}`, { method: "DELETE" });
    setListings(prev => prev.filter(l => l.id !== id));
    if (selected?.id === id) setSelected(null);
    fetchStats();
  }, [pid, selected, fetchStats]);

  const triggerRun = async () => {
    const r = await fetch(`${API}/realestate/${pid}/run`, { method: "POST" });
    if (r.ok) { showToast("Agent started — new listings will appear as they're found"); fetchStatus(); }
    else { const e = await r.json().catch(() => ({})); showToast(e.detail ?? "Failed to start agent"); }
  };

  const triggerStop = async () => {
    await fetch(`${API}/realestate/${pid}/stop`, { method: "POST" });
    showToast("Agent stopped"); fetchStatus();
  };

  const deleteAllAndRerun = async () => {
    if (!confirm(`Delete all ${listings.length} listings and start a fresh search?`)) return;
    await fetch(`${API}/realestate/${pid}/listings`, { method: "DELETE" });
    setListings([]);
    setSelected(null);
    setSearchHistoryCount(0);
    fetchStats();
    showToast("All listings cleared — starting fresh search…");
    setTimeout(async () => {
      const r = await fetch(`${API}/realestate/${pid}/run`, { method: "POST" });
      if (r.ok) fetchStatus();
    }, 500);
  };

  const displayed = listings.filter(l => {
    if (filter.field) {
      const raw = l[filter.field as keyof Listing];
      if (filter.value === "true" && raw !== true) return false;
      if (filter.value === "false" && raw === true) return false;
      if (filter.value !== "true" && filter.value !== "false" && (raw as string) !== filter.value) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (l.property_name || "").toLowerCase();
      const loc  = (l.locality || "").toLowerCase();
      const city = (l.city || "").toLowerCase();
      const price = (l.price || "").toLowerCase();
      const reason = (l.match_reason || "").toLowerCase();
      if (!name.includes(q) && !loc.includes(q) && !city.includes(q) && !price.includes(q) && !reason.includes(q)) return false;
    }
    return true;
  });

  const downloadCsv = useCallback(() => {
    const cols = ["property_name", "property_type", "locality", "city", "price", "bedrooms", "area_sqft", "match_score", "priority", "listing_type", "status", "match_reason", "source_url", "found_at", "notes"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [cols.join(","), ...displayed.map(l => cols.map(c => escape(l[c as keyof Listing])).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${project.name}-listings.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [displayed, project.name]);

  const navItem = (label: string, v: View, ff = "", fv = "") => (
    <button onClick={() => { setView(v); setFilter(ff ? { field: ff, value: fv } : { field: "", value: "" }); }}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
        view === v && (ff ? filter.field === ff && filter.value === fv : filter.field === "") ? "bg-ui-bg text-ui-text font-medium" : "text-ui-accent hover:text-ui-text hover:bg-ui-bg"
      }`}>
      {label}
    </button>
  );

  return (
    <div className="h-full flex overflow-hidden bg-ui-bg text-ui-text text-sm relative">
      <aside className="w-52 flex-shrink-0 bg-ui-card border-r border-ui-border p-4 flex flex-col gap-1">
        <p className="text-[11px] font-semibold text-ui-text px-3 py-1 truncate">{project.name}</p>
        <p className="text-[10px] text-ui-accent px-3 mb-1 truncate capitalize">{config.listing_type} · {config.bedrooms}</p>
        <button onClick={onSwitchProject}
          className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-ui-accent hover:text-ui-text transition-colors rounded mb-1">
          <ArrowLeft className="w-3 h-3" /> Switch project
        </button>
        <div className="border-t border-ui-border mb-2" />
        <p className="text-[10px] uppercase tracking-wider text-ui-accent px-3 py-1">Pipeline</p>
        {navItem("All Listings", "listings")}
        {navItem("Hot Matches", "listings", "priority", "hot")}
        {navItem("Favorites", "listings", "starred", "true")}
        {navItem("New", "listings", "status", "new")}
        {navItem("Reviewed", "listings", "status", "reviewed")}
        <button onClick={() => { setView("listings"); setFilter({ field: "", value: "" }); setListingMode("kanban"); }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
            view === "listings" && listingMode === "kanban" ? "bg-ui-bg text-ui-text font-medium" : "text-ui-accent hover:text-ui-text hover:bg-ui-bg"
          }`}>
          <LayoutGrid className="w-3.5 h-3.5" /> Kanban Board
        </button>
        <p className="text-[10px] uppercase tracking-wider text-ui-accent px-3 py-1 mt-3">System</p>
        {navItem("Agent Context", "context")}
        {navItem("Agent Log", "log")}
        <div className="flex-1" />

        {running && (
          <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-950 text-[11px] font-medium flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="truncate flex-1">{jobStatus?.detail || "Searching for properties…"}</span>
          </div>
        )}
        {!running && jobStatus?.state === "error" && (
          <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-400 text-[11px] truncate" title={jobStatus?.detail}>
            Last run failed
          </div>
        )}

        {running ? (
          <button onClick={triggerStop}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors">
            <Square className="w-3.5 h-3.5" /> Stop search
          </button>
        ) : (
          <button onClick={triggerRun} disabled={running}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ui-text text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
            <Play className="w-3.5 h-3.5" /> Run search
          </button>
        )}
        {searchHistoryCount > 0 && (
          <button onClick={clearSearchHistory} disabled={running}
            title={`${searchHistoryCount} queries cached`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-yellow-800 text-yellow-400 text-xs font-medium hover:text-yellow-300 disabled:opacity-40 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Re-search all ({searchHistoryCount})
          </button>
        )}
        {listings.length > 0 && (
          <button onClick={deleteAllAndRerun} disabled={running}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-800 text-red-400 text-xs font-medium hover:text-red-300 disabled:opacity-40 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Clear all & re-search
          </button>
        )}
        <button onClick={() => setRefining(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 transition-colors">
          Results not right?
        </button>
        <button onClick={downloadCsv} disabled={displayed.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 disabled:opacity-40 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </aside>

      <main className={`flex-1 p-6 ${listingMode === "kanban" && view === "listings" ? "overflow-hidden flex flex-col" : "overflow-y-auto"}`}>
        <div className="grid grid-cols-6 gap-3 mb-4 flex-shrink-0">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="New" value={stats.new} accent="text-blue-400" />
          <StatCard label="Hot" value={stats.hot} accent="text-orange-400" />
          <StatCard label="Favorites" value={stats.starred ?? 0} accent="text-yellow-400" />
          <StatCard label="Reviewed" value={stats.reviewed} />
          <StatCard label="Contacted" value={stats.contacted} />
        </div>

        {view === "listings" && (
          <div className="mb-4 flex-shrink-0">
            <AddLinkInput
              projectId={pid}
              onAdded={(listing) => {
                setListings(prev => {
                  const exists = prev.find(l => l.id === listing.id);
                  if (exists) return prev.map(l => l.id === listing.id ? listing : l);
                  return [listing, ...prev];
                });
                fetchStats();
              }}
            />
          </div>
        )}

        {view === "listings" && (
          <>
            {/* Search bar + view toggle + filter pills */}
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by property name, location, price…"
                  className="flex-1 bg-ui-card border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent focus:outline-none focus:border-gray-400" />
                <div className="flex items-center bg-ui-card border border-ui-border rounded-lg p-0.5">
                  <button onClick={() => setListingMode("table")} title="Table view"
                    className={`p-1.5 rounded-md transition-colors ${listingMode === "table" ? "bg-ui-text text-white" : "text-ui-accent hover:text-ui-text"}`}>
                    <List className="w-4 h-4" />
                  </button>
                  <button onClick={() => setListingMode("kanban")} title="Kanban view"
                    className={`p-1.5 rounded-md transition-colors ${listingMode === "kanban" ? "bg-ui-text text-white" : "text-ui-accent hover:text-ui-text"}`}>
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {listingMode === "table" && (
                <div className="flex flex-wrap gap-2">
                  {([
                    { label: "All", field: "", value: "", idle: "border-ui-border bg-white text-ui-text shadow-sm", active: "bg-ui-text text-white border-ui-text shadow-sm" },
                    { label: "Hot", field: "priority", value: "hot", idle: "border-orange-200 bg-orange-50 text-orange-950", active: "bg-orange-600 text-white border-orange-600" },
                    { label: "Warm", field: "priority", value: "warm", idle: "border-amber-200 bg-amber-50 text-amber-950", active: "bg-amber-500 text-white border-amber-500" },
                    { label: "Favorites", field: "starred", value: "true", idle: "border-yellow-300 bg-yellow-50 text-yellow-950", active: "bg-yellow-500 text-white border-yellow-500" },
                    { label: "New", field: "status", value: "new", idle: "border-blue-200 bg-blue-50 text-blue-950", active: "bg-blue-700 text-white border-blue-700" },
                    { label: "Reviewed", field: "status", value: "reviewed", idle: "border-amber-200 bg-amber-50 text-amber-950", active: "bg-amber-600 text-white border-amber-600" },
                  ] as const).map(({ label, field, value, idle, active }) => (
                    <button key={label} onClick={() => setFilter({ field, value })}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        filter.field === field && filter.value === value ? active : idle
                      } hover:opacity-95`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {displayed.length !== listings.length && listingMode === "table" && (
                <p className="text-[11px] text-ui-accent">Showing {displayed.length} of {listings.length} listings</p>
              )}
            </div>

            {/* Kanban view */}
            {listingMode === "kanban" && (
              listings.length === 0 ? (
                <div className="text-center py-20 text-ui-accent">
                  <p className="text-lg font-medium text-ui-text mb-1">No listings yet</p>
                  <p>Click "Run search" to start finding properties.</p>
                </div>
              ) : (
                <KanbanBoard
                  listings={search.trim()
                    ? listings.filter(l => {
                        const q = search.toLowerCase();
                        return (l.property_name || "").toLowerCase().includes(q)
                          || (l.locality || "").toLowerCase().includes(q)
                          || (l.city || "").toLowerCase().includes(q)
                          || (l.price || "").toLowerCase().includes(q)
                          || (l.match_reason || "").toLowerCase().includes(q);
                      })
                    : listings
                  }
                  onStatusChange={(id, newStatus) => handleSave(id, { status: newStatus })}
                  onSelect={setSelected}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              )
            )}

            {/* Table view */}
            {listingMode === "table" && (
              displayed.length === 0 ? (
                <div className="text-center py-20 text-ui-accent">
                  <p className="text-lg font-medium text-ui-text mb-1">No listings yet</p>
                  <p>Click "Run search" to start finding properties.</p>
                </div>
              ) : (
                <div className="bg-ui-card border border-ui-border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-[13px]" style={{ minWidth: 900 }}>
                    <thead>
                      <tr className="border-b border-ui-border bg-ui-bg">
                        {["", "Property", "Location", "Price", "BHK", "Type", "Portal", "Priority", "Status", "Actions"].map(h => (
                          <th key={h} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-ui-accent font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayed.map(listing => (
                        <tr key={listing.id} onClick={() => setSelected(listing)}
                          className="border-b border-ui-border last:border-b-0 cursor-pointer hover:bg-ui-bg transition-colors">
                          <td className="px-3 py-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border ${PRIORITY_BADGE[listing.priority] ?? ""}`}>
                              {listing.match_score}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-ui-text max-w-[220px]">
                            <span className="flex items-center gap-1 truncate" title={listing.property_name}>
                              {listing.starred && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                              {listing.property_name || "—"}
                            </span>
                            <span className="block text-[11px] text-ui-accent font-normal truncate mt-0.5" title={listing.match_reason}>{listing.match_reason || ""}</span>
                          </td>
                          <td className="px-3 py-2.5 text-ui-accent whitespace-nowrap text-xs">{listing.locality || "—"}{listing.city ? `, ${listing.city}` : ""}</td>
                          <td className="px-3 py-2.5 text-ui-text font-medium whitespace-nowrap text-xs">{listing.price || "—"}</td>
                          <td className="px-3 py-2.5 text-ui-accent whitespace-nowrap text-xs">{listing.bedrooms || "—"}</td>
                          <td className="px-3 py-2.5">
                            <Badge className={LISTING_TYPE_BADGE[listing.listing_type] ?? "text-slate-700 bg-slate-100 border-slate-200"}>
                              {listing.listing_type || "—"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            {listing.channel
                              ? <Badge className={CHANNEL_BADGE[listing.channel] ?? "text-slate-800 bg-slate-100 border-slate-200"}>{CHANNEL_LABEL[listing.channel] ?? listing.channel_label ?? listing.channel}</Badge>
                              : <span className="text-ui-accent text-xs">—</span>
                            }
                          </td>
                          <td className="px-3 py-2.5"><Badge className={`${PRIORITY_BADGE[listing.priority]} capitalize`}>{listing.priority}</Badge></td>
                          <td className="px-3 py-2.5"><Badge className={`${STATUS_BADGE[listing.status] ?? "text-slate-700 bg-slate-100 border-slate-200"} capitalize`}>{listing.status}</Badge></td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={e => { e.stopPropagation(); setSelected(listing); }}
                                className="px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-medium hover:opacity-90 transition-opacity">View</button>
                              {listing.source_url && (
                                <button onClick={e => { e.stopPropagation(); window.open(listing.source_url, "_blank"); }}
                                  className="p-1 rounded-md bg-ui-bg text-ui-accent hover:text-ui-text transition-colors">
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                              <button onClick={e => { e.stopPropagation(); handleDelete(listing.id); }}
                                title="Remove listing"
                                className="p-1 rounded-md bg-ui-bg text-ui-accent hover:text-red-500 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}

        {view === "log" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-ui-text">Agent log</h2>
              <button onClick={fetchLog} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ui-border rounded-lg text-ui-accent hover:text-ui-text transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            <pre className="bg-ui-card border border-ui-border rounded-xl p-4 text-xs font-mono leading-relaxed text-ui-accent whitespace-pre-wrap max-h-[600px] overflow-y-auto">
              {log || "No log yet."}
            </pre>
          </div>
        )}

        {view === "context" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div />
              <button onClick={fetchContext} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ui-border rounded-lg text-ui-accent hover:text-ui-text transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {agentContext ? <ContextInspector context={agentContext} /> : (
              <div className="text-center py-20 text-ui-accent">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /><p>Loading agent context...</p>
              </div>
            )}
          </div>
        )}
      </main>

      {selected && <DetailPanel listing={selected} onClose={() => setSelected(null)} onSave={handleSave} onDelete={handleDelete} />}

      {refining && (
        <RefineSearchChat
          projectId={pid}
          onDone={(cfg) => { onConfigUpdated(cfg); setRefining(false); showToast("Search criteria updated — run the search to find new listings"); }}
          onClose={() => setRefining(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-full z-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

type Phase = "checking" | "projects" | "onboarding" | "dashboard";

export default function RealEstateTool() {
  const [phase, setPhase]           = useState<Phase>("checking");
  const [projects, setProjects]     = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [activeProject, setActiveProject]     = useState<Project | null>(null);
  const [config, setConfig]         = useState<AgentConfig | null>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const r = await fetch(`${API}/realestate/projects`);
      if (r.ok) setProjects(await r.json());
    } finally { setLoadingProjects(false); }
  }, []);

  useEffect(() => { loadProjects().then(() => setPhase("projects")); }, [loadProjects]);

  const handleSelectProject = async (project: Project) => {
    setActiveProject(project);
    if (!project.configured) { setPhase("onboarding"); return; }
    try {
      const r = await fetch(`${API}/realestate/${project.id}/config`);
      if (r.ok) { setConfig(await r.json()); setPhase("dashboard"); }
      else setPhase("onboarding");
    } catch { setPhase("onboarding"); }
  };

  const handleOnboardingDone = (cfg: AgentConfig) => {
    setConfig(cfg);
    setPhase("dashboard");
    if (activeProject) setActiveProject({ ...activeProject, configured: true });
  };

  const handleDeleteProject = async (pid: string) => {
    try {
      const r = await fetch(`${API}/realestate/projects/${pid}`, { method: "DELETE" });
      if (r.ok) setProjects(prev => prev.filter(p => p.id !== pid));
    } catch { /* ignore */ }
  };

  const handleSwitchProject = () => {
    setActiveProject(null); setConfig(null); loadProjects(); setPhase("projects");
  };

  if (phase === "checking") {
    return <div className="h-full flex items-center justify-center text-ui-accent text-sm gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (phase === "projects") {
    return <ProjectSelector projects={projects} loading={loadingProjects} onSelect={handleSelectProject} onRefresh={loadProjects} onDelete={handleDeleteProject} />;
  }
  if (phase === "onboarding" && activeProject) {
    return <OnboardingChat projectId={activeProject.id} onDone={handleOnboardingDone} />;
  }
  if (phase === "dashboard" && activeProject && config) {
    return <Dashboard project={activeProject} config={config} onConfigUpdated={cfg => setConfig(cfg)} onSwitchProject={handleSwitchProject} />;
  }
  return <div className="h-full flex items-center justify-center text-ui-accent text-sm gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>;
}
