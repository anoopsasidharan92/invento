import { useState } from "react";
import { CheckCircle2, ChevronDown, Edit3, Sparkles, X, Plus } from "lucide-react";
import { Mapping } from "../api/client";

const STANDARD_FIELD_LABELS: Record<string, string> = {
  sku: "SKU / Item Code",
  description: "Product Description",
  size: "Size / Variant",
  quantity: "Quantity",
  retail_price: "Retail Price (RRP)",
  offer_price: "Offer / Trade Price",
  barcode: "Barcode (EAN/UPC)",
  links: "Product Links / URL",
  photos: "Photos / Image URL",
  batch_id: "Batch ID / Lot Number",
  units_per_carton: "Units per Carton",
  shipping_details: "Shipping Details",
};

function toLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  mapping: Mapping;
  discoveredFields: string[];
  availableColumns: string[];
  onConfirm: (mapping: Mapping, discoveredFields: string[]) => void;
}

interface FieldRowProps {
  field: string;
  label: string;
  value: string;
  availableColumns: string[];
  confirmed: boolean;
  onChange: (field: string, value: string) => void;
  onRemove?: (field: string) => void;
}

function FieldRow({ field, label, value, availableColumns, confirmed, onChange, onRemove }: FieldRowProps) {
  const isMatched = Boolean(value);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isMatched ? "text-slate-300" : "text-slate-500"}`}>
          {label}
        </p>
      </div>
      <div className="relative flex-1 min-w-0">
        <select
          disabled={confirmed}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          className={[
            "w-full text-xs rounded-lg px-2 py-1.5 pr-6 appearance-none border outline-none",
            "bg-slate-900 text-slate-200 border-slate-600",
            confirmed ? "opacity-60 cursor-not-allowed" : "hover:border-slate-400 focus:border-brand-500",
            !isMatched ? "text-slate-500" : "",
          ].join(" ")}
        >
          <option value="">— not mapped —</option>
          {availableColumns.map((col) => (
            <option key={col} value={col}>{col}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
      </div>
      {isMatched
        ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
        : <div className="w-4 h-4 flex-shrink-0" />
      }
      {onRemove && !confirmed && (
        <button
          onClick={() => onRemove(field)}
          className="flex-shrink-0 w-4 h-4 text-slate-500 hover:text-red-400 transition-colors"
          title="Remove discovered field"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {(!onRemove || confirmed) && <div className="w-4 h-4 flex-shrink-0" />}
    </div>
  );
}

export default function MappingCard({
  mapping: initialMapping,
  discoveredFields: initialDiscovered,
  availableColumns,
  onConfirm,
}: Props) {
  const [mapping, setMapping] = useState<Mapping>({ ...initialMapping });
  const [discoveredFields, setDiscoveredFields] = useState<string[]>([...initialDiscovered]);
  const [confirmed, setConfirmed] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [showAddField, setShowAddField] = useState(false);

  const handleChange = (field: string, value: string) => {
    setMapping((prev) => ({ ...prev, [field]: value === "" ? null : value }));
  };

  const handleRemoveDiscovered = (field: string) => {
    setDiscoveredFields((prev) => prev.filter((f) => f !== field));
    setMapping((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleAddField = () => {
    const safe = newFieldName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!safe || discoveredFields.includes(safe) || STANDARD_FIELD_LABELS[safe]) return;
    setDiscoveredFields((prev) => [...prev, safe]);
    setMapping((prev) => ({ ...prev, [safe]: null }));
    setNewFieldName("");
    setShowAddField(false);
  };

  const handleConfirm = () => {
    const activeMapping = Object.fromEntries(
      Object.entries(mapping).filter(([k]) =>
        STANDARD_FIELD_LABELS[k] !== undefined || discoveredFields.includes(k)
      )
    );
    setConfirmed(true);
    onConfirm(activeMapping, discoveredFields);
  };

  const standardMapped = Object.keys(STANDARD_FIELD_LABELS).filter((f) => mapping[f]);
  const discMapped = discoveredFields.filter((f) => mapping[f]);
  const totalMapped = standardMapped.length + discMapped.length;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden w-full max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 bg-slate-900/40">
        <Edit3 className="w-4 h-4 text-brand-400" />
        <span className="text-sm font-semibold text-slate-200">Column Mapping</span>
        <span className="ml-auto text-xs text-slate-400">
          {totalMapped} field{totalMapped !== 1 ? "s" : ""} matched
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Standard fields section ─────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Standard Fields
          </p>
          {Object.entries(STANDARD_FIELD_LABELS).map(([field, label]) => (
            <FieldRow
              key={field}
              field={field}
              label={label}
              value={mapping[field] ?? ""}
              availableColumns={availableColumns}
              confirmed={confirmed}
              onChange={handleChange}
            />
          ))}
        </div>

        {/* ── Discovered fields section ────────────────────────────────────── */}
        {(discoveredFields.length > 0 || !confirmed) && (
          <div className="space-y-2 pt-2 border-t border-slate-700/60">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                Discovered Fields
              </p>
              <span className="ml-1 text-xs text-slate-500">
                (auto-detected by the agent)
              </span>
            </div>

            {discoveredFields.length === 0 && !confirmed && (
              <p className="text-xs text-slate-500 italic pl-1">
                No extra fields were discovered for this file.
              </p>
            )}

            {discoveredFields.map((field) => (
              <FieldRow
                key={field}
                field={field}
                label={toLabel(field)}
                value={mapping[field] ?? ""}
                availableColumns={availableColumns}
                confirmed={confirmed}
                onChange={handleChange}
                onRemove={handleRemoveDiscovered}
              />
            ))}

            {/* Add custom field */}
            {!confirmed && (
              showAddField ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddField()}
                    placeholder="field_name (snake_case)"
                    className="flex-1 text-xs bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 placeholder-slate-500 outline-none focus:border-brand-500"
                    autoFocus
                  />
                  <button
                    onClick={handleAddField}
                    className="text-xs px-2 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-700/50 transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowAddField(false); setNewFieldName(""); }}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddField(true)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-400 transition-colors mt-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add custom field
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {!confirmed ? (
        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleConfirm}
            className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            Confirm Mapping
          </button>
          <p className="text-center text-xs text-slate-500">
            Remove discovered fields you don't need · Add custom ones · Or type corrections below
          </p>
        </div>
      ) : (
        <div className="px-4 pb-4 flex items-center justify-center gap-2 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Mapping confirmed — {totalMapped} fields
        </div>
      )}
    </div>
  );
}
