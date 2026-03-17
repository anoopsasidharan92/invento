import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import tools, { ToolDefinition } from "./tools/registry";

// ── Hub home screen ────────────────────────────────────────────────────────────

function ToolCard({ tool, onOpen }: { tool: ToolDefinition; onOpen: () => void }) {
  const isLive = tool.status === "live";
  return (
    <button
      onClick={isLive ? onOpen : undefined}
      disabled={!isLive}
      className={[
        "group relative flex flex-col gap-4 p-6 rounded-2xl border text-left transition-all duration-200",
        isLive
          ? "bg-ui-card border-ui-border hover:border-gray-300 hover:shadow-md cursor-pointer"
          : "bg-gray-50 border-dashed border-ui-border cursor-default opacity-60",
      ].join(" ")}
    >
      {/* Icon tile */}
      <div className={`w-11 h-11 rounded-xl ${tool.color} flex items-center justify-center text-xl shadow-sm`}>
        {tool.icon}
      </div>

      {/* Text */}
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ui-text">{tool.name}</span>
          {!isLive && (
            <span className="text-[10px] font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
              Soon
            </span>
          )}
        </div>
        <p className="text-xs text-ui-accent leading-relaxed">{tool.description}</p>
      </div>

      {/* Arrow */}
      {isLive && (
        <ArrowLeft className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 rotate-180 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
      )}
    </button>
  );
}

function Hub({ onSelect }: { onSelect: (tool: ToolDefinition) => void }) {
  return (
    <div className="min-h-screen bg-ui-bg flex flex-col">
      {/* Top bar */}
      <header className="px-10 py-6 border-b border-ui-border bg-ui-card flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-ui-text flex items-center justify-center">
          <span className="text-white text-xs font-bold">A</span>
        </div>
        <span className="text-sm font-semibold text-ui-text">AI Tools</span>
      </header>

      {/* Content */}
      <main className="flex-1 px-10 py-12 max-w-4xl mx-auto w-full">
        <div className="mb-10 space-y-1">
          <h1 className="text-2xl font-semibold text-ui-text tracking-tight">Tools</h1>
          <p className="text-sm text-ui-accent">Select a tool to get started.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onOpen={() => onSelect(tool)} />
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTool, setActiveTool] = useState<ToolDefinition | null>(null);

  if (activeTool) {
    const ToolComponent = activeTool.component;
    return (
      <div className="h-screen flex flex-col bg-ui-bg overflow-hidden">
        {/* Back bar */}
        <div className="flex-shrink-0 px-4 py-2 border-b border-ui-border bg-ui-card flex items-center gap-3">
          <button
            onClick={() => setActiveTool(null)}
            className="flex items-center gap-1.5 text-xs text-ui-accent hover:text-ui-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All Tools
          </button>
          <span className="text-ui-border">|</span>
          <span className="text-xs font-medium text-ui-text">{activeTool.name}</span>
        </div>

        {/* Tool fills remaining height */}
        <div className="flex-1 overflow-hidden">
          <ToolComponent />
        </div>
      </div>
    );
  }

  return <Hub onSelect={setActiveTool} />;
}
