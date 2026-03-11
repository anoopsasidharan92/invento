import React, { useCallback, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { uploadFile, UploadResponse } from "../api/client";

interface Props {
  onUploaded: (response: UploadResponse, selectedSheet: string) => void;
  disabled?: boolean;
}

export default function FileUpload({ onUploaded, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const res = await uploadFile(file);
        onUploaded(res, res.sheet_names[0]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onUploaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled || loading) return;
      const file = e.dataTransfer.files[0];
      if (file) handle(file);
    },
    [disabled, loading, handle]
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handle(file);
    e.target.value = "";
  };

  return (
    <div className="px-4 pb-4">
      <div
        onClick={() => !disabled && !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all",
          dragging ? "border-brand-500 bg-brand-500/10" : "border-slate-600 hover:border-slate-400",
          disabled || loading ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.xlsm"
          className="hidden"
          onChange={onChange}
          disabled={disabled || loading}
        />
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-brand-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Uploading & parsing…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-slate-300">
              <Upload className="w-5 h-5 text-brand-400" />
              <FileSpreadsheet className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm text-slate-300">
              <span className="text-brand-400 font-medium">Click to upload</span> or drag &amp; drop
            </p>
            <p className="text-xs text-slate-500">CSV, XLSX, XLS, XLSM supported</p>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-400 text-center">{error}</p>
      )}
    </div>
  );
}
