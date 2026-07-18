import { Armchair } from 'lucide-react';

/**
 * RedBus-style seat layout — VIEW ONLY. Students see how full the bus is;
 * they cannot pick a specific seat (seats are not individually assigned, so
 * the first `reserved` seats are rendered as booked). Green = available,
 * red = booked. 2+2 layout with an aisle, driver cab up front.
 */
export function SeatMap({ total, reserved }: { total: number; reserved: number }) {
  if (total <= 0) return null;
  const seats = Math.min(total, 120); // sanity cap at 120 (buses max out at 100 seats)
  const booked = Math.min(Math.max(reserved, 0), seats);
  const available = seats - booked;

  // Chunk into rows of 4 (2 left + aisle + 2 right); the back row keeps the
  // remainder, mimicking a real bus.
  const rows: number[][] = [];
  for (let s = 1; s <= seats; s += 4) {
    rows.push(Array.from({ length: Math.min(4, seats - s + 1) }, (_, i) => s + i));
  }

  const seatBox = (n: number) => {
    const isBooked = n <= booked;
    return (
      <span
        key={n}
        title={`Seat ${n} — ${isBooked ? 'booked' : 'available'}`}
        className={`grid size-7 place-items-center rounded-md border text-[10px] font-semibold tabular-nums ${
          isBooked
            ? 'border-destructive/40 bg-destructive/15 text-destructive'
            : 'border-success/40 bg-success/15 text-success'
        }`}
      >
        {n}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <p className="font-medium">
          Seats{' '}
          <span className={available > 0 ? 'text-success' : 'text-warning'}>
            — {available} of {seats} left
          </span>
        </p>
      </div>

      <div className="mx-auto w-fit rounded-2xl border border-border bg-muted/30 p-3">
        {/* Driver cab */}
        <div className="mb-2 flex items-center justify-end border-b border-dashed border-border pb-2 pr-0.5">
          <span
            title="Driver"
            className="grid size-7 place-items-center rounded-md border border-border bg-secondary text-muted-foreground"
          >
            <Armchair className="size-4" />
          </span>
        </div>
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {row.slice(0, 2).map(seatBox)}
              {/* aisle */}
              <span className="w-5" />
              {row.slice(2).map(seatBox)}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-success/40 bg-success/15" />
          Available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-destructive/40 bg-destructive/15" />
          Booked
        </span>
        <span>Seats are allotted by the agency — no need to pick one.</span>
      </div>
    </div>
  );
}
