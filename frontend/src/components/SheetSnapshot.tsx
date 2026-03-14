interface Props {
  headers: string[];
  rows: Record<string, string>[];
}

function cut(v: string, max = 26): string {
  if (!v) return "";
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

export default function SheetSnapshot({ headers, rows }: Props) {
  const visibleHeaders = headers;
  const visibleRows = rows;

  return (
    <div className="bg-white border border-ui-border rounded-xl overflow-hidden w-full shadow-sm">
      <div className="px-4 py-3 border-b border-ui-border bg-gray-50/50">
        <p className="text-xs font-medium text-ui-text">Sheet Snapshot</p>
        <p className="text-[11px] text-ui-accent">Preview to help with mapping</p>
      </div>

      <div className="overflow-auto max-h-80 scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50/50">
              {visibleHeaders.map((h) => (
                <th
                  key={h}
                  className="text-left font-medium text-gray-500 px-3 py-2 border-b border-r border-gray-100 whitespace-nowrap last:border-r-0"
                >
                  {cut(h, 20)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50/30">
                {visibleHeaders.map((h) => (
                  <td
                    key={`${i}-${h}`}
                    className="text-ui-text px-3 py-2 border-b border-r border-gray-100 whitespace-nowrap last:border-r-0"
                    title={String(row[h] ?? "")}
                  >
                    {cut(String(row[h] ?? ""), 28)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
