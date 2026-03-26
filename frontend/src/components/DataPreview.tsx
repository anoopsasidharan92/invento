import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Table2, Pencil, Trash2 } from "lucide-react";
import { PreviewContent, Taxonomy, getDownloadUrl } from "../api/client";

const PAGE_SIZE = 10;

const NICE_TO_FIELD: Record<string, string> = {
  "Category": "category",
  "Sub Category": "sub_category",
  "Brand": "brand",
};

const EDITABLE_COLUMNS = new Set(["Category", "Sub Category", "Brand"]);

interface Props {
  preview: PreviewContent;
  onCellEdit?: (rowIndex: number, field: string, value: string, applyAll?: boolean) => void;
  onDeleteRow?: (rowIndex: number) => void;
}

interface EditingCell {
  rowIdx: number;
  col: string;
}

export default function DataPreview({ preview, onCellEdit, onDeleteRow }: Props) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [localRows, setLocalRows] = useState<Record<string, string>[]>(preview.rows);
  // Draft value for units_per_carton inline inputs (keyed by absolute row index)
  const [upcDrafts, setUpcDrafts] = useState<Record<number, string>>({});

  const taxonomy: Taxonomy = preview.taxonomy ?? {};
  const categories = Object.keys(taxonomy);
  const totalPages = Math.ceil(localRows.length / PAGE_SIZE);
  const visibleRows = localRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Whether total_carton is the mapped qty source and units_per_carton is missing
  const showUpcInput =
    (preview.total_carton_mapped ?? false) && !(preview.units_per_carton_mapped ?? false);

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

  /** Commit a units_per_carton value for a single row (or all rows if applyAll). */
  const commitUpc = useCallback(
    (absoluteIdx: number, value: string, applyAll: boolean) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Optimistic local update
      setLocalRows((prev) => {
        const next = applyAll
          ? prev.map((r) => ({ ...r, "Units Per Carton": trimmed }))
          : prev.map((r, i) => i === absoluteIdx ? { ...r, "Units Per Carton": trimmed } : r);
        // Also update Quantity in units locally
        return next.map((r, i) => {
          if (!applyAll && i !== absoluteIdx) return r;
          const tc = parseFloat(String(r["Total Carton"] ?? "").replace(",", ""));
          const upc = parseFloat(trimmed.replace(",", ""));
          if (!isNaN(tc) && !isNaN(upc)) {
            const qty = tc * upc;
            return { ...r, "Quantity in units": String(Number.isInteger(qty) ? qty : qty) };
          }
          return r;
        });
      });

      if (onCellEdit) onCellEdit(absoluteIdx, "units_per_carton", trimmed, applyAll);
    },
    [onCellEdit]
  );

  const handleDeleteRow = useCallback(
    (absoluteIdx: number) => {
      setLocalRows((prev) => prev.filter((_, i) => i !== absoluteIdx));
      if (onDeleteRow) onDeleteRow(absoluteIdx);
    },
    [onDeleteRow]
  );

  const renderCell = (row: Record<string, string>, pageRowIdx: number, col: string) => {
    const absoluteIdx = page * PAGE_SIZE + pageRowIdx;
    const value = String(row[col] ?? "");
    const isEditable =
      !!onCellEdit &&
      EDITABLE_COLUMNS.has(col) &&
      (col === "Brand" || categories.length > 0);
    const isEditing =
      editing?.rowIdx === absoluteIdx && editing?.col === col;

    // ── Units Per Carton editable input ─────────────────────────────────────
    if (col === "Units Per Carton" && showUpcInput && !!onCellEdit) {
      const draft = upcDrafts[absoluteIdx] ?? value;
      return (
        <div className="flex items-center gap-1 min-w-[110px]">
          <input
            type="number"
            min="1"
            placeholder="Enter qty"
            value={draft}
            onChange={(e) =>
              setUpcDrafts((prev) => ({ ...prev, [absoluteIdx]: e.target.value }))
            }
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) commitUpc(absoluteIdx, v, false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) commitUpc(absoluteIdx, v, false);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-20 text-xs border border-ui-border rounded px-1.5 py-0.5 outline-none focus:border-gray-400 bg-white text-ui-text"
          />
          <button
            title="Apply to all rows"
            onClick={() => {
              const v = (upcDrafts[absoluteIdx] ?? value).trim();
              if (v) commitUpc(absoluteIdx, v, true);
            }}
            className="text-[10px] text-gray-400 hover:text-black border border-ui-border rounded px-1 py-0.5 whitespace-nowrap transition-colors"
          >
            All
          </button>
        </div>
      );
    }

    if (isEditing && col === "Brand") {
      return (
        <input
          type="text"
          autoFocus
          className="w-full min-w-[120px] max-w-[220px] bg-white text-ui-text text-xs rounded px-1.5 py-0.5 outline-none border border-ui-border"
          defaultValue={value}
          onBlur={(e) => {
            handleSelect(absoluteIdx, col, e.target.value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim();
              handleSelect(absoluteIdx, col, v);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      );
    }

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
        {!!onCellEdit && (categories.length > 0 || preview.columns.includes("Brand")) && (
          <span className="text-[10px] text-gray-500 ml-1 border border-ui-border rounded px-1.5 py-0.5">
            Click Category / Sub Category / Brand to edit
          </span>
        )}
        {showUpcInput && (
          <span className="text-[10px] text-amber-600 ml-1 border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5">
            Enter Units Per Carton to calculate total unit qty
          </span>
        )}
        <a
          href={getDownloadUrl(preview.file_id)}
          download
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-ui-text bg-white border border-ui-border shadow-sm hover:border-gray-400 hover:bg-gray-50 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Download CSV
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
                  {EDITABLE_COLUMNS.has(col) && (col === "Brand" || categories.length > 0) && (
                    <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40" />
                  )}
                  {col === "Units Per Carton" && showUpcInput && (
                    <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-40 text-amber-500" />
                  )}
                </th>
              ))}
              {onDeleteRow && <th className="px-2 py-3 w-8" />}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const absoluteIdx = page * PAGE_SIZE + i;
              return (
                <tr
                  key={i}
                  className="group/row border-b border-gray-100 last:border-none hover:bg-gray-50 transition-colors"
                >
                  {preview.columns.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-2.5 text-ui-text whitespace-nowrap"
                    >
                      {renderCell(row, i, col)}
                    </td>
                  ))}
                  {onDeleteRow && (
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => handleDeleteRow(absoluteIdx)}
                        title="Remove row"
                        className="opacity-0 group-hover/row:opacity-100 p-1 rounded hover:bg-red-50 hover:text-red-500 text-gray-300 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
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
