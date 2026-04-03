import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw, Play, X, ExternalLink, Copy, Check, Send,
  Star, Trash2, Plus, FolderOpen, ArrowLeft, Square, Download, Pencil,
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

interface OutreachEmail { subject: string; body: string; }

interface Lead {
  id: string;
  brand_name?: string;
  company_name?: string;
  [key: string]: unknown;
  category: string;
  country: string;
  fit_score: number;
  fit_reason: string;
  priority: "hot" | "warm" | "cold";
  signal_type: string;
  source_url: string;
  outreach_email: OutreachEmail;
  found_at: string;
  status: "new" | "reviewed" | "contacted" | "archived";
  notes: string;
  starred?: boolean;
  channel?: string;
  channel_label?: string;
}

interface Stats { total: number; new: number; hot: number; contacted: number; reviewed: number; starred?: number; }
interface AgentConfig { agent_name: string; sender_name: string; sender_company: string; [key: string]: unknown; }
interface ChatMsg { role: "user" | "agent"; text: string; }

interface AgentContext {
  config: { agent_name: string; sender_name: string; sender_company: string; sender_description: string; qualifier_context: string; ideal_customer_profile?: string; what_we_offer?: string };
  strong_signals: string[];
  weak_signals: string[];
  search_queries: { signal: string | string[]; queries: string[] }[];
  result_schema: { lead_name_field: string; categories: string[]; geographies: string[]; signal_types: string[] };
  score_thresholds: { hot_min: number; warm_min: number; save_min: number };
  qualifier_prompt: string;
  starred_leads: { company_name: string; signal_type: string; country: string; raw_snippet: string; fit_score: number; fit_reason: string }[];
  starred_context: string;
  search_geo: string;
  search_channels: string[];
  max_results_per_query: number;
  batch_size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function leadDisplayName(lead: Lead): string {
  return (lead.brand_name || lead.company_name || lead.lead_name as string || "Unknown") as string;
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Light-surface pills with dark label text — readable on the light BD Agent dashboard */
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
const SIGNAL_BADGE = "text-indigo-950 bg-indigo-50 border-indigo-200";
const STATUS_BADGE: Record<string, string> = {
  new:       "text-blue-900 bg-blue-50 border-blue-200",
  reviewed:  "text-amber-950 bg-amber-50 border-amber-200",
  contacted: "text-emerald-950 bg-emerald-50 border-emerald-200",
  archived:  "text-slate-600 bg-slate-100 border-slate-200",
};
const CATEGORY_BADGE = "text-ui-text bg-zinc-100 border-zinc-200";
const CHANNEL_BADGE: Record<string, string> = {
  linkedin:  "text-sky-950 bg-sky-100 border-sky-200",
  reddit:    "text-orange-950 bg-orange-100 border-orange-200",
  instagram: "text-pink-950 bg-pink-100 border-pink-200",
  facebook:  "text-indigo-950 bg-indigo-100 border-indigo-200",
  news:      "text-violet-950 bg-violet-100 border-violet-200",
  google:    "text-emerald-950 bg-emerald-100 border-emerald-200",
};

function formatSignalLabel(raw: string | string[]): string {
  const s = Array.isArray(raw) ? raw.join(", ") : (raw ?? "");
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/^string:\s*/i, "").trim();
}
const CHANNEL_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", reddit: "Reddit", instagram: "Instagram",
  facebook: "Facebook", news: "News", google: "Google",
};

// ── Add Company Modal ──────────────────────────────────────────────────────────

interface ManualLeadResult {
  saved: boolean;
  below_threshold: boolean;
  save_min: number;
  lead: Lead;
}

function AddCompanyModal({
  projectId,
  onClose,
  onAdded,
}: {
  projectId: string;
  onClose: () => void;
  onAdded: (lead: Lead) => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<ManualLeadResult | null>(null);
  const [error, setError]             = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (forceAdd = false) => {
    const name = companyName.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch(`${API}/pollen/${projectId}/leads/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: name, force_add: forceAdd }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.detail ?? "Something went wrong");
        return;
      }
      const data: ManualLeadResult = await r.json();
      setResult(data);
      if (data.saved) {
        onAdded(data.lead);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const priorityColor: Record<string, string> = {
    hot: "text-orange-600", warm: "text-amber-600", cold: "text-slate-500",
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-ui-card border border-ui-border rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ui-border">
          <h2 className="text-sm font-semibold text-ui-text">Add company manually</h2>
          <button onClick={onClose} className="text-ui-accent hover:text-ui-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!result && (
            <>
              <p className="text-xs text-ui-accent">
                Enter a company name. The agent will search for it, score it against your ICP, and add it to your leads if it qualifies.
              </p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="e.g. Acme Corp"
                  className="flex-1 bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent focus:outline-none focus:border-gray-400"
                  disabled={loading}
                />
                <button
                  onClick={() => handleSubmit()}
                  disabled={loading || !companyName.trim()}
                  className="px-4 py-2 rounded-lg bg-ui-text text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-1.5"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {loading ? "Checking…" : "Check & add"}
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </>
          )}

          {result && (
            <div className="space-y-3">
              {/* Score card */}
              <div className={`border rounded-lg p-4 ${result.saved ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-ui-text">
                    {result.lead.brand_name ?? result.lead.company_name ?? companyName}
                  </span>
                  <span className={`text-xs font-bold ${priorityColor[result.lead.priority] ?? "text-slate-500"}`}>
                    {result.lead.priority?.toUpperCase()} · {result.lead.fit_score}/10
                  </span>
                </div>
                <p className="text-xs text-ui-accent">{result.lead.fit_reason}</p>
                {result.lead.category && (
                  <p className="text-[11px] text-ui-accent mt-1">{result.lead.category} · {result.lead.country}</p>
                )}
              </div>

              {result.saved ? (
                <div className="flex items-center gap-2 text-xs text-green-700 font-medium">
                  <Check className="w-4 h-4" /> Added to your leads list
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-700">
                    Score {result.lead.fit_score}/10 is below your save threshold ({result.save_min}). This company may not fit your ICP well.
                  </p>
                  <p className="text-xs text-ui-accent">
                    You can still add it — manually added leads act as ICP examples that help refine future searches.
                  </p>
                  <button
                    onClick={() => handleSubmit(true)}
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg border border-amber-400 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors disabled:opacity-40"
                  >
                    Add anyway
                  </button>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setResult(null); setCompanyName(""); setTimeout(() => inputRef.current?.focus(), 50); }}
                  className="px-3 py-1.5 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text transition-colors"
                >
                  Check another
                </button>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Project Selector ───────────────────────────────────────────────────────────

function ProjectSelector({
  projects,
  loading,
  onSelect,
  onRefresh,
  onDelete,
  onRename,
}: {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
  onDelete: (pid: string) => void;
  onRename: (pid: string, name: string) => Promise<void>;
}) {
  const [creating, setCreating]     = useState(false);
  const [newName, setNewName]       = useState("");
  const [saving, setSaving]         = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  const startRename = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(p.id);
    setRenameVal(p.name);
  };

  const commitRename = async (pid: string) => {
    const name = renameVal.trim();
    if (name) await onRename(pid, name);
    setRenamingId(null);
  };

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/pollen/projects`, {
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-12 bg-ui-bg">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <FolderOpen className="w-6 h-6 text-green-400" />
            <h1 className="text-2xl font-semibold text-ui-text">BD Agent Projects</h1>
          </div>
          <p className="text-sm text-ui-accent">
            Each project has its own lead pipeline, search context, and configuration.
            Select a project to open its dashboard, or create a new one.
          </p>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="flex items-center gap-2 text-ui-accent text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading projects…
          </div>
        ) : projects.length === 0 && !creating ? (
          <div className="bg-ui-card border border-ui-border rounded-xl p-10 text-center mb-6">
            <FolderOpen className="w-8 h-8 text-ui-accent mx-auto mb-3" />
            <p className="text-ui-text font-medium mb-1">No projects yet</p>
            <p className="text-sm text-ui-accent">Create your first project to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-6">
            {projects.map(p => (
              <div
                key={p.id}
                className="bg-ui-card border border-ui-border hover:border-gray-400 rounded-xl p-5 text-left transition-colors group relative"
              >
                {renamingId === p.id ? (
                  <div className="flex gap-2 mb-3" onClick={e => e.stopPropagation()}>
                    <input
                      ref={renameRef}
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(p.id)}
                      className="flex-1 bg-ui-bg border border-ui-border rounded-lg px-3 py-1.5 text-sm text-ui-text"
                    />
                    <button
                      onMouseDown={e => { e.preventDefault(); commitRename(p.id); }}
                      className="p-1.5 rounded-lg bg-ui-text text-white text-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onMouseDown={e => { e.preventDefault(); setRenamingId(null); }}
                      className="p-1.5 rounded-lg border border-ui-border text-ui-accent"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onSelect(p)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2 mb-3 pr-14">
                      <span className="font-semibold text-ui-text group-hover:text-white transition-colors truncate">
                        {p.name}
                      </span>
                      <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                        p.configured
                          ? "text-green-900 bg-green-100 border-green-200"
                          : "text-amber-950 bg-amber-50 border-amber-200"
                      }`}>
                        {p.configured ? "Ready" : "Setup needed"}
                      </span>
                    </div>
                    <p className="text-xs text-ui-accent">
                      Created {fmtDate(p.created_at)}
                    </p>
                  </button>
                )}
                {renamingId !== p.id && (
                  <>
                    <button
                      onClick={e => startRename(p, e)}
                      title="Rename project"
                      className="absolute top-4 right-11 p-1.5 rounded-lg text-ui-accent hover:text-ui-text hover:bg-ui-border opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete project "${p.name}"? This cannot be undone.`)) {
                          onDelete(p.id);
                        }
                      }}
                      title="Delete project"
                      className="absolute top-4 right-4 p-1.5 rounded-lg text-ui-accent hover:text-red-400 hover:bg-red-950/50 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create new project */}
        {creating ? (
          <div className="bg-ui-card border border-ui-border rounded-xl p-5">
            <p className="text-sm font-medium text-ui-text mb-3">Name your new project</p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); }}}
                placeholder="e.g. FMCG — India"
                className="flex-1 bg-ui-bg border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || saving}
                className="px-4 py-2 rounded-xl bg-ui-text text-white text-sm font-medium disabled:opacity-40 transition-opacity"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Create"}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(""); }}
                className="w-10 h-10 flex items-center justify-center rounded-xl border border-ui-border text-ui-accent hover:text-ui-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-ui-accent mt-2">
              You'll configure this project in the next step.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-ui-border text-ui-accent hover:text-ui-text hover:border-gray-400 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New project
          </button>
        )}

        {projects.length > 0 && (
          <button
            onClick={onRefresh}
            className="mt-4 flex items-center gap-1.5 text-xs text-ui-accent hover:text-ui-text transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        )}
      </div>
    </div>
  );
}

