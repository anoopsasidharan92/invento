import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Edit3, Package, Truck } from "lucide-react";
import { Mapping } from "../api/client";
import CustomSelect from "./CustomSelect";

// ─── Field definitions matching the output template ───────────────────────────

const PRIMARY_FIELDS: Record<string, string> = {
  sku: "SKU",
  product_name: "Product Name",
  quantity_in_units: "Quantity in units",
  barcode: "Barcode",
  barcode_key: "Barcode Key (EAN/UPC)",
  unit_size: "Unit Size",
  color: "Color",
  gender: "Gender",
  brand: "Brand",
  category: "Category",
  sub_category: "Sub Category",
  local_currency: "Local Currency",
  retail_price_local: "Retail Price (Local)",
  asking_price_local: "Asking Price (Local)",
  discount: "Discount",
  image_url: "Image URL",
  amazon_links: "Amazon Links",
};

const SECONDARY_FIELDS: Record<string, string> = {
  batch_code: "Batch Code",
  units_per_carton: "Units Per Carton",
  total_carton: "Total Carton",
  warehouse_location: "Warehouse Location",
  expiry_date: "Expiry Date (YYYY-MM-DD)",
  manufacturing_date: "Manufacturing Date",
  weight_per_unit: "Weight per unit",
  net_weight_of_carton: "Net weight of carton",
  cbm_per_carton: "CBM per carton",
  remarks: "Remarks",
  other_notes: "Other Notes",
};

export type ConfirmMappingFn = (mapping: Mapping) => void;

interface Props {
  mapping: Mapping;
  mappingConfidence?: Record<string, number>;
  lowConfidenceFields?: string[];
  availableColumns: string[];
  onConfirm: ConfirmMappingFn;
}

interface FieldRowProps {
  field: string;
  label: string;
  value: string;
  confidence?: number;
  isLowConfidence: boolean;
  availableColumns: string[];
  confirmed: boolean;
  onChange: (field: string, value: string) => void;
}

const CURRENCY_OPTIONS = [
  "USD", "EUR", "AED", "SGD", "INR", "GBP", "CNY", "JPY",
  "IDR", "MYR", "THB", "PHP", "AUD", "NZD",
  "HKD", "CAD", "CHF",
];

const CURRENCY_TOKEN_PREFIX = "__const_currency__:";
const CURRENCY_LABELS: Record<string, string> = {
  GBP: "Pound (GBP)",
};

function confidenceTextClass(conf?: number, isLow = false): string {
  if (isLow) return "text-orange-500";
  if (typeof conf !== "number") return "text-gray-400";
  if (conf >= 0.85) return "text-green-600";
  if (conf >= 0.7) return "text-yellow-600";
  return "text-orange-500";
}

