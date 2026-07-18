'use client';
import { useState } from 'react';

// Simple, professional photo gallery: a large cover image + a thumbnail strip.
export default function BusGallery({ photos, alt }: { photos: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  if (photos.length === 0) return null;
  const idx = Math.min(active, photos.length - 1);

  return (
    <div className="space-y-2">
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-muted/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[idx]} alt={alt} className="h-full w-full object-cover" />
        {photos.length > 1 && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {idx + 1} / {photos.length}
          </span>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              type="button"
              key={i}
              onClick={() => setActive(i)}
              aria-label={`View photo ${i + 1}`}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border transition-all ${
                i === idx ? 'border-primary ring-2 ring-primary/30' : 'border-border opacity-80 hover:opacity-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
