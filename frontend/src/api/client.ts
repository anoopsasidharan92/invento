const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetInfo {
  headers: string[];
  sample_rows: Record<string, string>[];
  row_count: number;
  column_count: number;
}

export interface UploadResponse {
  file_id: string;
  original_filename: string;
  file_type: string;
  sheet_count: number;
  sheet_names: string[];
  sheets: Record<string, SheetInfo>;
}

export type Mapping = Record<string, string | null>;

export interface WSIncomingMessage {
  type:
    | "agent"
    | "mapping"
    | "preview"
    | "done"
    | "error";
  content: unknown;
}

export interface MappingContent {
  mapping: Mapping;
  discovered_fields: string[];
  available_columns: string[];
  sheet_name: string;
}

export interface PreviewContent {
  columns: string[];
  rows: Record<string, string>[];
  total_rows: number;
  file_id: string;
}

export interface DoneContent {
  file_id: string;
  row_count: number;
  mapped_fields: number;
}

// ─── REST helpers ─────────────────────────────────────────────────────────────

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Upload failed");
  }
  return res.json();
}

export function getDownloadUrl(fileId: string): string {
  return `${API_BASE}/download/${fileId}`;
}

// ─── WebSocket chat client ────────────────────────────────────────────────────

export type MessageHandler = (msg: WSIncomingMessage) => void;
export type ErrorHandler = (err: Event) => void;

export class ChatClient {
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private onError: ErrorHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private manualClose = false;

  constructor(onMessage: MessageHandler, onError: ErrorHandler) {
    this.onMessage = onMessage;
    this.onError = onError;
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.manualClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
      this.ws = new WebSocket(`${WS_BASE}/ws/chat`);

      this.ws.onopen = () => {
        this.connectPromise = null;
        resolve();
      };
      this.ws.onerror = (e) => {
        this.onError(e);
        this.connectPromise = null;
        reject(e);
      };
      this.ws.onmessage = (e) => {
        try {
          const msg: WSIncomingMessage = JSON.parse(e.data as string);
          this.onMessage(msg);
        } catch {
          // ignore malformed frames
        }
      };
      this.ws.onclose = () => {
        this.connectPromise = null;
        this.ws = null;
        if (!this.manualClose) {
          if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.connect().catch(() => {});
            }, 2000);
          }
        }
      };
    });
    return this.connectPromise;
  }

  send(type: string, content: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, content }));
    }
  }

  sendUserMessage(text: string): void {
    this.send("user", { text });
  }

  sendFileUploaded(uploadResponse: UploadResponse, selectedSheet: string): void {
    this.send("file_uploaded", {
      file_id: uploadResponse.file_id,
      original_filename: uploadResponse.original_filename,
      file_type: uploadResponse.file_type,
      sheet_names: uploadResponse.sheet_names,
      selected_sheet: selectedSheet,
    });
  }

  confirmMapping(mapping: Mapping, discoveredFields: string[]): void {
    this.send("confirm_mapping", { mapping, discovered_fields: discoveredFields });
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
