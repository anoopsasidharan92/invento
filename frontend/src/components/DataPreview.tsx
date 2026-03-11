import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Table2 } from "lucide-react";
import { PreviewContent, getDownloadUrl } from "../api/client";

const PAGE_SIZE = 10;

const FIELD_COLORS: Record<string, string> = {
  sku: "text-yellow-300",
  description: "text-blue-300",
  size: "text-purple-300",
  quantity: "text-orange-300",
  retail_price: "text-green-300",
  offer_price: "text-emerald-300",
  barcode: "text-pink-300",
  links: "text-sky-300",
  photos: "text-violet-300",
  batch_id: "text-red-300",
  units_per_carton: "text-lime-300",
  shipping_details: "text-cyan-300",
};

interface Props {
  preview: PreviewContent;
}

export default function DataPreview({ preview }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(preview.rows.length / PAGE_SIZE);
  const visibleRows = preview.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden w-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
        <Table2 className="w-4 h-4 text-brand-400" />
        <span className="text-sm font-semibold text-slate-200">
          Data Preview
        </span>
        <span className="text-xs text-slate-400 ml-1">
          ({preview.total_rows.toLocaleString()} total rows)
        </span>
        <a
          href={getDownloadUrl(preview.file_id)}
          download
          className="ml-auto flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download CSV
        </a>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/60">
              {preview.columns.map((col) => (
                <th
                  key={col}
                  className={[
                    "px-3 py-2 text-left font-semibold whitespace-nowrap",
                    FIELD_COLORS[col] ?? "text-slate-300",
                  ].join(" ")}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
              >
                {preview.columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-slate-300 whitespace-nowrap max-w-[180px] truncate"
                    title={String(row[col] ?? "")}
                  >
                    {String(row[col] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-700">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-400">
            Page {page + 1} of {totalPages} · showing rows {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, preview.rows.length)}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
