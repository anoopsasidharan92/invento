import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Wifi, WifiOff, Package, Trash2 } from "lucide-react";
import FileUpload from "./components/FileUpload";
import ChatWindow, { ChatMessage, ConfirmMappingFn } from "./components/ChatWindow";
import {
  ChatClient,
  MappingContent,
  PreviewContent,
  DoneContent,
  UploadResponse,
  WSIncomingMessage,
} from "./api/client";

let msgCounter = 0;
const newId = () => `msg-${++msgCounter}`;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [fileUploaded, setFileUploaded] = useState(false);
  const [doneFileId, setDoneFileId] = useState<string | null>(null);
  const clientRef = useRef<ChatClient | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleWSMessage = useCallback(
    (msg: WSIncomingMessage) => {
      setThinking(false);
      switch (msg.type) {
        case "agent":
          pushMessage({ id: newId(), role: "agent", text: msg.content as string });
          break;
        case "mapping":
          pushMessage({
            id: newId(),
            role: "agent",
            mappingContent: msg.content as MappingContent,
          });
          break;
        case "preview":
          pushMessage({
            id: newId(),
            role: "agent",
            previewContent: msg.content as PreviewContent,
          });
          break;
        case "done":
          setDoneFileId((msg.content as DoneContent).file_id);
          break;
        case "error":
          pushMessage({ id: newId(), role: "error", text: msg.content as string });
          break;
      }
    },
    [pushMessage]
  );

  useEffect(() => {
    const client = new ChatClient(
      handleWSMessage,
      () => setConnected(false)
    );
    clientRef.current = client;

    client
      .connect()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));

    return () => client.disconnect();
  }, [handleWSMessage]);

  // Re-check connection status
  useEffect(() => {
    const id = setInterval(() => {
      setConnected(clientRef.current?.isConnected ?? false);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleFileUploaded = useCallback(
    (response: UploadResponse, selectedSheet: string) => {
      setFileUploaded(true);
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

  const handleConfirmMapping = useCallback<ConfirmMappingFn>(
    (mapping, discoveredFields) => {
      setThinking(true);
      clientRef.current?.confirmMapping(mapping, discoveredFields);
    },
    []
  );

  const handleClearChat = useCallback(() => {
    // Reset all UI state
    setMessages([]);
    setThinking(false);
    setInput("");
    setFileUploaded(false);
    setDoneFileId(null);

    // Reconnect WebSocket so the backend also starts a fresh session
    const client = clientRef.current;
    if (client) {
      client.disconnect();
      client.connect()
        .then(() => setConnected(true))
        .catch(() => setConnected(false));
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">Inventory Parser AI</h1>
            <p className="text-xs text-slate-400 leading-tight">Powered by Ollama · llama3.2</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {connected ? (
            <div className="flex items-center gap-1.5 text-green-400 text-xs">
              <Wifi className="w-3.5 h-3.5" />
              Connected
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-red-400 text-xs">
              <WifiOff className="w-3.5 h-3.5" />
              Reconnecting…
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={handleClearChat}
              title="Clear chat and start over"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-400/10 border border-slate-700 hover:border-red-400/40 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </header>

      {/* Chat area */}
      <ChatWindow
        messages={messages}
        thinking={thinking}
        onConfirmMapping={handleConfirmMapping}
      />

      {/* Bottom: file upload + input */}
      <div className="flex-shrink-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur-sm">
        {!fileUploaded && (
          <FileUpload onUploaded={handleFileUploaded} disabled={!connected} />
        )}

        {fileUploaded && (
          <div className="px-3 py-2 flex items-center gap-1 border-b border-slate-800">
            <span className="text-xs text-slate-500">
              File loaded. You can type corrections or confirm the mapping above.
            </span>
            <button
              onClick={() => { setFileUploaded(false); setDoneFileId(null); }}
              className="ml-auto text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Upload new file
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              fileUploaded
                ? "Confirm mapping or type corrections (e.g. 'use column B for price')…"
                : "Upload a file to get started…"
            }
            disabled={!connected}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-brand-500 transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className="w-10 h-10 rounded-xl bg-brand-600 hover:bg-brand-700 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>

        {doneFileId && (
          <div className="px-4 pb-3 flex justify-center">
            <a
              href={`http://localhost:8000/download/${doneFileId}`}
              download
              className="text-xs text-brand-400 underline hover:text-brand-300"
            >
              Download normalised CSV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
