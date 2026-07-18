'use client';
import { useState } from 'react';
import { SelectMenu } from './select-menu';

// App-styled time picker (hour · minute · AM/PM) that replaces the native
// <input type="time"> whose dropdown can't be themed. Submits a 24h "HH:MM"
// value via a hidden input under `name`, so server schemas stay unchanged.

const HOURS = Array.from({ length: 12 }, (_, i) => {
  const h = i + 1;
  return { value: String(h), label: String(h).padStart(2, '0') };
});
const MINUTES = Array.from({ length: 60 }, (_, m) => ({
  value: String(m),
  label: String(m).padStart(2, '0'),
}));
const MERIDIEMS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
];

function to24(h12: number, m: number, mer: string): string {
  let h = h12 % 12;
  if (mer === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function parseValue(value?: string): { h12: number; m: number; mer: 'AM' | 'PM' } {
  if (value && /^\d{1,2}:\d{2}/.test(value)) {
    const [hh, mm] = value.split(':').map(Number);
    return { h12: hh % 12 === 0 ? 12 : hh % 12, m: mm, mer: hh >= 12 ? 'PM' : 'AM' };
  }
  return { h12: 8, m: 0, mer: 'AM' }; // sensible default 08:00
}

export function TimePicker({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const init = parseValue(defaultValue);
  const [h12, setH12] = useState(init.h12);
  const [m, setM] = useState(init.m);
  const [mer, setMer] = useState<string>(init.mer);

  return (
    <div>
      <input type="hidden" name={name} value={to24(h12, m, mer)} />
      <div className="grid grid-cols-[1fr_1fr_5rem] items-center gap-2">
        <SelectMenu
          name={`${name}_h`}
          defaultValue={String(init.h12)}
          onValueChange={(v) => setH12(Number(v))}
          options={HOURS}
        />
        <SelectMenu
          name={`${name}_m`}
          searchable
          searchPlaceholder="Minute…"
          defaultValue={String(init.m)}
          onValueChange={(v) => setM(Number(v))}
          options={MINUTES}
        />
        <SelectMenu
          name={`${name}_mer`}
          defaultValue={init.mer}
          onValueChange={setMer}
          options={MERIDIEMS}
        />
      </div>
    </div>
  );
}
