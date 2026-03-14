import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Table2, Pencil } from "lucide-react";
import { PreviewContent, Taxonomy, getDownloadUrl } from "../api/client";

const PAGE_SIZE = 10;

const NICE_TO_FIELD: Record<string, string> = {
  "Category": "category",
  "Sub Category": "sub_category",
};

const EDITABLE_COLUMNS = new Set(["Category", "Sub Category"]);

interface Props {
  preview: PreviewContent;
  onCellEdit?: (rowIndex: number, field: string, value: string) => void;
}

interface EditingCell {
  rowIdx: number;
  col: string;
}

export default function DataPreview({ preview, onCellEdit }: Props) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [localRows, setLocalRows] = useState<Record<string, string>[]>(preview.rows);

  const taxonomy: Taxonomy = preview.taxonomy ?? {};
  const categories = Object.keys(taxonomy);
  const totalPages = Math.ceil(localRows.length / PAGE_SIZE);
  const visibleRows = localRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (preview.rows !== localRows && preview.rows.length > 0) {
    setLocalRows(preview.rows);
    setEditing(null);
  }

  const getSubCategories = useCallback(
    (cat: string): string[] => taxonomy[cat] ?? [],
    [taxonomy]
  );

  const handleSelect = useCallback(
    (absoluteIdx: number, col: string, value: string) => {
      const field = NICE_TO_FIELD[col];
      if (!field) return;

      setLocalRows((prev) => {
        const next = [...prev];
        next[absoluteIdx] = { ...next[absoluteIdx], [col]: value };
        return next;
      });
      setEditing(null);

      if (onCellEdit) onCellEdit(absoluteIdx, field, value);
    },
    [onCellEdit]
  );

  const renderCell = (row: Record<string, string>, pageRowIdx: number, col: string) => {
    const absoluteIdx = page * PAGE_SIZE + pageRowIdx;
    const value = String(row[col] ?? "");
    const isEditable = EDITABLE_COLUMNS.has(col) && !!onCellEdit && categories.length > 0;
    const isEditing =
      editing?.rowIdx === absoluteIdx && editing?.col === col;

    if (isEditing && col === "Category") {
      return (
        <select
          autoFocus
          className="bg-white text-ui-text text-xs rounded px-1 py-0.5 outline-none border border-ui-border w-full"
          value={value}
          onChange={(e) => {
            handleSelect(absoluteIdx, col, e.target.value);
            const currentSub = String(row["Sub Category"] ?? "");
            const newSubs = getSubCategories(e.target.value);
            if (newSubs.length > 0 && !newSubs.includes(currentSub)) {
              handleSelect(absoluteIdx, "Sub Category", newSubs[0]);
            }
          }}
          onBlur={() => setEditing(null)}
        >
          <option value="">— select —</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      );
    }

    if (isEditing && col === "Sub Category") {
      const parentCat = String(row["Category"] ?? "");
      const subs = getSubCategories(parentCat);
      return (
        <select
          autoFocus
          className="bg-white text-ui-text text-xs rounded px-1 py-0.5 outline-none border border-ui-border w-full"
          value={value}
          onChange={(e) => handleSelect(absoluteIdx, col, e.target.value)}
          onBlur={() => setEditing(null)}
        >
          <option value="">— select —</option>
          {subs.map((sub) => (
            <option key={sub} value={sub}>
              {sub}
            </option>
          ))}
          {!subs.includes(value) && value && (
            <option value={value}>{value} (current)</option>
          )}
        </select>
      );
    }

    if (isEditable) {
      return (
        <span
          className="group/cell flex items-center gap-1 cursor-pointer hover:text-black transition-colors"
          onClick={() => setEditing({ rowIdx: absoluteIdx, col })}
        >
          <span className="truncate max-w-[160px]">{value || "—"}</span>
          <Pencil className="w-3 h-3 opacity-0 group-hover/cell:opacity-60 flex-shrink-0 transition-opacity" />
        </span>
      );
    }

    return (
      <span className="truncate max-w-[180px]" title={value}>
        {value}
      </span>
    );
  };

  return (
    <div className="bg-ui-card border border-ui-border rounded-xl overflow-hidden w-full shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ui-border bg-gray-50/50">
        <Table2 className="w-4 h-4 text-ui-text" />
        <span className="text-sm font-medium text-ui-text">Data Preview</span>
        <span className="text-xs text-ui-accent ml-1">
          ({preview.total_rows.toLocaleString()} total rows)
        </span>
        {categories.length > 0 && (
          <span className="text-[10px] text-gray-500 ml-1 border border-ui-border rounded px-1.5 py-0.5">
            Click Category / Sub Category to edit
          </span>
        )}
        <a
          href={getDownloadUrl(preview.file_id)}
          download
          className="ml-auto flex items-center gap-1.5 text-xs text-ui-text hover:text-black font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ui-border bg-gray-50/30">
              {preview.columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap"
                >
                  {col}
                  {EDITABLE_COLUMNS.has(col) && categories.length > 0 && (
                    <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-gray-100 last:border-none hover:bg-gray-50 transition-colors"
              >
                {preview.columns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-2.5 text-ui-text whitespace-nowrap"
                  >
                    {renderCell(row, i, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-ui-border bg-white">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-ui-text" />
          </button>
          <span className="text-xs text-ui-accent">
            Page {page + 1} of {totalPages} · showing rows {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, localRows.length)}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-ui-text" />
          </button>
        </div>
      )}
    </div>
  );
}
