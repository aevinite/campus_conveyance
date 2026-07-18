/**
 * Dumb, presentational themed table. Each page maps its data to cells, so this
 * component stays free of any domain knowledge.
 */
export function DataTable({
  headers,
  rows,
  empty = 'Nothing to show yet.',
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="transition-colors hover:bg-secondary/30">
                {cells.map((c, j) => (
                  <td key={j} className="px-4 py-3 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