// ── Manual Setup Form ─────────────────────────────────────────────────────────

const CHANNELS = ["linkedin", "google", "news", "reddit", "instagram", "facebook"] as const;

function ManualSetupForm({
  projectId,
  onDone,
  onBack,
}: {
  projectId: string;
  onDone: (cfg: AgentConfig) => void;
  onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [form, setForm]     = useState({
    agent_name: "",
    sender_name: "",
    sender_company: "",
    sender_description: "",
    qualifier_context: "",
    ideal_customer_profile: "",
    what_we_offer: "",
    strong_signals: "",
    weak_signals: "",
    search_queries_raw: "",
    search_channels: ["linkedin", "google", "news"] as string[],
    search_geo: "",
    max_results_per_query: 5,
    hot_min: 8,
    warm_min: 5,
    save_min: 4,
  });

  const set = (k: keyof typeof form, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const toggleChannel = (ch: string) =>
    set("search_channels", form.search_channels.includes(ch)
      ? form.search_channels.filter(c => c !== ch)
      : [...form.search_channels, ch]);

  const handleSave = async () => {
    if (!form.sender_company.trim() || !form.qualifier_context.trim()) {
      setErr("Company name and qualifier context are required.");
      return;
    }
    setSaving(true);
    setErr("");

    const strong = form.strong_signals.split("\n").map(s => s.trim()).filter(Boolean);
    const weak   = form.weak_signals.split("\n").map(s => s.trim()).filter(Boolean);

    // Parse raw query text: each non-empty line is a query under a single group
    const rawQueries = form.search_queries_raw.split("\n").map(s => s.trim()).filter(Boolean);
    const search_queries = rawQueries.length
      ? [{ signal: "general", queries: rawQueries }]
      : [{ signal: "general", queries: [`${form.sender_company} leads`, `${form.search_geo} ${form.sender_company}`] }];

    const cfg = {
      agent_name:            form.agent_name || `${form.sender_company} BD Agent`,
      sender_name:           form.sender_name,
      sender_company:        form.sender_company,
      sender_description:    form.sender_description,
      qualifier_context:     form.qualifier_context,
      ideal_customer_profile: form.ideal_customer_profile,
      what_we_offer:         form.what_we_offer,
      strong_signals:        strong.length ? strong : ["Relevant to target market"],
      weak_signals:          weak.length   ? weak   : ["Unrelated industries"],
      result_schema: {
        lead_name_field: "company_name",
        categories: ["general"],
        geographies: [form.search_geo || "global"],
        signal_types: ["general_lead"],
      },
      score_thresholds: { hot_min: form.hot_min, warm_min: form.warm_min, save_min: form.save_min },
      search_queries,
      search_channels: form.search_channels.length ? form.search_channels : ["linkedin", "google"],
      max_results_per_query: form.max_results_per_query,
      search_geo: form.search_geo || "global",
    };

    try {
      // Write config directly via the project config endpoint
      const r = await fetch(`${API}/pollen/${projectId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (r.ok) {
        onDone(cfg as AgentConfig);
      } else {
        const e = await r.json().catch(() => ({}));
        setErr(e.detail ?? "Failed to save config. Please try again.");
      }
    } catch {
      setErr("Network error. Is the backend running?");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof typeof form, placeholder = "", multiline = false) => (
    <div>
      <label className="block text-xs font-medium text-ui-accent mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={form[key] as string}
          onChange={e => set(key, e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent resize-y"
        />
      ) : (
        <input
          value={form[key] as string}
          onChange={e => set(key, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent"
        />
      )}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-ui-accent hover:text-ui-text text-sm flex items-center gap-1 transition-colors">
          ← Back to chat
        </button>
      </div>
      <h1 className="text-xl font-semibold text-ui-text mb-1">Manual setup</h1>
      <p className="text-sm text-ui-accent mb-6">Fill in your details directly — no chat required.</p>

      <div className="space-y-4">
        <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold">Identity</p>
        {field("Agent name", "agent_name", "My BD Agent")}
        {field("Sender name", "sender_name", "Jane Smith")}
        {field("Sender company *", "sender_company", "Acme Ltd")}
        {field("Sender description", "sender_description", "Head of BD | B2B SaaS for supply chain teams")}

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Targeting</p>
          {field("Qualifier context *", "qualifier_context",
            "We are Acme Ltd, a B2B SaaS company. A good lead is a mid-sized FMCG distributor expanding into new markets. We offer automated inventory reconciliation.", true)}
          {field("Ideal customer profile", "ideal_customer_profile",
            "Mid-sized distributor, 50-500 employees, operating in SEA or ME, experiencing rapid SKU growth.", true)}
          {field("What we offer", "what_we_offer",
            "We reduce manual reconciliation time by 80% — ideal for distributors onboarding new brands.", true)}
        </div>

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Signals</p>
          {field("Strong signals (one per line)", "strong_signals",
            "Distributor expanding into new region\nCompany hiring logistics roles\nNew brand partnership announced", true)}
          {field("Weak / ignore signals (one per line)", "weak_signals",
            "Retail-only business\nConsumer-facing app\nFunded less than 1 year ago", true)}
        </div>

        <div className="border-t border-ui-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Search</p>
          {field("Search queries (one per line)", "search_queries_raw",
            "FMCG distributor expanding SEA 2025\nfood distributor new warehouse opening\nMalaysia FMCG logistics hiring", true)}
          {field("Geography", "search_geo", "Malaysia, Southeast Asia")}

          <div>
            <label className="block text-xs font-medium text-ui-accent mb-2">Channels</label>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(ch => (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    form.search_channels.includes(ch)
                      ? "bg-ui-text text-white border-ui-text"
                      : "border-ui-border text-ui-accent hover:text-ui-text"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium text-ui-accent mb-1">Results per query: {form.max_results_per_query}</label>
            <input type="range" min={1} max={20} value={form.max_results_per_query}
              onChange={e => set("max_results_per_query", Number(e.target.value))}
              className="w-full" />
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

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-ui-text text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
        >
          {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : "Save & go to dashboard →"}
        </button>
      </div>
    </div>
  );
}

// ── Onboarding Chat ────────────────────────────────────────────────────────────

const TOTAL_QUESTIONS = 6;

function OnboardingChat({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (cfg: AgentConfig) => void;
}) {
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

  // Check if a config already exists for this project (escape hatch)
  useEffect(() => {
    fetch(`${API}/pollen/${projectId}/config`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) setExistingConfig(cfg); })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_API}/pollen/ws/onboard?project_id=${projectId}`);
    wsRef.current = ws;
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "config_ready") {
        setGenerating(false);
        onDone(msg.content as AgentConfig);
      } else if (msg.type === "agent") {
        setMessages(prev => [...prev, { role: "agent", text: msg.content }]);
        setSending(false);
        setGenerating(false);
      }
    };
    return () => ws.close();
  }, [projectId, onDone]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    wsRef.current.send(JSON.stringify({ content: text }));
    setInput("");
    setSending(true);
  };

  const forceGenerate = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setGenerating(true);
    ws.send(JSON.stringify({ content: "[FORCE_GENERATE]", force: true }));
  };

  if (showManual) {
    return <ManualSetupForm projectId={projectId} onDone={onDone} onBack={() => setShowManual(false)} />;
  }

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold text-ui-text">Set up your BD Agent</h1>
          <button
            onClick={() => setShowManual(true)}
            className="text-xs text-ui-accent hover:text-ui-text transition-colors underline underline-offset-2"
          >
            Set up manually
          </button>
        </div>
        <p className="text-sm text-ui-accent">
          Answer a few questions and your agent will be configured for your business.
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-ui-accent">
            {agentMsgCount === 0 ? "Starting…" : `Question ${Math.min(agentMsgCount, TOTAL_QUESTIONS)} of ~${TOTAL_QUESTIONS}`}
          </span>
          {agentMsgCount > 0 && (
            <span className="text-[11px] text-ui-accent">{Math.round(progress * 100)}% complete</span>
          )}
        </div>
        <div className="h-1 bg-ui-card rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Existing config escape hatch */}
      {existingConfig && (
        <div className="mb-4 flex items-center justify-between gap-4 bg-green-950 border border-green-800 rounded-xl px-4 py-3">
          <p className="text-sm text-green-300">A configuration already exists for this project.</p>
          <button
            onClick={() => onDone(existingConfig)}
            className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-semibold transition-colors"
          >
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 mb-4">
        {!connected && messages.length === 0 && (
          <p className="text-sm text-ui-accent flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-ui-text text-white rounded-br-sm"
                : "bg-ui-card border border-ui-border text-ui-text rounded-bl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {(sending || generating) && (
          <div className="flex justify-start">
            <div className="bg-ui-card border border-ui-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-ui-accent flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {generating ? "Generating your config…" : "Thinking…"}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2 mb-3">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Type your answer…"
          disabled={!connected || sending || generating}
          className="flex-1 bg-ui-card border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!connected || sending || generating || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-ui-text text-white disabled:opacity-40 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Generate now button — always visible after first exchange */}
      <button
        onClick={forceGenerate}
        disabled={!canGenerate || sending || generating}
        className="w-full py-2.5 rounded-xl border border-green-700 text-green-400 text-sm font-medium hover:bg-green-950 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
      >
        {generating
          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating config…</>
          : "Generate config now →"}
      </button>
      <p className="text-center text-[11px] text-ui-accent mt-1.5">
        Can use this anytime — sensible defaults fill any gaps
      </p>
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
    <span
      title={title}
      className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold border leading-snug ${className}`}
    >
      {children}
    </span>
  );
}

function CategoryBadges({ category }: { category: string }) {
  const raw = category?.trim() || "";
  if (!raw) return <Badge className={CATEGORY_BADGE}>—</Badge>;
  const parts = raw.split("|").map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return (
      <Badge className={`${CATEGORY_BADGE} max-w-[min(280px,40vw)] whitespace-normal text-left font-medium`} title={raw}>
        {raw}
      </Badge>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1 items-start max-w-[min(280px,40vw)]">
      {parts.map((p, i) => (
        <Badge key={i} className={`${CATEGORY_BADGE} whitespace-normal text-left font-medium`} title={p}>
          {p}
        </Badge>
      ))}
    </span>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({ lead, onClose, onSave, onDelete }: {
  lead: Lead;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Lead>) => void;
  onDelete: (id: string) => void;
}) {
  const [status, setStatus]     = useState(lead.status);
  const [notes, setNotes]       = useState(lead.notes || "");
  const [starred, setStarred]   = useState(!!lead.starred);
  const [copied, setCopied]     = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue]     = useState(leadDisplayName(lead));
  const nameInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus(lead.status);
    setNotes(lead.notes || "");
    setStarred(!!lead.starred);
    setNameValue(leadDisplayName(lead));
  }, [lead]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  const commitName = () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === leadDisplayName(lead)) { setEditingName(false); return; }
    // Write to whichever name field the lead uses
    const field = lead.brand_name !== undefined ? "brand_name"
                : lead.company_name !== undefined ? "company_name"
                : "lead_name";
    onSave(lead.id, { [field]: trimmed } as Partial<Lead>);
    setEditingName(false);
  };

  const handleSave = useCallback((s: string, n: string) => {
    onSave(lead.id, { status: s as Lead["status"], notes: n });
  }, [lead.id, onSave]);

  const scheduleNoteSave = (n: string) => {
    setNotes(n);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => handleSave(status, n), 1200);
  };

  const copyEmail = () => {
    const text = `Subject: ${lead.outreach_email?.subject ?? ""}\n\n${lead.outreach_email?.body ?? ""}`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="absolute inset-y-0 right-0 w-[480px] bg-ui-card border-l border-ui-border z-20 overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-ui-border">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameValue(leadDisplayName(lead)); setEditingName(false); } }}
            className="flex-1 mr-2 bg-ui-bg border border-blue-500 rounded-lg px-3 py-1.5 text-sm font-semibold text-ui-text focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            title="Click to edit name"
            className="font-semibold text-ui-text hover:text-white text-left group flex items-center gap-1.5 max-w-[260px] truncate"
          >
            <span className="truncate">{leadDisplayName(lead)}</span>
            <span className="opacity-0 group-hover:opacity-60 transition-opacity text-[10px] flex-shrink-0">✎</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const next = !starred; setStarred(next); onSave(lead.id, { starred: next }); }}
            title={starred ? "Remove from good examples" : "Mark as great lead — improves future search"}
            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${starred ? "text-yellow-900 bg-yellow-100 border-yellow-300" : "border-transparent bg-ui-bg text-ui-accent hover:text-yellow-800 hover:bg-yellow-50"}`}
          >
            <Star className={`w-4 h-4 ${starred ? "fill-yellow-400" : ""}`} />
          </button>
          <button
            onClick={() => onDelete(lead.id)}
            title="Remove this lead"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-bg text-ui-accent hover:text-red-500 hover:bg-red-950 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-bg text-ui-accent hover:text-ui-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 p-5 space-y-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge className={PRIORITY_BADGE[lead.priority]}>{lead.priority} · {lead.fit_score}/10</Badge>
          <CategoryBadges category={lead.category || ""} />
          <Badge className={SIGNAL_BADGE}>{formatSignalLabel(lead.signal_type || "")}</Badge>
          <Badge className="text-slate-800 bg-slate-100 border-slate-200">{lead.country || "—"}</Badge>
          {lead.channel && (
            <Badge className={CHANNEL_BADGE[lead.channel] ?? "text-ui-accent bg-ui-bg border-ui-border"}>
              {CHANNEL_LABEL[lead.channel] ?? lead.channel_label ?? lead.channel}
            </Badge>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Why it's a fit</p>
          <p className="text-sm text-ui-accent leading-relaxed">{lead.fit_reason || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Source</p>
          <a href={lead.source_url} target="_blank" rel="noreferrer"
            className="text-xs text-blue-400 hover:underline break-all flex items-center gap-1">
            {lead.source_url || "—"} {lead.source_url && <ExternalLink className="w-3 h-3 flex-shrink-0" />}
          </a>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Draft outreach email</p>
          <p className="text-xs font-semibold text-blue-400 mb-2 font-mono">Subject: {lead.outreach_email?.subject || "—"}</p>
          <pre className="bg-ui-bg border border-ui-border rounded-lg p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-ui-accent">
            {lead.outreach_email?.body || "—"}
          </pre>
          <button onClick={copyEmail} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-ui-bg border border-ui-border rounded-lg text-ui-accent hover:text-ui-text transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy email"}
          </button>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ui-accent mb-1.5">Status</p>
          <select value={status} onChange={e => { setStatus(e.target.value as Lead["status"]); handleSave(e.target.value, notes); }}
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
            placeholder="Add internal notes…" rows={3}
            className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text resize-y placeholder:text-ui-accent" />
        </div>
      </div>
    </div>
  );
}

// ── Correct Leads Chat ─────────────────────────────────────────────────────────

const GREETING = "Got it — what's wrong with the current leads? I'll make targeted corrections while keeping everything that's working.";

function CorrectLeadsChat({
  projectId,
  onDone,
  onClose,
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
    const ws = new WebSocket(`${WS_API}/pollen/ws/correct?project_id=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => setWsReady(true);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "agent" && msg.content === GREETING) return;

      if (msg.type === "config_ready") {
        setRevised(true);
        setMessages(prev => [...prev, {
          role: "agent",
          text: "Search strategy updated. Close this panel and click \"Run agent\" to find new leads.",
        }]);
        setSending(false);
        onDone(msg.content as AgentConfig);
      } else if (msg.type === "error" || msg.type === "agent") {
        setMessages(prev => [...prev, { role: "agent", text: msg.content }]);
        setSending(false);
      }
    };

    ws.onerror = () => {
      setMessages(prev => [...prev, { role: "agent", text: "Connection error. Please close and reopen this panel." }]);
      setSending(false);
    };

    return () => {};
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = () => {
    const text = input.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || revised || sending) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    ws.send(JSON.stringify({ content: text }));
    setInput("");
    setSending(true);
  };

  return (
    <div className="absolute inset-0 bg-ui-bg z-30 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border">
        <div>
          <h2 className="font-semibold text-ui-text">Correct lead strategy</h2>
          <p className="text-xs text-ui-accent mt-0.5">Tell the agent what's wrong — it'll revise the search approach.</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-card text-ui-accent hover:text-ui-text transition-colors border border-ui-border">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 max-w-2xl w-full mx-auto">
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed bg-ui-card border border-ui-border text-ui-text">
            {GREETING}
          </div>
        </div>

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-ui-text text-white rounded-br-sm"
                : "bg-ui-card border border-ui-border text-ui-text rounded-bl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-ui-card border border-ui-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-ui-accent flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Revising strategy…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!revised && (
        <div className="px-6 pb-6 max-w-2xl w-full mx-auto flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={wsReady ? "Describe what's wrong with the current leads…" : "Connecting…"}
            disabled={!wsReady || sending}
            className="flex-1 bg-ui-card border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!wsReady || sending || !input.trim()}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-ui-text text-white disabled:opacity-40 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Edit Config Panel ─────────────────────────────────────────────────────────

type QueryGroupDraft = { signal: string; queries: string };   // queries = newline-separated

function EditConfigPanel({
  projectId,
  context,
  onDone,
  onClose,
}: {
  projectId: string;
  context: AgentContext;
  onDone: (cfg: AgentConfig) => void;
  onClose: () => void;
}) {
  const cfg = context.config;
  const thr = context.score_thresholds ?? { hot_min: 8, warm_min: 5, save_min: 4 };

  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");
  const schema = context.result_schema ?? { lead_name_field: "company_name", categories: [], geographies: [], signal_types: [] };
  const [form, setForm]       = useState({
    agent_name:            cfg.agent_name ?? "",
    sender_name:           cfg.sender_name ?? "",
    sender_company:        cfg.sender_company ?? "",
    sender_description:    cfg.sender_description ?? "",
    qualifier_context:     cfg.qualifier_context ?? "",
    ideal_customer_profile: cfg.ideal_customer_profile ?? "",
    what_we_offer:         cfg.what_we_offer ?? "",
    strong_signals:        (context.strong_signals ?? []).join("\n"),
    weak_signals:          (context.weak_signals ?? []).join("\n"),
    search_channels:       [...(context.search_channels ?? ["linkedin", "google"])],
    search_geo:            context.search_geo ?? "",
    max_results_per_query: context.max_results_per_query ?? 5,
    hot_min:               thr.hot_min,
    warm_min:              thr.warm_min,
    save_min:              thr.save_min,
    lead_name_field:       schema.lead_name_field ?? "company_name",
    categories:            (schema.categories ?? []).join("\n"),
    geographies:           (schema.geographies ?? []).join("\n"),
    signal_types:          (schema.signal_types ?? []).join("\n"),
  });

  const [queryGroups, setQueryGroups] = useState<QueryGroupDraft[]>(() =>
    (context.search_queries ?? []).length
      ? context.search_queries.map(g => ({ signal: Array.isArray(g.signal) ? g.signal.join(", ") : g.signal, queries: g.queries.join("\n") }))
      : [{ signal: "general", queries: "" }]
  );

  const set = (k: keyof typeof form, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const toggleChannel = (ch: string) =>
    set("search_channels", (form.search_channels as string[]).includes(ch)
      ? (form.search_channels as string[]).filter(c => c !== ch)
      : [...(form.search_channels as string[]), ch]);

  const updateGroup = (i: number, k: keyof QueryGroupDraft, v: string) =>
    setQueryGroups(prev => prev.map((g, idx) => idx === i ? { ...g, [k]: v } : g));

  const addGroup = () => setQueryGroups(prev => [...prev, { signal: "new_signal", queries: "" }]);
  const removeGroup = (i: number) => setQueryGroups(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.sender_company.trim()) { setErr("Company name is required."); return; }
    setSaving(true); setErr("");

    const search_queries = queryGroups
      .map(g => ({
        signal: g.signal.trim() || "general",
        queries: g.queries.split("\n").map(s => s.trim()).filter(Boolean),
      }))
      .filter(g => g.queries.length > 0);

    // Build result_schema from form fields — signal_types auto-derived from query groups
    const formSignalTypes = form.signal_types.split("\n").map(s => s.trim()).filter(Boolean);
    const querySignalTypes = search_queries.map(g => g.signal);
    // Merge: keep user-defined signal types, add any new ones from query groups
    const mergedSignalTypes = [...new Set([...formSignalTypes, ...querySignalTypes])];

    const result_schema = {
      lead_name_field: form.lead_name_field || "company_name",
      categories:      form.categories.split("\n").map(s => s.trim()).filter(Boolean),
      geographies:     form.geographies.split("\n").map(s => s.trim()).filter(Boolean),
      signal_types:    mergedSignalTypes,
    };

    const payload = {
      agent_name:            form.agent_name || `${form.sender_company} BD Agent`,
      sender_name:           form.sender_name,
      sender_company:        form.sender_company,
      sender_description:    form.sender_description,
      qualifier_context:     form.qualifier_context,
      ideal_customer_profile: form.ideal_customer_profile,
      what_we_offer:         form.what_we_offer,
      strong_signals:        form.strong_signals.split("\n").map(s => s.trim()).filter(Boolean),
      weak_signals:          form.weak_signals.split("\n").map(s => s.trim()).filter(Boolean),
      search_queries:        search_queries.length ? search_queries : [{ signal: "general", queries: [`${form.sender_company} leads`] }],
      search_channels:       (form.search_channels as string[]).length ? form.search_channels : ["linkedin", "google"],
      search_geo:            form.search_geo,
      max_results_per_query: form.max_results_per_query,
      score_thresholds:      { hot_min: form.hot_min, warm_min: form.warm_min, save_min: form.save_min },
      result_schema,
      batch_size:            context.batch_size,
    };

    try {
      const r = await fetch(`${API}/pollen/${projectId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        onDone(payload as unknown as AgentConfig);
        onClose();
      } else {
        const e = await r.json().catch(() => ({}));
        setErr(e.detail ?? "Failed to save. Please try again.");
      }
    } catch {
      setErr("Network error. Is the backend running?");
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, k, placeholder = "", multiline = false }: {
    label: string; k: keyof typeof form; placeholder?: string; multiline?: boolean;
  }) => (
    <div>
      <label className="block text-xs font-medium text-ui-accent mb-1">{label}</label>
      {multiline ? (
        <textarea value={form[k] as string} onChange={e => set(k, e.target.value)}
          placeholder={placeholder} rows={3}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent resize-y" />
      ) : (
        <input value={form[k] as string} onChange={e => set(k, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent" />
      )}
    </div>
  );

  return (
    <div className="absolute inset-0 bg-ui-bg z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border flex-shrink-0">
        <div>
          <h2 className="font-semibold text-ui-text">Edit configuration</h2>
          <p className="text-xs text-ui-accent mt-0.5">All changes apply to the next agent run.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-ui-text text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5">
            {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Saving…</> : "Save changes"}
          </button>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-ui-card text-ui-accent hover:text-ui-text border border-ui-border transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-8">

          {err && <p className="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{err}</p>}

          {/* Identity */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Agent name" k="agent_name" placeholder="My BD Agent" />
              <Field label="Sender name" k="sender_name" placeholder="Jane Smith" />
              <Field label="Company *" k="sender_company" placeholder="Acme Ltd" />
              <Field label="Description / role" k="sender_description" placeholder="Head of BD | B2B SaaS" />
            </div>
          </section>

          {/* Targeting */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Targeting</p>
            <div className="space-y-3">
              <Field label="Qualifier context" k="qualifier_context"
                placeholder="Who you are, what a good lead looks like, what you offer." multiline />
              <Field label="Ideal customer profile" k="ideal_customer_profile"
                placeholder="Mid-sized FMCG distributor, 50-500 employees, expanding into new markets." multiline />
              <Field label="What we offer" k="what_we_offer"
                placeholder="We reduce reconciliation time by 80%. Ideal for fast-growing distributors." multiline />
            </div>
          </section>

          {/* Signals */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Signals</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-green-400 mb-1">Strong signals — one per line</label>
                <textarea value={form.strong_signals} onChange={e => set("strong_signals", e.target.value)}
                  rows={5} placeholder={"Distributor expanding into new region\nCompany hiring logistics roles"}
                  className="w-full bg-green-950/20 border border-green-900 rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent resize-y" />
              </div>
              <div>
                <label className="block text-xs font-medium text-red-400 mb-1">Weak signals — one per line</label>
                <textarea value={form.weak_signals} onChange={e => set("weak_signals", e.target.value)}
                  rows={5} placeholder={"Retail-only business\nConsumer-facing app"}
                  className="w-full bg-red-950/20 border border-red-900 rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent resize-y" />
              </div>
            </div>
          </section>

          {/* Result schema */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Lead classification</p>
            <p className="text-[11px] text-ui-accent mb-3">These fields define how the AI categorizes leads. Keep them consistent with your targeting above.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ui-accent mb-1">Lead name field</label>
                <select value={form.lead_name_field} onChange={e => set("lead_name_field", e.target.value)}
                  className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text">
                  <option value="company_name">company_name</option>
                  <option value="brand_name">brand_name</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ui-accent mb-1">Categories — one per line</label>
                  <textarea value={form.categories} onChange={e => set("categories", e.target.value)}
                    rows={4} placeholder={"Manufacturer\nWholesaler\nDistributor"}
                    className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-[11px] font-mono text-ui-text placeholder:text-ui-accent resize-y" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ui-accent mb-1">Geographies — one per line</label>
                  <textarea value={form.geographies} onChange={e => set("geographies", e.target.value)}
                    rows={4} placeholder={"India\nSoutheast Asia\nUSA"}
                    className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-[11px] font-mono text-ui-text placeholder:text-ui-accent resize-y" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ui-accent mb-1">Signal types — one per line</label>
                  <textarea value={form.signal_types} onChange={e => set("signal_types", e.target.value)}
                    rows={4} placeholder={"operational_trigger\norganizational_trigger"}
                    className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-[11px] font-mono text-ui-text placeholder:text-ui-accent resize-y" />
                  <p className="text-[10px] text-ui-accent mt-1">Auto-synced with signal group names below.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Search queries */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold">Search queries</p>
              <button onClick={addGroup}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors border border-blue-800 rounded-lg px-2.5 py-1">
                <Plus className="w-3 h-3" /> Add signal group
              </button>
            </div>
            <div className="space-y-3">
              {queryGroups.map((g, i) => (
                <div key={i} className="bg-ui-card border border-ui-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-ui-border bg-ui-bg">
                    <span className="text-[10px] text-ui-accent uppercase tracking-wider">Signal name</span>
                    <input value={g.signal} onChange={e => updateGroup(i, "signal", e.target.value)}
                      className="flex-1 bg-transparent text-xs font-semibold text-blue-300 focus:outline-none" />
                    {queryGroups.length > 1 && (
                      <button onClick={() => removeGroup(i)}
                        className="text-ui-accent hover:text-red-400 transition-colors ml-auto">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <textarea value={g.queries}
                    onChange={e => updateGroup(i, "queries", e.target.value)}
                    rows={3} placeholder="One search query per line…"
                    className="w-full bg-ui-card px-3 py-2 text-[11px] font-mono text-ui-text placeholder:text-ui-accent resize-y focus:outline-none" />
                </div>
              ))}
            </div>
          </section>

          {/* Search settings */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Search settings</p>
            <div className="space-y-4">
              <Field label="Geography" k="search_geo" placeholder="Malaysia, Southeast Asia" />
              <div>
                <label className="block text-xs font-medium text-ui-accent mb-2">Channels</label>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map(ch => {
                    const active = (form.search_channels as string[]).includes(ch);
                    const chCfg = CHANNEL_CONFIG[ch];
                    return (
                      <button key={ch} onClick={() => toggleChannel(ch)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active ? `${chCfg?.color ?? ""} opacity-100` : "border-ui-border text-ui-accent opacity-50 hover:opacity-80"
                        }`}>
                        {active && <span className={`w-1.5 h-1.5 rounded-full ${chCfg?.dot ?? "bg-gray-400"}`} />}
                        {chCfg?.label ?? ch}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ui-accent mb-1">
                  Results per query: {form.max_results_per_query}
                </label>
                <input type="range" min={1} max={20} value={form.max_results_per_query}
                  onChange={e => set("max_results_per_query", Number(e.target.value))}
                  className="w-full max-w-xs" />
              </div>
            </div>
          </section>

          {/* Scoring */}
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Scoring thresholds</p>
            <div className="grid grid-cols-3 gap-3">
              {(["hot_min", "warm_min", "save_min"] as const).map(k => (
                <div key={k}>
                  <label className="block text-xs text-ui-accent mb-1">
                    {k === "hot_min" ? "🔥 Hot (min score)" : k === "warm_min" ? "Warm (min score)" : "Save (min score)"}
                  </label>
                  <input type="number" min={1} max={10} value={form[k]}
                    onChange={e => set(k, Number(e.target.value))}
                    className="w-full bg-ui-bg border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text" />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ui-accent mt-2">
              Leads below "Save" are discarded. Hot ≥ {form.hot_min}, Warm {form.warm_min}–{form.hot_min - 1}, Cold 1–{form.warm_min - 1}.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}

// ── Context Inspector ──────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  linkedin:  { label: "LinkedIn",  color: "bg-sky-100 border-sky-200 text-sky-950",   dot: "bg-sky-500" },
  reddit:    { label: "Reddit",    color: "bg-orange-100 border-orange-200 text-orange-950", dot: "bg-orange-500" },
  instagram: { label: "Instagram", color: "bg-pink-100 border-pink-200 text-pink-950",   dot: "bg-pink-500" },
  facebook:  { label: "Facebook",  color: "bg-indigo-100 border-indigo-200 text-indigo-950", dot: "bg-indigo-500" },
  news:      { label: "News",      color: "bg-violet-100 border-violet-200 text-violet-950", dot: "bg-violet-500" },
  google:    { label: "Google",    color: "bg-emerald-100 border-emerald-200 text-emerald-950",  dot: "bg-emerald-500" },
};

function ScoreBar({ hot, warm, save }: { hot: number; warm: number; save: number }) {
  const pct = (n: number) => `${((n - 1) / 9) * 100}%`;
  return (
    <div className="mt-3">
      <div className="relative h-5 rounded-full overflow-hidden" style={{
        background: "linear-gradient(to right, #374151 0%, #374151 33%, #854d0e 33%, #854d0e 55%, #ea580c 55%, #ea580c 78%, #f97316 78%, #f97316 100%)",
      }}>
        {/* save threshold marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/40" style={{ left: pct(save) }} />
        {/* warm threshold marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/60" style={{ left: pct(warm) }} />
        {/* hot threshold marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/80" style={{ left: pct(hot) }} />
      </div>
      <div className="relative mt-1 h-4">
        <span className="absolute text-[10px] text-gray-400 -translate-x-1/2" style={{ left: pct(save) }}>
          {save} save
        </span>
        <span className="absolute text-[10px] text-yellow-400 -translate-x-1/2" style={{ left: pct(warm) }}>
          {warm} warm
        </span>
        <span className="absolute text-[10px] text-orange-400 -translate-x-1/2" style={{ left: pct(hot) }}>
          {hot} hot
        </span>
      </div>
      <div className="flex justify-between text-[10px] text-ui-accent mt-3">
        <span>1 — discard</span>
        <span>10 — perfect fit</span>
      </div>
    </div>
  );
}

function QueryGroup({ group }: { group: { signal: string | string[]; queries: string[] } }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-ui-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-ui-bg hover:bg-ui-card transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wider">
            {formatSignalLabel(group.signal)}
          </span>
          <span className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-900 px-1.5 py-0.5 rounded-full font-medium">
            {group.queries.length} queries
          </span>
        </div>
        <span className="text-ui-accent text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-3 flex flex-wrap gap-1.5 border-t border-ui-border bg-ui-card">
          {group.queries.map((q, i) => (
            <span key={i} className="text-[11px] bg-ui-bg border border-ui-border rounded-lg px-2.5 py-1 text-ui-text font-mono leading-snug">
              {q}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextInspector({ context }: { context: AgentContext }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const totalQueries = (context.search_queries ?? []).reduce((n, g) => n + (g.queries?.length ?? 0), 0);
  const initials = (context.config?.agent_name || context.config?.sender_company || "A")
    .split(" ").slice(0, 2).map(w => w?.[0] ?? "").filter(Boolean).join("").toUpperCase() || "A";
  const hot  = context.score_thresholds?.hot_min  ?? 8;
  const warm = context.score_thresholds?.warm_min ?? 5;
  const save = context.score_thresholds?.save_min ?? 4;

  return (
    <div className="space-y-5">

      {/* ── Row 1: Identity · Scoring · Coverage ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Identity card */}
        <div className="col-span-1 bg-ui-card border border-ui-border rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-ui-text truncate">{context.config.agent_name || "BD Agent"}</p>
              <p className="text-xs text-ui-accent truncate">{context.config.sender_company}</p>
            </div>
          </div>
          <div className="border-t border-ui-border pt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Sender</span>
              <span className="text-ui-text font-medium truncate max-w-[60%] text-right">{context.config.sender_name || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Role</span>
              <span className="text-ui-text font-medium truncate max-w-[60%] text-right">{context.config.sender_description || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ui-accent">Geo</span>
              <span className="text-ui-text font-medium">{context.search_geo || "—"}</span>
            </div>
          </div>
        </div>

        {/* Scoring band */}
        <div className="col-span-1 bg-ui-card border border-ui-border rounded-xl p-5">
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
          <ScoreBar
            hot={hot}
            warm={warm}
            save={save}
          />
        </div>

        {/* Coverage stats */}
        <div className="col-span-1 bg-ui-card border border-ui-border rounded-xl p-5 flex flex-col justify-between">
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
          {/* Channels */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {context.search_channels.map(ch => {
              const cfg = CHANNEL_CONFIG[ch] ?? { label: ch, color: "bg-ui-bg border-ui-border text-ui-accent", dot: "bg-gray-500" };
              return (
                <span key={ch} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${cfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Row 2: ICP · What we offer ── */}
      {(context.config.qualifier_context || context.config.ideal_customer_profile || context.config.what_we_offer) && (
        <div className="grid grid-cols-3 gap-4">
          {context.config.qualifier_context && context.config.qualifier_context !== "..." && (
            <div className="bg-ui-card border border-ui-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold mb-2">Qualifier context</p>
              <p className="text-xs text-ui-text leading-relaxed">{context.config.qualifier_context}</p>
            </div>
          )}
          {context.config.ideal_customer_profile && (
            <div className="bg-ui-card border border-ui-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-2">Ideal customer profile</p>
              <p className="text-xs text-ui-text leading-relaxed">{context.config.ideal_customer_profile}</p>
            </div>
          )}
          {context.config.what_we_offer && (
            <div className="bg-ui-card border border-ui-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-2">What we offer</p>
              <p className="text-xs text-ui-text leading-relaxed">{context.config.what_we_offer}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Row 3: Strong signals · Weak signals ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-ui-card border border-ui-border rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-3">
            Strong signals <span className="text-ui-accent normal-case">— score higher</span>
          </p>
          <div className="space-y-2">
            {context.strong_signals.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-green-950/40 border border-green-900 rounded-lg px-3 py-2">
                <span className="text-green-400 font-bold flex-shrink-0 mt-px">+</span>
                <span className="text-green-200 leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-ui-card border border-ui-border rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-red-400 font-semibold mb-3">
            Weak signals <span className="text-ui-accent normal-case">— score lower or ignore</span>
          </p>
          <div className="space-y-2">
            {context.weak_signals.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
                <span className="text-red-400 font-bold flex-shrink-0 mt-px">−</span>
                <span className="text-red-200 leading-snug">{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 4: Query groups ── */}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold mb-2">
          Search queries — {totalQueries} queries across {context.search_queries.length} signal groups
        </p>
        <div className="space-y-2">
          {context.search_queries.map((g, i) => <QueryGroup key={i} group={g} />)}
        </div>
      </div>

      {/* ── Row 5: Output schema ── */}
      <div className="bg-ui-card border border-ui-border rounded-xl p-4">
        <p className="text-[10px] uppercase tracking-wider text-ui-accent font-semibold mb-3">Output schema — fields the AI extracts per lead</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-ui-accent mb-1.5">Name field</p>
            <span className="text-xs font-mono bg-ui-bg border border-ui-border px-2 py-1 rounded text-ui-text">
              {context.result_schema.lead_name_field}
            </span>
          </div>
          <div>
            <p className="text-[10px] text-ui-accent mb-1.5">Categories</p>
            <div className="flex flex-wrap gap-1">
              {context.result_schema.categories.map((c, i) => (
                <span key={i} className="text-[10px] bg-ui-bg border border-ui-border rounded px-1.5 py-0.5 text-ui-text">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-ui-accent mb-1.5">Signal types</p>
            <div className="flex flex-wrap gap-1">
              {context.result_schema.signal_types.map((s, i) => (
                <span key={i} className="text-[10px] bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 text-indigo-950 font-medium">{formatSignalLabel(s)}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-[10px] text-ui-accent mb-1.5">Geographies</p>
          <div className="flex flex-wrap gap-1">
            {context.result_schema.geographies.map((g, i) => (
              <span key={i} className="text-[10px] bg-ui-bg border border-ui-border rounded px-1.5 py-0.5 text-ui-text">{g}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 6: Starred leads ── */}
      {context.starred_leads.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-amber-900 font-semibold mb-2">
            Starred leads — {context.starred_leads.length} positive example{context.starred_leads.length !== 1 ? "s" : ""} injected into the AI prompt
          </p>
          <div className="grid grid-cols-2 gap-2">
            {context.starred_leads.map((l, i) => {
              const priority = l.fit_score >= (context.score_thresholds?.hot_min ?? 8) ? "hot"
                             : l.fit_score >= (context.score_thresholds?.warm_min ?? 5) ? "warm" : "cold";
              return (
                <div key={i} className={`bg-ui-card border-l-4 border border-ui-border rounded-xl p-3 ${PRIORITY_BORDER[priority]}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-ui-text truncate">{l.company_name}</span>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${PRIORITY_BADGE[priority]}`}>
                      {l.fit_score}/10
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    <Badge className={SIGNAL_BADGE}>{formatSignalLabel(l.signal_type || "")}</Badge>
                    <Badge className="text-slate-800 bg-slate-100 border-slate-200">{l.country}</Badge>
                  </div>
                  {l.raw_snippet && (
                    <p className="text-[11px] text-ui-accent font-mono line-clamp-2 leading-snug">{l.raw_snippet}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Row 7: Raw prompt ── */}
      <div className="bg-ui-card border border-ui-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowPrompt(p => !p)}
          className="w-full flex items-center justify-between px-4 py-3 bg-ui-bg hover:bg-ui-card transition-colors text-left"
        >
          <span className="text-[11px] uppercase tracking-wider text-ui-accent font-semibold">
            Full AI system prompt — sent to Ollama for every lead
          </span>
          <span className="text-xs text-blue-400">{showPrompt ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {showPrompt && (
          <pre className="p-4 text-[11px] font-mono leading-relaxed text-ui-accent whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto border-t border-ui-border">
            {context.qualifier_prompt}
            {context.starred_context ? `\n\n${context.starred_context}` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Refine Queries Panel ───────────────────────────────────────────────────────

interface RefineResult {
  current:  { signal: string; queries: string[] }[];
  proposed: { signal: string; queries: string[] }[];
  dropped:  string[];
  added:    string[];
  reasoning: string;
  reference_count: number;
}

function RefineQueriesPanel({
  projectId,
  onClose,
  onApplied,
}: {
  projectId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [loading, setLoading]   = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult]     = useState<RefineResult | null>(null);
  const [error, setError]       = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/pollen/${projectId}/refine-queries`, { method: "POST" });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          setError(e.detail ?? "Refinement failed");
        } else {
          setResult(await r.json());
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const r = await fetch(`${API}/pollen/${projectId}/refine-queries/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposed: result.proposed, added: result.added }),
      });
      if (r.ok) { onApplied(); onClose(); }
      else {
        const e = await r.json().catch(() => ({}));
        setError(e.detail ?? "Apply failed");
      }
    } finally {
      setApplying(false);
    }
  };

  // Build a flat set of current query strings for diffing
  const currentSet = new Set(
    (result?.current ?? []).flatMap(g => g.queries.map(q => q.trim()))
  );
  const proposedSet = new Set(
    (result?.proposed ?? []).flatMap(g => g.queries.map(q => q.trim()))
  );
  const droppedSet = new Set(result?.dropped ?? []);
  const addedSet   = new Set(result?.added ?? []);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-ui-card border border-ui-border rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ui-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-ui-text">Refine search queries</h2>
            {result && (
              <p className="text-[11px] text-ui-accent mt-0.5">
                Based on {result.reference_count} starred / manual lead{result.reference_count !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-ui-accent hover:text-ui-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-ui-accent text-sm py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Analysing your leads and generating refined queries…
            </div>
          )}

          {error && !loading && (
            <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg p-4">{error}</div>
          )}

          {result && !loading && (
            <>
              {/* Reasoning */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
                <span className="font-semibold">Why these changes: </span>{result.reasoning}
              </div>

              {/* Stats row */}
              <div className="flex gap-4 text-xs">
                <span className="text-green-700 font-medium">+{result.added.length} new queries</span>
                <span className="text-red-600 font-medium">−{result.dropped.length} removed</span>
                <span className="text-ui-accent">{result.proposed.flatMap(g => g.queries).length} total after</span>
              </div>

              {/* Proposed queries grouped by signal, with diff colouring */}
              <div className="space-y-3">
                {result.proposed.map(group => (
                  <div key={group.signal} className="border border-ui-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-ui-bg border-b border-ui-border">
                      <span className="text-[11px] font-semibold text-ui-text uppercase tracking-wide">
                        {group.signal.replace(/_/g, " ")}
                      </span>
                    </div>
                    <ul className="divide-y divide-ui-border">
                      {group.queries.map((q, i) => {
                        const isNew = addedSet.has(q.trim()) || !currentSet.has(q.trim());
                        return (
                          <li key={i} className={`flex items-start gap-2 px-3 py-2 text-xs ${isNew ? "bg-green-50" : "bg-white"}`}>
                            <span className={`mt-0.5 font-bold flex-shrink-0 ${isNew ? "text-green-600" : "text-ui-accent"}`}>
                              {isNew ? "+" : " "}
                            </span>
                            <span className={isNew ? "text-green-900" : "text-ui-text"}>{q}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Dropped queries */}
              {result.dropped.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-red-50 border-b border-red-200">
                    <span className="text-[11px] font-semibold text-red-800 uppercase tracking-wide">Removed queries</span>
                  </div>
                  <ul className="divide-y divide-red-100">
                    {result.dropped.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 px-3 py-2 text-xs bg-red-50">
                        <span className="mt-0.5 font-bold text-red-500 flex-shrink-0">−</span>
                        <span className="text-red-800 line-through opacity-70">{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {result && !loading && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-ui-border flex-shrink-0">
            <p className="text-[11px] text-ui-accent">
              New queries will run on next agent run. Unchanged queries won't re-run.
            </p>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text transition-colors">
                Dismiss
              </button>
              <button onClick={handleApply} disabled={applying}
                className="px-4 py-1.5 rounded-lg bg-ui-text text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-1.5">
                {applying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {applying ? "Applying…" : "Apply changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

type Filter = { field: string; value: string };
type View = "leads" | "log" | "context";

function Dashboard({
  project,
  config,
  onConfigUpdated,
  onSwitchProject,
}: {
  project: Project;
  config: AgentConfig;
  onConfigUpdated: (cfg: AgentConfig) => void;
  onSwitchProject: () => void;
}) {
  const pid = project.id;

  const [leads, setLeads]     = useState<Lead[]>([]);
  const [stats, setStats]     = useState<Stats>({ total: 0, new: 0, hot: 0, contacted: 0, reviewed: 0 });
  const [log, setLog]         = useState("");
  const [view, setView]       = useState<View>("leads");
  const [filter, setFilter]   = useState<Filter>({ field: "", value: "" });
  const [selected, setSelected] = useState<Lead | null>(null);
  const [jobStatus, setJobStatus] = useState<{ job: string; state: string; detail: string; ts: string } | null>(null);
  const [toast, setToast]         = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);
  const [search, setSearch]   = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [searchHistoryCount, setSearchHistoryCount] = useState(0);
  const [addingManual, setAddingManual] = useState(false);
  const [refining, setRefining]         = useState(false);

  const running  = jobStatus?.job === "run"     && jobStatus?.state === "running";
  const cleaning = jobStatus?.job === "cleanup" && jobStatus?.state === "running";
  const anyRunning = running || cleaning;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const fetchStats = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/stats`);
    if (r.ok) setStats(await r.json());
  }, [pid]);

  const fetchLeads = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/leads`);
    if (r.ok) setLeads(await r.json());
  }, [pid]);

  const fetchLog = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/log`);
    if (r.ok) { const d = await r.json(); setLog(d.log); }
  }, [pid]);

  const fetchContext = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/context`);
    if (r.ok) setAgentContext(await r.json());
  }, [pid]);

  const fetchStatus = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/status`);
    if (r.ok) setJobStatus(await r.json());
  }, [pid]);

  const fetchSearchHistory = useCallback(async () => {
    const r = await fetch(`${API}/pollen/${pid}/search-history`);
    if (r.ok) { const d = await r.json(); setSearchHistoryCount(d.total ?? 0); }
  }, [pid]);

  const clearSearchHistory = async () => {
    await fetch(`${API}/pollen/${pid}/search-history`, { method: "DELETE" });
    setSearchHistoryCount(0);
    showToast("Search history cleared — all queries will run fresh on next agent run");
  };

  // Poll status every 3s.
  // While a job is running: refresh leads+stats every 10s so new leads appear live.
  // On running→done transition: do a final refresh.
  const prevStateRef  = useRef<string>("");
  const liveRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStatus(); fetchStats(); fetchLeads(); fetchSearchHistory();

    const statusIv = setInterval(async () => {
      const r = await fetch(`${API}/pollen/${pid}/status`);
      if (!r.ok) return;
      const s = await r.json();
      setJobStatus(s);

      const wasRunning = prevStateRef.current === "running";
      const isRunning  = s.state === "running";

      // Start live refresh interval when a job starts
      if (isRunning && !liveRefreshRef.current) {
        liveRefreshRef.current = setInterval(() => {
          fetchStats(); fetchLeads();
        }, 8000);
      }

      // Stop live refresh and do a final pull when job finishes
      if (wasRunning && !isRunning) {
        if (liveRefreshRef.current) {
          clearInterval(liveRefreshRef.current);
          liveRefreshRef.current = null;
        }
        fetchStats(); fetchLeads(); fetchSearchHistory();
      }

      prevStateRef.current = s.state;
    }, 3000);

    // Slow background refresh when idle
    const idleIv = setInterval(() => {
      if (!liveRefreshRef.current) { fetchStats(); fetchLeads(); }
    }, 30_000);

    return () => {
      clearInterval(statusIv);
      clearInterval(idleIv);
      if (liveRefreshRef.current) clearInterval(liveRefreshRef.current);
    };
  }, [pid, fetchStatus, fetchStats, fetchLeads]);

  const logEndRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (view !== "log") return;
    fetchLog();
    const iv = setInterval(fetchLog, 3000);
    return () => clearInterval(iv);
  }, [view, fetchLog]);

  useEffect(() => {
    if (view === "log" && logEndRef.current) {
      const el = logEndRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (isNearBottom) el.scrollTop = el.scrollHeight;
    }
  }, [log, view]);

  useEffect(() => { if (view === "context") fetchContext(); }, [view, fetchContext]);

  const handleSave = useCallback(async (id: string, patch: Partial<Lead>) => {
    const r = await fetch(`${API}/pollen/${pid}/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const updated: Lead = await r.json();
      setLeads(prev => prev.map(l => l.id === id ? updated : l));
      if (selected?.id === id) setSelected(updated);
      fetchStats();
      if (patch.starred === true) {
        showToast("Starred — use \"Refine queries\" to update searches based on this lead");
      } else {
        showToast("Saved");
      }
    }
  }, [pid, selected, fetchStats]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`${API}/pollen/${pid}/leads/${id}`, { method: "DELETE" });
    setLeads(prev => prev.filter(l => l.id !== id));
    if (selected?.id === id) setSelected(null);
    fetchStats();
  }, [pid, selected, fetchStats]);

  const triggerRun = async () => {
    const r = await fetch(`${API}/pollen/${pid}/run`, { method: "POST" });
    if (r.ok) {
      showToast("Agent started — new leads will appear as they're found");
      fetchStatus(); // immediately reflect running state
    } else {
      const e = await r.json().catch(() => ({}));
      showToast(e.detail ?? "Failed to start agent");
    }
  };

  const triggerStop = async () => {
    await fetch(`${API}/pollen/${pid}/stop`, { method: "POST" });
    showToast("Agent stopped");
    fetchStatus();
  };

  const triggerCleanup = async () => {
    showToast("Cleanup started…");
    fetchStatus();
    const r = await fetch(`${API}/pollen/${pid}/cleanup`, { method: "POST" });
    if (r.ok) {
      const s = await r.json();
      const msg = s.total_removed > 0
        ? `Cleanup done — removed ${s.total_removed} duplicate${s.total_removed !== 1 ? "s" : ""} (${s.remaining} remain)`
        : `No duplicates found — ${s.remaining} leads are clean`;
      showToast(msg);
      fetchStats(); fetchLeads(); fetchStatus();
    } else {
      const e = await r.json().catch(() => ({}));
      showToast(e.detail ?? "Cleanup failed — check the log");
      fetchStatus();
    }
  };

  const asLower = (value: unknown) => String(value ?? "").toLowerCase();

  const displayed = leads.filter(l => {
    // Sidebar quick-filter
    if (filter.field) {
      const raw = l[filter.field as keyof Lead];
      if (filter.value === "true" && raw !== true) return false;
      if (filter.value === "false" && (raw === true)) return false;
      if (filter.value !== "true" && filter.value !== "false" && (raw as string) !== filter.value) return false;
    }
    // Text search
    if (search.trim()) {
      const q = asLower(search);
      const name = asLower(leadDisplayName(l));
      const reason = asLower(l.fit_reason);
      const country = asLower(l.country);
      const signal = asLower(l.signal_type);
      const category = asLower(l.category);
      if (!name.includes(q) && !reason.includes(q) && !country.includes(q) && !signal.includes(q) && !category.includes(q)) return false;
    }
    // Column-level filters
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val) continue;
      // brand_name column should match the display name (brand_name or company_name)
      const raw = col === "brand_name"
        ? leadDisplayName(l)
        : l[col as keyof Lead];
      if (!asLower(raw).includes(asLower(val))) return false;
    }
    return true;
  });

  const downloadCsv = useCallback(() => {
    const cols = ["brand_name", "category", "country", "fit_score", "priority", "signal_type", "status", "fit_reason", "source_url", "found_at", "notes"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [cols.join(","), ...displayed.map(l =>
      cols.map(c => escape(c === "brand_name" ? leadDisplayName(l) : l[c as keyof Lead])).join(",")
    )];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${project.name}-leads.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [displayed]);

  const navItem = (label: string, v: View, ff = "", fv = "") => (
    <button
      onClick={() => { setView(v); setFilter(ff ? { field: ff, value: fv } : { field: "", value: "" }); }}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
        view === v && (ff ? filter.field === ff && filter.value === fv : filter.field === "")
          ? "bg-ui-bg text-ui-text font-medium"
          : "text-ui-accent hover:text-ui-text hover:bg-ui-bg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full flex overflow-hidden bg-ui-bg text-ui-text text-sm relative">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-ui-card border-r border-ui-border p-4 flex flex-col gap-1">
        <p className="text-[11px] font-semibold text-ui-text px-3 py-1 truncate">{project.name}</p>
        <p className="text-[10px] text-ui-accent px-3 mb-1 truncate">{config.sender_company}</p>
        <button
          onClick={onSwitchProject}
          className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-ui-accent hover:text-ui-text transition-colors rounded mb-1"
        >
          <ArrowLeft className="w-3 h-3" /> Switch project
        </button>
        <div className="border-t border-ui-border mb-2" />
        <p className="text-[10px] uppercase tracking-wider text-ui-accent px-3 py-1">Pipeline</p>
        {navItem("All Leads", "leads")}
        {navItem("Hot Leads", "leads", "priority", "hot")}
        {navItem("Starred", "leads", "starred", "true")}
        {navItem("New", "leads", "status", "new")}
        {navItem("Contacted", "leads", "status", "contacted")}
        <p className="text-[10px] uppercase tracking-wider text-ui-accent px-3 py-1 mt-3">System</p>
        {navItem("Agent Context", "context")}
        {navItem("Agent Log", "log")}
        <div className="flex-1" />

        {/* Batch size picker */}
        <div className="px-1 mb-2">
          <p className="text-[10px] uppercase tracking-wider text-ui-accent px-2 mb-1.5">Leads per run</p>
          <div className="grid grid-cols-2 gap-1">
            {[50, 100, 200, 0].map(n => {
              const active = (agentContext?.batch_size ?? 0) === n;
              return (
                <button
                  key={n}
                  onClick={async () => {
                    await fetch(`${API}/pollen/${pid}/config`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ batch_size: n }),
                    });
                    fetchContext();
                  }}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    active
                      ? "bg-ui-text text-white border-ui-text"
                      : "border-ui-border text-ui-accent hover:text-ui-text hover:border-gray-400"
                  }`}
                >
                  {n === 0 ? "∞ All" : n}
                </button>
              );
            })}
          </div>
        </div>

        {/* Persistent job status banner */}
        {anyRunning && (
          <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-950 text-[11px] font-medium flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="truncate flex-1">{jobStatus?.detail || (running ? "Searching for leads…" : "Cleaning up duplicates…")}</span>
          </div>
        )}
        {!anyRunning && jobStatus?.state === "error" && (
          <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-400 text-[11px] truncate" title={jobStatus.detail}>
            ⚠ Last job failed
          </div>
        )}
        {!anyRunning && jobStatus?.state === "exhausted" && (
          <div className="px-3 py-2 rounded-lg bg-amber-950 border border-amber-700 text-amber-300 text-[11px] flex items-center gap-2">
            <span className="flex-shrink-0">⚡</span>
            <span className="truncate flex-1">{jobStatus.detail || "All search queries exhausted — update queries or add new ones to find fresh leads."}</span>
          </div>
        )}

        {running ? (
          <button onClick={triggerStop}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors">
            <Square className="w-3.5 h-3.5" />
            Stop agent
          </button>
        ) : (
          <button onClick={triggerRun} disabled={anyRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ui-text text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
            <Play className="w-3.5 h-3.5" />
            Run agent
          </button>
        )}
        <button onClick={() => setAddingManual(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          Add company
        </button>
        <button onClick={() => setRefining(true)} disabled={anyRunning || (stats.starred ?? 0) === 0}
          title={(stats.starred ?? 0) === 0 ? "Star some leads first to enable query refinement" : "Refine search queries based on starred and manually-added leads"}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 disabled:opacity-40 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
          Refine queries
        </button>
        <button onClick={triggerCleanup} disabled={anyRunning || stats.total === 0}
          title="AI removes duplicate and archived leads"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 disabled:opacity-40 transition-colors">
          {cleaning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {cleaning ? "Cleaning…" : "Clean up duplicates"}
        </button>
        {searchHistoryCount > 0 && (
          <button onClick={clearSearchHistory} disabled={anyRunning}
            title={`${searchHistoryCount} queries cached — clear to re-search all queries on next run`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-yellow-800 text-yellow-400 text-xs font-medium hover:text-yellow-300 hover:border-yellow-600 disabled:opacity-40 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
            Re-search all ({searchHistoryCount})
          </button>
        )}
        <button onClick={() => setCorrecting(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 transition-colors">
          Leads not accurate?
        </button>
        <button onClick={() => { fetchContext(); setEditing(true); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 transition-colors">
          Edit configuration
        </button>
        <button onClick={downloadCsv} disabled={displayed.length === 0}
          title="Download visible leads as CSV"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 disabled:opacity-40 transition-colors">
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-6 gap-3 mb-6">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="New" value={stats.new} accent="text-blue-400" />
          <StatCard label="Hot" value={stats.hot} accent="text-orange-400" />
          <StatCard label="Starred" value={stats.starred ?? 0} accent="text-yellow-400" />
          <StatCard label="Reviewed" value={stats.reviewed} />
          <StatCard label="Contacted" value={stats.contacted} />
        </div>

        {view === "leads" && (
          <>
            {/* Search + quick-filter pills */}
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search leads by name, country, signal, category…"
                  className="flex-1 bg-ui-card border border-ui-border rounded-lg px-3 py-2 text-sm text-ui-text placeholder:text-ui-accent focus:outline-none focus:border-gray-400"
                />
                {(search || Object.values(colFilters).some(Boolean)) && (
                  <button
                    onClick={() => { setSearch(""); setColFilters({}); }}
                    className="px-3 py-2 rounded-lg border border-ui-border text-xs text-ui-accent hover:text-ui-text transition-colors whitespace-nowrap"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { label: "All", field: "", value: "", idle: "border-ui-border bg-white text-ui-text shadow-sm", active: "bg-ui-text text-white border-ui-text shadow-sm" },
                  { label: "🔥 Hot", field: "priority", value: "hot", idle: "border-orange-200 bg-orange-50 text-orange-950", active: "bg-orange-600 text-white border-orange-600" },
                  { label: "Warm", field: "priority", value: "warm", idle: "border-amber-200 bg-amber-50 text-amber-950", active: "bg-amber-500 text-white border-amber-500" },
                  { label: "⭐ Starred", field: "starred", value: "true", idle: "border-yellow-300 bg-yellow-50 text-yellow-950", active: "bg-yellow-500 text-white border-yellow-500" },
                  { label: "New", field: "status", value: "new", idle: "border-blue-200 bg-blue-50 text-blue-950", active: "bg-blue-700 text-white border-blue-700" },
                  { label: "Reviewed", field: "status", value: "reviewed", idle: "border-amber-200 bg-amber-50 text-amber-950", active: "bg-amber-600 text-white border-amber-600" },
                  { label: "Contacted", field: "status", value: "contacted", idle: "border-emerald-200 bg-emerald-50 text-emerald-950", active: "bg-emerald-700 text-white border-emerald-700" },
                ] as const).map(({ label, field, value, idle, active }) => (
                  <button key={label} onClick={() => setFilter({ field, value })}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      filter.field === field && filter.value === value ? active : idle
                    } hover:opacity-95`}>
                    {label}
                  </button>
                ))}
                {/* Active col-filter chips */}
                {Object.entries(colFilters).filter(([,v]) => v).map(([col, val]) => (
                  <button key={col} onClick={() => setColFilters(prev => ({ ...prev, [col]: "" }))}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border border-blue-200 bg-blue-50 text-blue-950">
                    {col}: {val} <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
              {displayed.length !== leads.length && (
                <p className="text-[11px] text-ui-accent">Showing {displayed.length} of {leads.length} leads</p>
              )}
            </div>
            {displayed.length === 0 ? (
              <div className="text-center py-20 text-ui-accent">
                <p className="text-lg font-medium text-ui-text mb-1">No leads yet</p>
                <p>Click "Run agent" to start finding leads.</p>
              </div>
            ) : (
              <div className="bg-ui-card border border-ui-border rounded-xl overflow-x-auto">
                <table className="w-full text-left text-[13px]" style={{ minWidth: 900 }}>
                  <thead>
                    <tr className="border-b border-ui-border bg-ui-bg">
                      {["", "Brand", "Country", "Found", "Priority", "Category", "Signal", "Channel", "Status", "Actions"].map(h => (
                        <th key={h} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-ui-accent font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                    {/* Column filter inputs */}
                    <tr className="border-b border-ui-border bg-ui-bg">
                      <td />
                      {(["brand_name", "country", "", "priority", "category", "signal_type", "channel", "status"] as string[]).map((col, i) => (
                        <td key={i} className="px-2 py-1">
                          {col ? (
                            <input
                              value={colFilters[col] ?? ""}
                              onChange={e => setColFilters(prev => ({ ...prev, [col]: e.target.value }))}
                              placeholder="filter…"
                              className="w-full bg-ui-bg border border-ui-border rounded px-2 py-0.5 text-[11px] text-ui-text placeholder:text-ui-accent focus:outline-none focus:border-gray-400"
                            />
                          ) : <span />}
                        </td>
                      ))}
                      <td />
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map(lead => (
                      <tr key={lead.id} onClick={() => setSelected(lead)}
                        className="border-b border-ui-border last:border-b-0 cursor-pointer hover:bg-ui-bg transition-colors">
                        <td className="px-3 py-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border ${PRIORITY_BADGE[lead.priority] ?? ""}`}>
                            {lead.fit_score}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-ui-text max-w-[200px]">
                          <span className="flex items-center gap-1 truncate" title={leadDisplayName(lead)}>
                            {lead.starred && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                            {leadDisplayName(lead)}
                          </span>
                          <span className="block text-[11px] text-ui-accent font-normal truncate mt-0.5" title={lead.fit_reason}>{lead.fit_reason || ""}</span>
                        </td>
                        <td className="px-3 py-2.5 text-ui-accent whitespace-nowrap text-xs">{lead.country || "—"}</td>
                        <td className="px-3 py-2.5 text-ui-accent whitespace-nowrap text-xs">{fmtDate(lead.found_at)}</td>
                        <td className="px-3 py-2.5"><Badge className={`${PRIORITY_BADGE[lead.priority]} capitalize`}>{lead.priority}</Badge></td>
                        <td className="px-3 py-2.5 align-top"><CategoryBadges category={lead.category || ""} /></td>
                        <td className="px-3 py-2.5"><Badge className={SIGNAL_BADGE}>{formatSignalLabel(lead.signal_type || "")}</Badge></td>
                        <td className="px-3 py-2.5">
                          {lead.channel
                            ? <Badge className={CHANNEL_BADGE[lead.channel] ?? "text-slate-800 bg-slate-100 border-slate-200"}>{CHANNEL_LABEL[lead.channel] ?? lead.channel_label ?? lead.channel}</Badge>
                            : <span className="text-ui-accent text-xs">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5"><Badge className={`${STATUS_BADGE[lead.status] ?? "text-slate-700 bg-slate-100 border-slate-200"} capitalize`}>{lead.status}</Badge></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={e => { e.stopPropagation(); setSelected(lead); }}
                              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-medium hover:opacity-90 transition-opacity">
                              View
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleSave(lead.id, { status: "contacted" }); }}
                              className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700 transition-colors">
                              Contacted
                            </button>
                            {lead.source_url && (
                              <button onClick={e => { e.stopPropagation(); window.open(lead.source_url, "_blank"); }}
                                className="p-1 rounded-md bg-ui-bg text-ui-accent hover:text-ui-text transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); handleDelete(lead.id); }}
                              title="Remove lead"
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
            )}
          </>
        )}

        {view === "log" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-ui-text">Agent log</h2>
              <button onClick={fetchLog}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ui-border rounded-lg text-ui-accent hover:text-ui-text transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            <pre ref={logEndRef} className="bg-ui-card border border-ui-border rounded-xl p-4 text-xs font-mono leading-relaxed text-ui-accent whitespace-pre-wrap max-h-[600px] overflow-y-auto">
              {log || "No log yet."}
            </pre>
          </div>
        )}

        {view === "context" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div />
              <button onClick={fetchContext}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ui-border rounded-lg text-ui-accent hover:text-ui-text transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {agentContext ? (
              <ContextInspector context={agentContext} />
            ) : (
              <div className="text-center py-20 text-ui-accent">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                <p>Loading agent context...</p>
              </div>
            )}
          </div>
        )}
      </main>

      {selected && <DetailPanel lead={selected} onClose={() => setSelected(null)} onSave={handleSave} onDelete={handleDelete} />}

      {addingManual && (
        <AddCompanyModal
          projectId={pid}
          onClose={() => { setAddingManual(false); fetchLeads(); fetchStats(); }}
          onAdded={(lead) => {
            setLeads(prev => {
              const exists = prev.find(l => l.id === lead.id);
              return exists ? prev.map(l => l.id === lead.id ? lead : l) : [lead, ...prev];
            });
            fetchStats();
            showToast(`Added: ${lead.brand_name ?? lead.company_name ?? "Company"} — star good leads and use "Refine queries" to update your search`);
          }}
        />
      )}

      {refining && (
        <RefineQueriesPanel
          projectId={pid}
          onClose={() => setRefining(false)}
          onApplied={() => {
            fetchContext();
            showToast("Queries updated — run the agent to search with the new queries");
          }}
        />
      )}

      {correcting && (
        <CorrectLeadsChat
          projectId={pid}
          onDone={(cfg) => { onConfigUpdated(cfg); setCorrecting(false); showToast("Strategy updated — run the agent to find new leads"); }}
          onClose={() => setCorrecting(false)}
        />
      )}

      {editing && agentContext && (
        <EditConfigPanel
          projectId={pid}
          context={agentContext}
          onDone={(cfg) => { onConfigUpdated(cfg); fetchContext(); showToast("Configuration saved"); }}
          onClose={() => setEditing(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs font-semibold px-4 py-2 rounded-full z-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

type Phase = "checking" | "projects" | "onboarding" | "dashboard";

export default function PollenBDTool() {
  const [phase, setPhase]           = useState<Phase>("checking");
  const [projects, setProjects]     = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [activeProject, setActiveProject]     = useState<Project | null>(null);
  const [config, setConfig]         = useState<AgentConfig | null>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const r = await fetch(`${API}/pollen/projects`);
      if (r.ok) {
        const list: Project[] = await r.json();
        setProjects(list);
      }
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    loadProjects().then(() => setPhase("projects"));
  }, [loadProjects]);

  const handleSelectProject = async (project: Project) => {
    setActiveProject(project);
    if (!project.configured) {
      setPhase("onboarding");
      return;
    }
    try {
      const r = await fetch(`${API}/pollen/${project.id}/config`);
      if (r.ok) {
        const cfg: AgentConfig = await r.json();
        setConfig(cfg);
        setPhase("dashboard");
      } else {
        setPhase("onboarding");
      }
    } catch {
      setPhase("onboarding");
    }
  };

  const handleOnboardingDone = (cfg: AgentConfig) => {
    setConfig(cfg);
    setPhase("dashboard");
    if (activeProject) {
      setActiveProject({ ...activeProject, configured: true });
    }
  };

  const handleDeleteProject = async (pid: string) => {
    try {
      const r = await fetch(`${API}/pollen/projects/${pid}`, { method: "DELETE" });
      if (r.ok) {
        setProjects(prev => prev.filter(p => p.id !== pid));
      }
    } catch { /* ignore */ }
  };

  const handleRenameProject = async (pid: string, name: string) => {
    try {
      const r = await fetch(`${API}/pollen/projects/${pid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const updated: Project = await r.json();
        setProjects(prev => prev.map(p => p.id === pid ? updated : p));
      }
    } catch { /* ignore */ }
  };

  const handleSwitchProject = () => {
    setActiveProject(null);
    setConfig(null);
    loadProjects();
    setPhase("projects");
  };

  if (phase === "checking") {
    return (
      <div className="h-full flex items-center justify-center text-ui-accent text-sm gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (phase === "projects") {
    return (
      <ProjectSelector
        projects={projects}
        loading={loadingProjects}
        onSelect={handleSelectProject}
        onRefresh={loadProjects}
        onDelete={handleDeleteProject}
        onRename={handleRenameProject}
      />
    );
  }

  if (phase === "onboarding" && activeProject) {
    return (
      <OnboardingChat
        projectId={activeProject.id}
        onDone={handleOnboardingDone}
      />
    );
  }

  if (phase === "dashboard" && activeProject && config) {
    return (
      <Dashboard
        project={activeProject}
        config={config}
        onConfigUpdated={cfg => setConfig(cfg)}
        onSwitchProject={handleSwitchProject}
      />
    );
  }

  return (
    <div className="h-full flex items-center justify-center text-ui-accent text-sm gap-2">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );
}
