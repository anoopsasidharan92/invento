import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  isUnmatched?: boolean;
  onChange: (value: string) => void;
}

export default function CustomSelect({
  value,
  options,
  placeholder = "— skip —",
  disabled = false,
  isUnmatched = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={[
          "w-full flex items-center justify-between gap-1",
          "text-xs px-2.5 py-1.5 rounded-lg border outline-none",
          "bg-white transition-all duration-150 text-left",
          open
            ? "border-gray-400 shadow-sm"
            : "border-ui-border hover:border-gray-300",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          isUnmatched && !value ? "text-gray-400 italic" : "text-ui-text",
        ].join(" ")}
      >
        <span className="truncate">
          {selectedLabel ?? <span className="italic text-gray-400">{placeholder}</span>}
        </span>
        <ChevronDown
          className={`w-3 h-3 flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-ui-border rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] overflow-hidden">
          {/* Skip option */}
          <button
            type="button"
            onClick={() => handleSelect("")}
            className={[
              "w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors",
              !value
                ? "bg-gray-50 text-ui-text font-medium"
                : "text-gray-400 italic hover:bg-gray-50",
            ].join(" ")}
          >
            <span>{placeholder}</span>
            {!value && <Check className="w-3 h-3 text-ui-text" />}
          </button>

          {options.length > 0 && (
            <div className="border-t border-ui-border max-h-52 overflow-y-auto scrollbar-thin">
              {options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={[
                      "w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors",
                      isSelected
                        ? "bg-gray-50 text-ui-text font-medium"
                        : "text-ui-text hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className="w-3 h-3 flex-shrink-0 text-green-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
