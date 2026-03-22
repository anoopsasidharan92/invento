import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw, Play, X, ExternalLink, Copy, Check, Send,
  Star, Trash2, Plus, FolderOpen, ArrowLeft, Square, Download,
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
  search_queries: { signal: string; queries: string[] }[];
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

const PRIORITY_BADGE: Record<string, string> = {
  hot:  "text-orange-400 bg-orange-950 border-orange-800",
  warm: "text-yellow-400 bg-yellow-950 border-yellow-800",
  cold: "text-gray-400 bg-gray-900 border-gray-700",
};
const PRIORITY_BORDER: Record<string, string> = {
  hot:  "border-l-orange-500",
  warm: "border-l-yellow-400",
  cold: "border-l-gray-600",
};
const CHANNEL_BADGE: Record<string, string> = {
  linkedin:  "text-blue-300 bg-blue-950 border-blue-700",
  reddit:    "text-orange-300 bg-orange-950 border-orange-700",
  instagram: "text-pink-300 bg-pink-950 border-pink-700",
  facebook:  "text-indigo-300 bg-indigo-950 border-indigo-700",
  news:      "text-purple-300 bg-purple-950 border-purple-700",
  google:    "text-green-300 bg-green-950 border-green-700",
};
const CHANNEL_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", reddit: "Reddit", instagram: "Instagram",
  facebook: "Facebook", news: "News", google: "Google",
};

// ── Project Selector ───────────────────────────────────────────────────────────

