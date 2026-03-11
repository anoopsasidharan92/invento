import { useEffect, useRef } from "react";
import { Bot, User, AlertCircle, Loader2 } from "lucide-react";
import MappingCard from "./MappingCard";
import DataPreview from "./DataPreview";
import {
  Mapping,
  MappingContent,
  PreviewContent,
  DoneContent,
} from "../api/client";

export type MessageRole = "agent" | "user" | "error";
export type ConfirmMappingFn = (mapping: Mapping, discoveredFields: string[]) => void;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  mappingContent?: MappingContent;
  previewContent?: PreviewContent;
  doneContent?: DoneContent;
}

interface Props {
  messages: ChatMessage[];
  thinking: boolean;
  onConfirmMapping: ConfirmMappingFn;
}

function renderMarkdown(text: string) {
  // Basic bold (**text**) and line breaks
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export default function ChatWindow({ messages, thinking, onConfirmMapping }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
      {messages.map((msg) => {
        const isAgent = msg.role === "agent";
        const isError = msg.role === "error";

        return (
          <div
            key={msg.id}
            className={`flex gap-3 ${isAgent || isError ? "justify-start" : "justify-end"}`}
          >
            {(isAgent || isError) && (
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                isError ? "bg-red-900/60" : "bg-brand-700/60"
              }`}>
                {isError
                  ? <AlertCircle className="w-4 h-4 text-red-400" />
                  : <Bot className="w-4 h-4 text-brand-300" />
                }
              </div>
            )}

            <div className={`flex flex-col gap-2 max-w-[85%] ${!isAgent && !isError ? "items-end" : "items-start"}`}>
              {msg.text && (
                <div className={[
                  "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isAgent ? "bg-slate-800 text-slate-200 rounded-tl-sm" : "",
                  !isAgent && !isError ? "bg-brand-600 text-white rounded-tr-sm" : "",
                  isError ? "bg-red-900/40 text-red-300 border border-red-800/60 rounded-tl-sm" : "",
                ].join(" ")}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                />
              )}

              {msg.mappingContent && (
                <MappingCard
                  mapping={msg.mappingContent.mapping}
                  discoveredFields={msg.mappingContent.discovered_fields ?? []}
                  availableColumns={msg.mappingContent.available_columns}
                  onConfirm={onConfirmMapping}
                />
              )}

              {msg.previewContent && (
                <DataPreview preview={msg.previewContent} />
              )}
            </div>

            {!isAgent && !isError && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-4 h-4 text-slate-300" />
              </div>
            )}
          </div>
        );
      })}

      {thinking && (
        <div className="flex gap-3 justify-start">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-700/60 flex items-center justify-center">
            <Bot className="w-4 h-4 text-brand-300" />
          </div>
          <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
            <span className="text-sm text-slate-400">Thinking…</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