function FieldRow({
  field,
  label,
  value,
  confidence,
  isLowConfidence,
  availableColumns,
  confirmed,
  onChange,
}: FieldRowProps) {
  const isMatched = Boolean(value);
  const isCurrencyField = field === "local_currency";
  const isConstCurrency = isCurrencyField && value.startsWith(CURRENCY_TOKEN_PREFIX);
  const detectedCurrencyColumn = isCurrencyField && value && !isConstCurrency ? value : "";
  const options = isCurrencyField
    ? [
        ...(detectedCurrencyColumn ? [detectedCurrencyColumn] : []),
        ...CURRENCY_OPTIONS.map((code) => `${CURRENCY_TOKEN_PREFIX}${code}`),
      ]
    : availableColumns;
  const optionLabel = (optionValue: string) => {
    if (isCurrencyField && optionValue.startsWith(CURRENCY_TOKEN_PREFIX)) {
      const code = optionValue.slice(CURRENCY_TOKEN_PREFIX.length);
      return `Currency: ${CURRENCY_LABELS[code] ?? code}`;
    }
    if (isCurrencyField) {
      return `Detected from sheet: ${optionValue}`;
    }
    return optionValue;
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isMatched ? "text-ui-text" : "text-gray-500"}`}>
          {label}
        </p>
        {isMatched && (
          <p className={`text-[11px] ${confidenceTextClass(confidence, isLowConfidence)}`}>
            {typeof confidence === "number"
              ? `Confidence: ${Math.round(confidence * 100)}%${isLowConfidence ? " (please review)" : ""}`
              : "Confidence: estimated"}
          </p>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <CustomSelect
          value={value}
          options={options.map((o) => ({ value: o, label: optionLabel(o) }))}
          placeholder="— skip —"
          disabled={confirmed}
          isUnmatched={!isMatched}
          onChange={(v) => onChange(field, v)}
        />
      </div>
      {isMatched
        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        : <div className="w-3.5 h-3.5 rounded-full border border-ui-border flex-shrink-0" />
      }
    </div>
  );
}

export default function MappingCard({
  mapping: initial,
  mappingConfidence = {},
  lowConfidenceFields = [],
  availableColumns,
  onConfirm,
}: Props) {
  const [mapping, setMapping] = useState<Mapping>({ ...initial });
  const [confirmed, setConfirmed] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);

  const handleChange = (field: string, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === "") { delete next[field]; } else { next[field] = value; }
      return next;
    });
  };

  const handleConfirm = () => {
    setConfirmed(true);
    onConfirm(mapping);
  };
  const primaryCount = Object.keys(PRIMARY_FIELDS).filter((f) => mapping[f]).length;
  const secondaryCount = Object.keys(SECONDARY_FIELDS).filter((f) => mapping[f]).length;

  return (
    <div className="bg-ui-card border border-ui-border rounded-xl overflow-hidden w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ui-border bg-gray-50/50">
        <Edit3 className="w-4 h-4 text-ui-text" />
        <span className="text-sm font-medium text-ui-text">Fields</span>
        <span className="ml-auto text-xs text-ui-accent">
          {primaryCount + secondaryCount} matched
        </span>
      </div>

      <div className="p-4 space-y-4">
        {lowConfidenceFields.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-orange-700">
                  Low-confidence mapping detected
                </p>
                <p className="text-xs text-orange-600">
                  Please review: {lowConfidenceFields.join(", ")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── PRIMARY FIELDS ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-ui-text" />
            <p className="text-[11px] font-semibold text-ui-text uppercase tracking-wider">
              Primary
            </p>
            <span className="ml-1 text-xs text-ui-accent">
              ({primaryCount}/{Object.keys(PRIMARY_FIELDS).length})
            </span>
          </div>

          {Object.entries(PRIMARY_FIELDS).map(([field, label]) => {
            return (
              <FieldRow
                key={field}
                field={field}
                label={label}
                value={mapping[field] ?? ""}
                confidence={mappingConfidence[field]}
                isLowConfidence={lowConfidenceFields.includes(field)}
                availableColumns={availableColumns}
                confirmed={confirmed}
                onChange={handleChange}
              />
            );
          })}
        </div>

        {/* ── SECONDARY FIELDS (collapsible) ─────────────────────────────── */}
        <div className="border-t border-ui-border pt-2">
          <button
            onClick={() => setShowSecondary(!showSecondary)}
            className="flex items-center gap-1.5 w-full text-left"
          >
            <Truck className="w-3.5 h-3.5 text-ui-accent" />
            <p className="text-[11px] font-semibold text-ui-accent uppercase tracking-wider">
              Secondary
            </p>
            <span className="ml-1 text-xs text-ui-accent">
              ({secondaryCount}/{Object.keys(SECONDARY_FIELDS).length})
            </span>
            <ChevronDown className={`w-3 h-3 text-ui-accent ml-auto transition-transform ${showSecondary ? "rotate-180" : ""}`} />
          </button>

          {showSecondary && (
            <div className="space-y-2 mt-2">
              {Object.entries(SECONDARY_FIELDS).map(([field, label]) => (
                <FieldRow
                  key={field}
                  field={field}
                  label={label}
                  value={mapping[field] ?? ""}
                  confidence={mappingConfidence[field]}
                  isLowConfidence={lowConfidenceFields.includes(field)}
                  availableColumns={availableColumns}
                  confirmed={confirmed}
                  onChange={handleChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {!confirmed ? (
        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleConfirm}
            className="w-full py-2 rounded-lg bg-ui-text hover:bg-gray-800 text-white text-sm font-medium transition-colors"
          >
            Confirm Mapping
          </button>
          <p className="text-center text-[11px] text-ui-accent">
            Missing fields are skipped. Category/Sub Category are auto-assigned per product row if not mapped.
          </p>
        </div>
      ) : (
        <div className="px-4 pb-4 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Confirmed — {primaryCount + secondaryCount} fields
        </div>
      )}
    </div>
  );
}
