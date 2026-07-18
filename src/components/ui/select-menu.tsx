'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Branded single-select that matches the app's inputs/popovers. Replaces the
// native <select>, whose <option> list can't be themed (unreadable in dark mode).
// The chosen value rides along in a hidden input so normal form submission works.
// Note: the hidden input is intentionally NOT `required` — a required hidden field
// is unfocusable and would silently block submit; empty values are caught server-side.

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function SelectMenu({
  name,
  options,
  defaultValue = '',
  placeholder = 'Select…',
  searchable = false,
  searchPlaceholder = 'Search…',
  disabled = false,
  onValueChange,
  id,
  className,
}: {
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={ref} className={cn('relative', className)}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-2xs outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        <span className={cn('truncate', selected ? '' : 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">No matches.</p>
            )}
            {filtered.map((o) => {
              const isSel = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => {
                    setValue(o.value);
                    setQuery('');
                    setOpen(false);
                    onValueChange?.(o.value);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted',
                    isSel && 'bg-muted/60',
                  )}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  {isSel && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
