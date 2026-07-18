'use client';
import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

// Multi-photo picker for buses. Holds a mix of already-saved URLs (edit mode) and
// newly-picked Files; the parent uploads the Files on submit. First photo = cover.
export type PhotoItem = { kind: 'url'; url: string } | { kind: 'file'; file: File; preview: string };

const MAX_BYTES = 6 * 1024 * 1024;

export function photoSrc(it: PhotoItem): string {
  return it.kind === 'url' ? it.url : it.preview;
}

export function BusPhotosField({
  value,
  onChange,
  min = 5,
}: {
  value: PhotoItem[];
  onChange: (v: PhotoItem[]) => void;
  min?: number;
}) {
  const [err, setErr] = useState<string | null>(null);

  function add(files: FileList | null) {
    if (!files) return;
    setErr(null);
    const next = [...value];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        setErr('Only image files are allowed.');
        continue;
      }
      if (f.size > MAX_BYTES) {
        setErr('Each photo must be under 6 MB.');
        continue;
      }
      next.push({ kind: 'file', file: f, preview: URL.createObjectURL(f) });
    }
    onChange(next);
  }

  function remove(i: number) {
    const it = value[i];
    if (it?.kind === 'file') URL.revokeObjectURL(it.preview);
    onChange(value.filter((_, idx) => idx !== i));
  }

  const short = Math.max(0, min - value.length);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {value.map((it, i) => (
          <div
            key={i}
            className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc(it)} alt={`Bus photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
          <ImagePlus className="size-5" />
          Add photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>
      <p className={`text-xs ${short > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
        {value.length} photo{value.length === 1 ? '' : 's'} added
        {short > 0 ? ` · add ${short} more (minimum ${min})` : ` · minimum ${min} met ✓`}
      </p>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