function ProjectSelector({
  projects,
  loading,
  onSelect,
  onRefresh,
  onDelete,
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
                <button
                  onClick={() => onSelect(p)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-2 mb-3 pr-7">
                    <span className="font-semibold text-ui-text group-hover:text-white transition-colors truncate">
                      {p.name}
                    </span>
                    <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                      p.configured
                        ? "text-green-400 bg-green-950 border-green-800"
                        : "text-yellow-400 bg-yellow-950 border-yellow-800"
                    }`}>
                      {p.configured ? "Ready" : "Setup needed"}
                    </span>
                  </div>
                  <p className="text-xs text-ui-accent">
                    Created {fmtDate(p.created_at)}
                  </p>
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

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${className}`}>
      {children}
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
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${starred ? "text-yellow-400 bg-yellow-950 border border-yellow-800" : "bg-ui-bg text-ui-accent hover:text-yellow-400"}`}
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
          <Badge className="text-ui-accent bg-ui-bg border-ui-border">{lead.category || "—"}</Badge>
          <Badge className="text-blue-400 bg-blue-950 border-blue-800">{(lead.signal_type || "").replace(/_/g, " ")}</Badge>
          <Badge className="text-ui-accent bg-ui-bg border-ui-border">{lead.country || "—"}</Badge>
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
  });

  const [queryGroups, setQueryGroups] = useState<QueryGroupDraft[]>(() =>
    (context.search_queries ?? []).length
      ? context.search_queries.map(g => ({ signal: g.signal, queries: g.queries.join("\n") }))
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
      result_schema:         context.result_schema,
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
  linkedin:  { label: "LinkedIn",  color: "bg-blue-950 border-blue-700 text-blue-300",   dot: "bg-blue-500" },
  reddit:    { label: "Reddit",    color: "bg-orange-950 border-orange-700 text-orange-300", dot: "bg-orange-500" },
  instagram: { label: "Instagram", color: "bg-pink-950 border-pink-700 text-pink-300",   dot: "bg-pink-500" },
  facebook:  { label: "Facebook",  color: "bg-indigo-950 border-indigo-700 text-indigo-300", dot: "bg-indigo-500" },
  news:      { label: "News",      color: "bg-purple-950 border-purple-700 text-purple-300", dot: "bg-purple-500" },
  google:    { label: "Google",    color: "bg-green-950 border-green-700 text-green-300",  dot: "bg-green-500" },
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

function QueryGroup({ group }: { group: { signal: string; queries: string[] } }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-ui-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-ui-bg hover:bg-ui-card transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
            {group.signal.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] bg-blue-950 border border-blue-800 text-blue-400 px-1.5 py-0.5 rounded-full">
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
              { label: "Hot",  score: hot,  cls: "text-orange-400 bg-orange-950 border-orange-800" },
              { label: "Warm", score: warm, cls: "text-yellow-400 bg-yellow-950 border-yellow-800" },
              { label: "Save", score: save, cls: "text-gray-400 bg-gray-900 border-gray-700" },
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
                <span key={i} className="text-[10px] bg-blue-950 border border-blue-800 rounded px-1.5 py-0.5 text-blue-300">{s.replace(/_/g, " ")}</span>
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
          <p className="text-[11px] uppercase tracking-wider text-yellow-400 font-semibold mb-2">
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
                    <Badge className="text-blue-400 bg-blue-950 border-blue-800">{(l.signal_type || "").replace(/_/g, " ")}</Badge>
                    <Badge className="text-ui-accent bg-ui-bg border-ui-border">{l.country}</Badge>
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

  // Poll status every 3s.
  // While a job is running: refresh leads+stats every 10s so new leads appear live.
  // On running→done transition: do a final refresh.
  const prevStateRef  = useRef<string>("");
  const liveRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStatus(); fetchStats(); fetchLeads();

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
        fetchStats(); fetchLeads();
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

  useEffect(() => { if (view === "log") fetchLog(); }, [view, fetchLog]);
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
      showToast("Saved");
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
      const q = search.toLowerCase();
      const name = leadDisplayName(l).toLowerCase();
      const reason = (l.fit_reason || "").toLowerCase();
      const country = (l.country || "").toLowerCase();
      const signal = (l.signal_type || "").toLowerCase();
      const category = (l.category || "").toLowerCase();
      if (!name.includes(q) && !reason.includes(q) && !country.includes(q) && !signal.includes(q) && !category.includes(q)) return false;
    }
    // Column-level filters
    for (const [col, val] of Object.entries(colFilters)) {
      if (!val) continue;
      // brand_name column should match the display name (brand_name or company_name)
      const raw = col === "brand_name"
        ? leadDisplayName(l)
        : (l[col as keyof Lead] ?? "") as string;
      if (!raw.toLowerCase().includes(val.toLowerCase())) return false;
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
          <div className="px-3 py-2 rounded-lg bg-blue-950 border border-blue-800 text-blue-300 text-[11px] flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="truncate flex-1">{jobStatus?.detail || (running ? "Searching for leads…" : "Cleaning up duplicates…")}</span>
          </div>
        )}
        {!anyRunning && jobStatus?.state === "error" && (
          <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-400 text-[11px] truncate" title={jobStatus.detail}>
            ⚠ Last job failed
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
        <button onClick={triggerCleanup} disabled={anyRunning || stats.total === 0}
          title="AI removes duplicate and archived leads"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ui-border text-ui-accent text-xs font-medium hover:text-ui-text hover:border-gray-400 disabled:opacity-40 transition-colors">
          {cleaning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {cleaning ? "Cleaning…" : "Clean up duplicates"}
        </button>
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
                {[
                  { label: "All", field: "", value: "" },
                  { label: "🔥 Hot", field: "priority", value: "hot" },
                  { label: "Warm", field: "priority", value: "warm" },
                  { label: "⭐ Starred", field: "starred", value: "true" },
                  { label: "New", field: "status", value: "new" },
                  { label: "Reviewed", field: "status", value: "reviewed" },
                  { label: "Contacted", field: "status", value: "contacted" },
                ].map(({ label, field, value }) => (
                  <button key={label} onClick={() => setFilter({ field, value })}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      filter.field === field && filter.value === value
                        ? "bg-ui-text text-white border-ui-text"
                        : "border-ui-border text-ui-accent hover:text-ui-text hover:border-gray-400"
                    }`}>
                    {label}
                  </button>
                ))}
                {/* Active col-filter chips */}
                {Object.entries(colFilters).filter(([,v]) => v).map(([col, val]) => (
                  <button key={col} onClick={() => setColFilters(prev => ({ ...prev, [col]: "" }))}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs border border-blue-700 bg-blue-950 text-blue-300">
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
                        <td className="px-3 py-2.5"><Badge className={PRIORITY_BADGE[lead.priority]}>{lead.priority}</Badge></td>
                        <td className="px-3 py-2.5"><Badge className="text-ui-accent bg-ui-bg border-ui-border">{lead.category || "—"}</Badge></td>
                        <td className="px-3 py-2.5"><Badge className="text-blue-400 bg-blue-950 border-blue-800">{(lead.signal_type || "").replace(/_/g, " ")}</Badge></td>
                        <td className="px-3 py-2.5">
                          {lead.channel
                            ? <Badge className={CHANNEL_BADGE[lead.channel] ?? "text-ui-accent bg-ui-bg border-ui-border"}>{CHANNEL_LABEL[lead.channel] ?? lead.channel_label ?? lead.channel}</Badge>
                            : <span className="text-ui-accent text-xs">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5"><Badge className="text-ui-accent bg-ui-bg border-ui-border">{lead.status}</Badge></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={e => { e.stopPropagation(); setSelected(lead); }}
                              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-medium hover:opacity-90 transition-opacity">
                              View
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleSave(lead.id, { status: "contacted" }); }}
                              className="px-2 py-1 rounded-md bg-green-900 text-green-400 text-[10px] font-medium hover:opacity-90 transition-opacity">
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
            <pre className="bg-ui-card border border-ui-border rounded-xl p-4 text-xs font-mono leading-relaxed text-ui-accent whitespace-pre-wrap max-h-[600px] overflow-y-auto">
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
