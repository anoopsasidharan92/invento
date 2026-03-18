import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Package, Trash2, Download } from "lucide-react";
import FileUpload from "../components/FileUpload";
import ChatWindow, { ChatMessage, CellEditFn, ConfirmMappingFn } from "../components/ChatWindow";
import MappingCard from "../components/MappingCard";
import DataPreview from "../components/DataPreview";
import SheetSnapshot from "../components/SheetSnapshot";
import {
  ChatClient,
  MappingContent,
  PreviewContent,
  DoneContent,
  ProgressContent,
  UploadResponse,
  WSIncomingMessage,
  getDownloadUrl,
  getCleanTemplateDownloadUrl,
} from "../api/client";

let msgCounter = 0;
const newId = () => `msg-${++msgCounter}`;

const LOADING_PHRASES = [
  "Conceptualizing",
  "Analyzing structure",
  "Reasoning over columns",
  "Matching fields",
  "Cross-checking confidence",
  "Applying transformations",
  "Preparing preview",
];

export default function InventoryTool() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [fileUploaded, setFileUploaded] = useState(false);
  const [doneFileId, setDoneFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [enrichmentNeeded, setEnrichmentNeeded] = useState(false);
  const [progress, setProgress] = useState<ProgressContent | null>(null);
  const [loadingPhraseIdx, setLoadingPhraseIdx] = useState(0);
  const [loadingDots, setLoadingDots] = useState(1);
  const clientRef = useRef<ChatClient | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleWSMessage = useCallback(
    (msg: WSIncomingMessage) => {
      switch (msg.type) {
        case "agent":
          setThinking(false);
          pushMessage({ id: newId(), role: "agent", text: msg.content as string });
          break;
        case "mapping":
          setThinking(false);
          pushMessage({ id: newId(), role: "agent", mappingContent: msg.content as MappingContent });
          break;
        case "preview":
          setThinking(false);
          pushMessage({ id: newId(), role: "agent", previewContent: msg.content as PreviewContent });
          setPreviewFileId((msg.content as PreviewContent).file_id);
          break;
        case "done":
          setThinking(false);
          setDoneFileId((msg.content as DoneContent).file_id);
          setEnrichmentNeeded(Boolean((msg.content as DoneContent).enrichment_needed));
          setProgress(null);
          break;
        case "error":
          setThinking(false);
          pushMessage({ id: newId(), role: "error", text: msg.content as string });
          setProgress(null);
          break;
        case "progress":
          setProgress(msg.content as ProgressContent);
          setThinking(Boolean((msg.content as ProgressContent).active));
          break;
      }
    },
    [pushMessage]
  );

  useEffect(() => {
    const client = new ChatClient(handleWSMessage, () => setConnected(false));
    clientRef.current = client;
    client.connect().then(() => setConnected(true)).catch(() => setConnected(false));
    return () => client.disconnect();
  }, [handleWSMessage]);

  useEffect(() => {
    const id = setInterval(() => {
      setConnected(clientRef.current?.isConnected ?? false);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!progress?.active) return;
    const phraseTimer = setInterval(() => {
      setLoadingPhraseIdx((i) => (i + 1) % LOADING_PHRASES.length);
    }, 1800);
    const dotTimer = setInterval(() => {
      setLoadingDots((d) => (d % 3) + 1);
    }, 450);
    return () => { clearInterval(phraseTimer); clearInterval(dotTimer); };
  }, [progress?.active]);

  const handleFileUploaded = useCallback(
    (response: UploadResponse, selectedSheet: string) => {
      setFileUploaded(true);
      setPreviewFileId(response.file_id);
      setEnrichmentNeeded(false);
      setThinking(true);
      pushMessage({
        id: newId(),
        role: "user",
        text: `Uploaded: **${response.original_filename}** (${response.sheet_count} sheet${response.sheet_count > 1 ? "s" : ""}, sheet selected: ${selectedSheet})`,
      });
      clientRef.current?.sendFileUploaded(response, selectedSheet);
    },
    [pushMessage]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !connected) return;
    setInput("");
    pushMessage({ id: newId(), role: "user", text });
    setThinking(true);
    clientRef.current?.sendUserMessage(text);
    inputRef.current?.focus();
  }, [input, connected, pushMessage]);

  const sendQuickCommand = useCallback((command: string) => {
    if (!connected) return;
    pushMessage({ id: newId(), role: "user", text: command });
    setThinking(true);
    clientRef.current?.sendUserMessage(command);
  }, [connected, pushMessage]);

  const handleConfirmMapping = useCallback<ConfirmMappingFn>((mapping) => {
    setThinking(true);
    clientRef.current?.confirmMapping(mapping);
  }, []);

  const handleCellEdit = useCallback<CellEditFn>((rowIndex, field, value, applyAll) => {
    clientRef.current?.updateCell(rowIndex, field, value, applyAll);
  }, []);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    clientRef.current?.deleteRow(rowIndex);
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setThinking(false);
    setInput("");
    setFileUploaded(false);
    setDoneFileId(null);
    setPreviewFileId(null);
    setEnrichmentNeeded(false);
    setProgress(null);
    const client = clientRef.current;
    if (client) {
      client.disconnect();
      client.connect().then(() => setConnected(true)).catch(() => setConnected(false));
    }
  }, []);

  const latestContextMsg = [...messages].reverse().find(m => m.mappingContent || m.previewContent);

  return (
    <div className="flex h-full bg-ui-bg text-ui-text font-sans overflow-hidden">
      {/* Main area */}
      <div className="flex-1 flex flex-col relative min-w-0 transition-all duration-300">
        {/* Header */}
        <header className="flex items-center gap-3 px-8 py-5 flex-shrink-0 border-b border-ui-border/60 bg-ui-card">
          <div className="w-8 h-8 rounded-lg bg-ui-text flex items-center justify-center shadow-sm">
            <Package className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-ui-text leading-tight">Inventory Organizer</h1>
            <p className="text-xs text-ui-accent leading-tight">Powered by Ollama</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {connected ? (
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                <span className="status-dot-connected w-2 h-2 rounded-full bg-green-400 inline-block" />
                Connected
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                Reconnecting…
              </div>
            )}
            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                title="Clear chat and start over"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-ui-accent hover:text-red-500 hover:bg-red-50 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </header>

        {/* Progress bar */}
        {progress?.active && (
          <div className="relative px-8 py-3 border-b border-ui-border bg-white/70 backdrop-blur-sm z-10 flex items-center gap-3 text-xs text-ui-accent">
            <span className="text-ui-text font-medium">{LOADING_PHRASES[loadingPhraseIdx]}{".".repeat(loadingDots)}</span>
            <span className="text-ui-accent">· {progress.label}</span>
            {typeof progress.current === "number" && typeof progress.total === "number" && (
              <span className="ml-auto tabular-nums">{progress.current} / {progress.total}</span>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
              <div
                className="h-full progress-shimmer transition-all duration-300"
                style={{
                  width: typeof progress.percent === "number"
                    ? `${Math.max(2, Math.min(100, progress.percent))}%`
                    : "40%",
                }}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-8 py-6 scrollbar-thin">
          <div className="max-w-3xl mx-auto w-full h-full">
            {messages.length === 0 && !thinking && (
              <div className="flex flex-col items-center justify-center h-full gap-8 pb-16 select-none">
                <div className="w-12 h-12 rounded-2xl bg-ui-text flex items-center justify-center shadow-md">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-lg font-semibold text-ui-text tracking-tight">Inventory Organizer</h2>
                  <p className="text-[13px] text-ui-accent max-w-xs leading-relaxed">
                    Upload a file and I'll analyze, clean, and structure your inventory.
                  </p>
                </div>
                <div className="flex flex-col items-center gap-2">
                  {["Upload an inventory file", "Clean and normalize SKUs", "Detect duplicates", "Generate reorder plan"].map((hint) => (
                    <span key={hint} className="text-[12px] text-gray-400 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-gray-300 inline-block" />
                      {hint}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <ChatWindow
              messages={messages}
              thinking={thinking}
              onConfirmMapping={handleConfirmMapping}
              onCellEdit={handleCellEdit}
            />
          </div>
        </div>

        {/* Input bar */}
        <div className="flex-shrink-0 px-8 pb-8 pt-4">
          <div className="max-w-3xl mx-auto w-full bg-ui-card border border-ui-border rounded-2xl shadow-sm overflow-hidden flex flex-col input-bar transition-all duration-200">
            {!fileUploaded && (
              <FileUpload onUploaded={handleFileUploaded} disabled={!connected} />
            )}
            {fileUploaded && enrichmentNeeded && (
              <div className="px-4 py-3 flex items-center gap-2 border-b border-ui-border bg-gray-50/50">
                <span className="text-xs font-medium text-ui-accent mr-2">Quick Actions:</span>
                <button
                  onClick={() => sendQuickCommand("start enrichment")}
                  disabled={!connected}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-ui-text bg-white border border-ui-border shadow-sm hover:border-ui-accent hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Start Enrichment
                </button>
                <button
                  onClick={() => sendQuickCommand("enrich next batch")}
                  disabled={!connected}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-ui-text bg-white border border-ui-border shadow-sm hover:border-ui-accent hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Enrich Next Batch
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 px-4 py-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={fileUploaded ? "Ask AI to clean data, find duplicates, or generate reorder plan..." : "Upload a file to begin or type a command..."}
                disabled={!connected}
                className="flex-1 bg-transparent border-none text-sm text-ui-text placeholder-ui-accent outline-none px-2"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !connected}
                className="w-8 h-8 rounded-full bg-ui-text hover:bg-gray-800 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5 text-white -ml-0.5" />
              </button>
            </div>
            {(previewFileId || doneFileId) && (
              <div className="px-4 py-3 border-t border-ui-border bg-gray-50/50 flex items-center justify-center gap-3">
                <a
                  href={getDownloadUrl(doneFileId ?? previewFileId!)}
                  download
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-ui-text hover:bg-gray-800 shadow-sm transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                </a>
                {doneFileId && (
                  <a
                    href={getCleanTemplateDownloadUrl(doneFileId)}
                    download
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-ui-text bg-white border border-ui-border hover:bg-gray-50 transition-all"
                  >
                    Download Template
                  </a>
                )}
              </div>
            )}
          </div>
          {fileUploaded && (
            <div className="max-w-3xl mx-auto flex items-center justify-center mt-3">
              <button
                onClick={() => { setFileUploaded(false); setDoneFileId(null); setPreviewFileId(null); }}
                className="text-xs text-ui-accent hover:text-ui-text transition-colors"
              >
                Upload a different file
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Context panel */}
      {latestContextMsg && (
        <div className={[
          "border-l border-ui-border bg-ui-card flex flex-col h-full z-20",
          latestContextMsg.mappingContent ? "w-[760px] xl:w-[900px]" : "w-[400px] lg:w-[550px]"
        ].join(" ")}>
          <div className="px-6 py-4 border-b border-ui-border flex-shrink-0 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ui-text inline-block" />
            <span className="text-xs font-medium text-ui-accent">
              {latestContextMsg.mappingContent ? "Column Mapping" : "Data Preview"}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {latestContextMsg.mappingContent && (
              <div className="flex h-full divide-x divide-ui-border">
                <div className="flex-1 min-w-0 overflow-y-auto p-6 scrollbar-thin space-y-4">
                  <p className="text-[12px] text-ui-accent leading-relaxed">
                    Review and confirm how your sheet columns map to the standard format.
                  </p>
                  <MappingCard
                    mapping={latestContextMsg.mappingContent.mapping}
                    mappingConfidence={latestContextMsg.mappingContent.mapping_confidence}
                    lowConfidenceFields={latestContextMsg.mappingContent.low_confidence_fields}
                    availableColumns={latestContextMsg.mappingContent.available_columns}
                    onConfirm={handleConfirmMapping}
                  />
                </div>
                <div className="flex-1 min-w-0 overflow-y-auto p-6 scrollbar-thin space-y-4">
                  <p className="text-[12px] text-ui-accent leading-relaxed">
                    Raw sheet preview to help identify the correct column mappings.
                  </p>
                  <SheetSnapshot
                    headers={latestContextMsg.mappingContent.available_columns}
                    rows={latestContextMsg.mappingContent.sample_rows ?? []}
                  />
                </div>
              </div>
            )}
            {latestContextMsg.previewContent && (
              <div className="p-6 space-y-5">
                <p className="text-[12px] text-ui-accent leading-relaxed">
                  Preview the cleaned data. Click Category or Sub Category cells to edit.
                </p>
                <DataPreview preview={latestContextMsg.previewContent} onCellEdit={handleCellEdit} onDeleteRow={handleDeleteRow} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
