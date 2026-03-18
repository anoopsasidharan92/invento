import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw, Play, X, ExternalLink, Copy, Check, Send,
  Star, Trash2, Eye, Plus, FolderOpen, ArrowLeft, Square, Download,
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
}: {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
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
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="bg-ui-card border border-ui-border hover:border-gray-400 rounded-xl p-5 text-left transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
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
                placeholder="e.g. Pollen FMCG — India"
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

// ── Onboarding Chat ────────────────────────────────────────────────────────────

function OnboardingChat({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (cfg: AgentConfig) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef   = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_API}/pollen/ws/onboard?project_id=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "config_ready") {
        onDone(msg.content as AgentConfig);
      } else if (msg.type === "agent") {
        setMessages(prev => [...prev, { role: "agent", text: msg.content }]);
        setSending(false);
      }
    };

    ws.onclose = () => setConnected(false);
    return () => ws.close();
  }, [projectId, onDone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages(prev => [...prev, { role: "user", text }]);
    wsRef.current.send(JSON.stringify({ content: text }));
    setInput("");
    setSending(true);
  };

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-ui-text">Set up your BD Agent</h1>
        <p className="text-sm text-ui-accent mt-1">
          Answer a few questions and your agent will be configured for your business. This only happens once per project.
        </p>
      </div>

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
        {sending && (
          <div className="flex justify-start">
            <div className="bg-ui-card border border-ui-border rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-ui-accent flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Type your answer…"
          disabled={!connected || sending}
          className="flex-1 bg-ui-card border border-ui-border rounded-xl px-4 py-2.5 text-sm text-ui-text placeholder:text-ui-accent disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!connected || sending || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-ui-text text-white disabled:opacity-40 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
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

// ── Context Inspector ──────────────────────────────────────────────────────────

function ContextSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-ui-card border border-ui-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-ui-bg border-b border-ui-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ui-accent">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ContextInspector({ context }: { context: AgentContext }) {
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Eye className="w-4 h-4 text-purple-400" />
        <h2 className="font-semibold text-ui-text">Agent Context Inspector</h2>
        <span className="text-xs text-ui-accent ml-2">Everything the AI sees when evaluating leads</span>
      </div>

      <ContextSection title="Agent Identity & Sender">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-ui-accent text-xs">Agent Name</span>
            <p className="text-ui-text font-medium">{context.config.agent_name || "—"}</p>
          </div>
          <div>
            <span className="text-ui-accent text-xs">Sender</span>
            <p className="text-ui-text font-medium">{context.config.sender_name || "—"}</p>
          </div>
          <div>
            <span className="text-ui-accent text-xs">Company</span>
            <p className="text-ui-text font-medium">{context.config.sender_company || "—"}</p>
          </div>
          <div>
            <span className="text-ui-accent text-xs">Description</span>
            <p className="text-ui-text font-medium">{context.config.sender_description || "—"}</p>
          </div>
        </div>
        {context.config.qualifier_context && context.config.qualifier_context !== "..." && (
          <div className="mt-3 pt-3 border-t border-ui-border">
            <span className="text-ui-accent text-xs">Qualifier Context</span>
            <p className="text-sm text-ui-text mt-1 leading-relaxed">{context.config.qualifier_context}</p>
          </div>
        )}
        {context.config.ideal_customer_profile && (
          <div className="mt-3 pt-3 border-t border-ui-border">
            <span className="text-ui-accent text-xs">Ideal Customer Profile</span>
            <p className="text-sm text-ui-text mt-1 leading-relaxed">{context.config.ideal_customer_profile}</p>
          </div>
        )}
        {context.config.what_we_offer && (
          <div className="mt-3 pt-3 border-t border-ui-border">
            <span className="text-ui-accent text-xs">What We Offer (used in outreach emails)</span>
            <p className="text-sm text-ui-text mt-1 leading-relaxed">{context.config.what_we_offer}</p>
          </div>
        )}
      </ContextSection>

      <div className="grid grid-cols-2 gap-4">
        <ContextSection title="Strong Signals (Good Leads)">
          <ul className="space-y-1.5">
            {context.strong_signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-green-400 mt-0.5 flex-shrink-0">+</span>
                <span className="text-ui-text">{s}</span>
              </li>
            ))}
          </ul>
        </ContextSection>

        <ContextSection title="Weak / Irrelevant Signals (Ignore)">
          <ul className="space-y-1.5">
            {context.weak_signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-red-400 mt-0.5 flex-shrink-0">-</span>
                <span className="text-ui-text">{s}</span>
              </li>
            ))}
          </ul>
        </ContextSection>
      </div>

      <ContextSection title={`Search Queries (${context.search_queries.reduce((n, g) => n + g.queries.length, 0)} total, ${context.max_results_per_query} results each, geo: ${context.search_geo})`}>
        <div className="space-y-3">
          {context.search_queries.map((group, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge className="text-blue-400 bg-blue-950 border-blue-800">{group.signal}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.queries.map((q, j) => (
                  <span key={j} className="inline-block text-xs bg-ui-bg border border-ui-border rounded-lg px-2.5 py-1 text-ui-text font-mono">
                    {q}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ContextSection>

      <div className="grid grid-cols-2 gap-4">
        <ContextSection title="Result Schema">
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-ui-accent text-xs">Lead Name Field</span>
              <p className="text-ui-text font-mono">{context.result_schema.lead_name_field}</p>
            </div>
            <div>
              <span className="text-ui-accent text-xs">Categories</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {context.result_schema.categories.map((c, i) => (
                  <Badge key={i} className="text-ui-accent bg-ui-bg border-ui-border">{c}</Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="text-ui-accent text-xs">Geographies</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {context.result_schema.geographies.map((g, i) => (
                  <Badge key={i} className="text-ui-accent bg-ui-bg border-ui-border">{g}</Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="text-ui-accent text-xs">Signal Types</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {context.result_schema.signal_types.map((s, i) => (
                  <Badge key={i} className="text-blue-400 bg-blue-950 border-blue-800">{s}</Badge>
                ))}
              </div>
            </div>
          </div>
        </ContextSection>

        <ContextSection title="Scoring Thresholds">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border text-orange-400 bg-orange-950 border-orange-800">
                {context.score_thresholds.hot_min}+
              </div>
              <div>
                <p className="text-ui-text font-medium">Hot Lead</p>
                <p className="text-ui-accent text-xs">Score {context.score_thresholds.hot_min}-10 — clear, strong signal</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border text-yellow-400 bg-yellow-950 border-yellow-800">
                {context.score_thresholds.warm_min}+
              </div>
              <div>
                <p className="text-ui-text font-medium">Warm Lead</p>
                <p className="text-ui-accent text-xs">Score {context.score_thresholds.warm_min}-{context.score_thresholds.hot_min - 1} — indirect signal</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border text-gray-400 bg-gray-900 border-gray-700">
                1+
              </div>
              <div>
                <p className="text-ui-text font-medium">Cold Lead</p>
                <p className="text-ui-accent text-xs">Score 1-{context.score_thresholds.warm_min - 1} — weak fit</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-ui-border text-xs text-ui-accent">
              Minimum score to save: <strong className="text-ui-text">{context.score_thresholds.save_min}</strong> (below this, leads are discarded)
            </div>
          </div>
        </ContextSection>
      </div>

      {context.starred_leads.length > 0 && (
        <ContextSection title={`Starred Leads — Positive Examples (${context.starred_leads.length})`}>
          <p className="text-xs text-ui-accent mb-3">
            These starred leads are injected into the AI prompt as calibration examples. The AI scores similar companies higher.
          </p>
          <div className="space-y-2">
            {context.starred_leads.map((l, i) => (
              <div key={i} className="bg-ui-bg border border-ui-border rounded-lg p-3 flex items-start gap-3">
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ui-text">{l.company_name}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Badge className="text-blue-400 bg-blue-950 border-blue-800">{l.signal_type}</Badge>
                    <Badge className="text-ui-accent bg-ui-bg border-ui-border">{l.country}</Badge>
                    {l.fit_score && (
                      <Badge className={PRIORITY_BADGE[l.fit_score >= 8 ? "hot" : l.fit_score >= 5 ? "warm" : "cold"]}>
                        score: {l.fit_score}
                      </Badge>
                    )}
                  </div>
                  {l.raw_snippet && (
                    <p className="text-xs text-ui-accent mt-1.5 line-clamp-2 font-mono">{l.raw_snippet}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      <ContextSection title="Full AI System Prompt (sent to Ollama for every lead)">
        <button
          onClick={() => setExpandedPrompt(!expandedPrompt)}
          className="text-xs text-blue-400 hover:underline mb-2 flex items-center gap-1"
        >
          {expandedPrompt ? "Collapse" : "Expand full prompt"}
        </button>
        {expandedPrompt && (
          <pre className="bg-ui-bg border border-ui-border rounded-lg p-3 text-xs font-mono leading-relaxed text-ui-accent whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
            {context.qualifier_prompt}
            {context.starred_context && (
              <>
                {"\n\n"}
                {context.starred_context}
              </>
            )}
          </pre>
        )}
      </ContextSection>
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
        <p className="text-[11px] font-semibold text-ui-text px-3 py-1 truncate">{config.agent_name || project.name}</p>
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
