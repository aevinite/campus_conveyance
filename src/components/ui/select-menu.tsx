'use client';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  ariaLabel,
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
  /** Accessible name for the trigger when there's no visible <label htmlFor>. */
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Reset the search box too, so reopening a searchable menu doesn't show the
    // previous (now-stale) query and a pre-filtered list.
    function close() {
      setOpen(false);
      setQuery('');
    }
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Re-sync when the parent changes defaultValue without a form reset (e.g. an
  // edit form switching records). Fires only when defaultValue actually changes.
  // Also notify the parent, for parity with the form-reset path.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(defaultValue);
    onValueChange?.(defaultValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${id ?? name}-opt-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, id, name]);

  // Native form.reset() only clears real form controls; our value lives in React
  // state behind a hidden input, so it would stay stale after a successful add
  // (the next submit could silently resend the previous choice). Reset our state
  // when the owning form resets.
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onReset = () => {
      setValue(defaultValue);
      setQuery('');
      onValueChange?.(defaultValue);
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [defaultValue, onValueChange]);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const listboxId = `${id ?? name}-listbox`;
  const optionId = (i: number) => `${id ?? name}-opt-${i}`;

  function commit(o: SelectOption) {
    setValue(o.value);
    setQuery('');
    setOpen(false);
    onValueChange?.(o.value);
    buttonRef.current?.focus(); // return focus to the trigger
  }
  function openMenu() {
    setOpen(true);
    const sel = options.findIndex((o) => o.value === value);
    setActiveIndex(sel >= 0 ? sel : 0);
  }
  // Full keyboard model for the listbox (was mouse-only). Attached to whatever
  // holds focus while open (the trigger, or the search box when searchable).
  function onKeyDown(e: ReactKeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        const o = filtered[activeIndex];
        if (o) commit(o);
        break;
      }
      case 'Tab':
        setOpen(false); // let focus leave naturally, but close the menu
        break;
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <input type="hidden" name={name} value={value} />
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && !searchable ? optionId(activeIndex) : undefined}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
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
          id={listboxId}
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0); // matches list changed — re-anchor highlight
                }}
                onKeyDown={onKeyDown}
                aria-controls={listboxId}
                aria-activedescendant={optionId(activeIndex)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">No matches.</p>
            )}
            {filtered.map((o, i) => {
              const isSel = o.value === value;
              const isActive = i === activeIndex;
              return (
                <button
                  key={o.value}
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(o)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    isActive ? 'bg-muted' : isSel ? 'bg-muted/60' : 'hover:bg-muted',
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
