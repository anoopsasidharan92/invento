import { useEffect, useRef, useState } from "react";
import { Bot, AlertCircle, ArrowRight, ChevronDown, ChevronRight, Brain } from "lucide-react";
import {
  MappingContent,
  PreviewContent,
  DoneContent,
} from "../api/client";

export type MessageRole = "agent" | "user" | "error";
export { type ConfirmMappingFn } from "./MappingCard";
export type CellEditFn = (rowIndex: number, field: string, value: string, applyAll?: boolean) => void;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  thinkingText?: string;
  mappingContent?: MappingContent;
  previewContent?: PreviewContent;
  doneContent?: DoneContent;
}

interface Props {
  messages: ChatMessage[];
  thinking: boolean;
  onConfirmMapping?: any; // kept for compatibility if needed, but App.tsx handles it now
  onCellEdit?: any;
}

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      className="w-full text-left group"
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-violet-500">
        <Brain className="w-3 h-3" />
        <span>Thinking</span>
        {expanded
          ? <ChevronDown className="w-3 h-3 ml-auto opacity-60" />
          : <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
      </div>
      {expanded && (
        <div
          className="mt-1.5 text-[13px] leading-relaxed text-ui-accent whitespace-pre-line border-l-2 border-violet-200 pl-3"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
      )}
    </button>
  );
}

export default function ChatWindow({ messages, thinking }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex-1 flex flex-col space-y-6 pb-4">
      {messages.map((msg) => {
        const isAgent = msg.role === "agent";
        const isError = msg.role === "error";

        const hasText = !!msg.text;
        const hasThinking = !!msg.thinkingText;
        const hasMapping = !!msg.mappingContent;
        const hasPreview = !!msg.previewContent;

        if (!hasText && !hasThinking && !hasMapping && !hasPreview) return null;

        return (
          <div
            key={msg.id}
            className={`msg-enter flex gap-4 ${isAgent || isError ? "justify-start" : "justify-end"}`}
          >
            {(isAgent || isError) && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white border border-ui-border shadow-sm mt-0.5">
                {isError
                  ? <AlertCircle className="w-4 h-4 text-red-400" />
                  : <Bot className="w-4 h-4 text-ui-text" />
                }
              </div>
            )}

            <div className={`flex flex-col gap-1.5 max-w-[85%] ${!isAgent && !isError ? "items-end" : "items-start"}`}>
              <span className="text-[11px] text-ui-accent px-1">
                {isAgent || isError ? "AI" : "You"}
              </span>

              {hasThinking && (
                <div className="bg-violet-50/60 border border-violet-100 rounded-xl px-4 py-2.5 shadow-sm max-w-md">
                  <ThinkingBlock text={msg.thinkingText!} />
                </div>
              )}

              {hasText && (
                <div className={[
                  "text-[15px] leading-relaxed",
                  isAgent ? "text-ui-text" : "",
                  !isAgent && !isError
                    ? "bg-ui-text text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm"
                    : "",
                  isError ? "text-red-500" : "",
                ].join(" ")}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text!) }}
                />
              )}

              {hasMapping && !hasText && (
                <div className="text-[14px] text-ui-text flex items-center gap-2 bg-white px-4 py-3 rounded-xl border border-ui-border shadow-sm">
                  Columns analyzed. Review the mapping in the panel.
                  <ArrowRight className="w-3.5 h-3.5 text-ui-accent flex-shrink-0" />
                </div>
              )}

              {hasPreview && !hasText && (
                <div className="text-[14px] text-ui-text flex items-center gap-2 bg-white px-4 py-3 rounded-xl border border-ui-border shadow-sm">
                  Data preview ready. Review it in the panel.
                  <ArrowRight className="w-3.5 h-3.5 text-ui-accent flex-shrink-0" />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {thinking && (
        <div className="msg-enter flex gap-4 justify-start">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border border-ui-border shadow-sm flex items-center justify-center mt-0.5">
            <Bot className="w-4 h-4 text-ui-text" />
          </div>
          <div className="flex flex-col gap-1.5 items-start">
            <span className="text-[11px] text-ui-accent px-1">AI</span>
            <div className="bg-white border border-ui-border shadow-sm px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
