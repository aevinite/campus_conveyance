'use client';
import { useRef, useState, useTransition } from 'react';
import { addBusAction, type FormState } from '@/features/agency/actions';
import { uploadVehiclePhoto, validatePhoto } from '@/features/agency/photo-upload';
import { BusPhotosField, type PhotoItem } from '@/components/bus-photos-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormStatus } from '@/components/form-status';

const MIN_PHOTOS = 5;

function Field({
  name,
  label,
  type = 'text',
  required = false,
  placeholder,
  min,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} placeholder={placeholder} min={min} max={max} />
    </div>
  );
}

const fileCls =
  'flex w-full cursor-pointer rounded-lg border border-input bg-transparent text-sm text-muted-foreground shadow-2xs outline-none transition-colors file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

export function BusForm({ drivers = [] }: { drivers?: { id: string; name: string }[] }) {
  const [state, setState] = useState<FormState>({});
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const driverPhotoRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({});
    const form = formRef.current;
    if (!form) return;

    if (photos.length < MIN_PHOTOS) {
      setState({ error: `Please add at least ${MIN_PHOTOS} photos of the bus.` });
      return;
    }
    const driverFile = driverPhotoRef.current?.files?.[0] ?? null;
    if (driverFile) {
      const err = validatePhoto(driverFile);
      if (err) {
        setState({ error: err });
        return;
      }
    }

    const fd = new FormData(form);
    fd.delete('driverPhoto');

    setUploading(true);
    try {
      // All bus photos are new Files in Add mode → upload each, collect URLs.
      const urls: string[] = [];
      for (const p of photos) {
        urls.push(p.kind === 'url' ? p.url : await uploadVehiclePhoto(p.file));
      }
      fd.set('busPhotos', JSON.stringify(urls));
      if (driverFile) fd.set('driverPhotoUrl', await uploadVehiclePhoto(driverFile));
    } catch (err) {
      setUploading(false);
      setState({ error: `Photo upload failed: ${err instanceof Error ? err.message : 'please try again'}` });
      return;
    }
    setUploading(false);

    startTransition(async () => {
      const res = await addBusAction({}, fd);
      setState(res);
      if (res.message) {
        form.reset();
        setPhotos([]);
      }
    });
  }

  const busy = uploading || pending;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="max-w-2xl space-y-6">
      {/* Bus details */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Bus details</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="busNumber" label="Bus number" required placeholder="e.g. 1" />
          <Field name="registrationNo" label="RC / Registration number" required placeholder="e.g. GJ01AB1234" />
          <Field name="capacity" label="Capacity (seats)" type="number" min={1} max={100} required />
          <Field name="busModel" label="Bus model / make (optional)" placeholder="e.g. Tata Starbus" />
          <Field name="busColor" label="Bus colour (optional)" placeholder="e.g. Yellow" />
        </div>
        <div className="space-y-1.5">
          <Label>Air conditioning</Label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'AC', label: 'AC' },
              { value: 'NON_AC', label: 'Non-AC' },
            ] as const).map((o, i) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:font-medium has-[:checked]:text-primary"
              >
                <input type="radio" name="acType" value={o.value} defaultChecked={i === 0} className="size-4 accent-primary" />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Bus photos</Label>
          <BusPhotosField value={photos} onChange={setPhotos} min={MIN_PHOTOS} />
          <p className="text-xs text-muted-foreground">
            Add at least {MIN_PHOTOS} clear photos (front, sides, inside, seats…). The first is the cover students
            see. Max 6 MB each.
          </p>
        </div>
      </div>

      {/* Driver details */}
      <div className="space-y-4 border-t border-border pt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Driver details</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="driverName" label="Driver name" required />
          <Field name="driverPhone" label="Driver phone number" type="tel" required placeholder="e.g. +91 90000 00000" />
          <Field name="driverLicenseNo" label="Driving licence number" required placeholder="e.g. GJ0120210001234" />
          <Field name="driverExperienceYears" label="Experience (years, optional)" type="number" min={0} placeholder="e.g. 8" />
          <Field name="driverEmail" label="Driver email (optional)" type="email" placeholder="driver@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="driverPhoto">Driver photo (optional)</Label>
          <input ref={driverPhotoRef} id="driverPhoto" name="driverPhoto" type="file" accept="image/*" className={fileCls} />
          <p className="text-xs text-muted-foreground">A recent photo of the driver, uploaded from your device. Max 6 MB.</p>
        </div>
        {drivers.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="driverId">Driver login account (optional)</Label>
            <SelectMenu
              id="driverId"
              name="driverId"
              placeholder="Not assigned"
              options={[
                { value: '', label: 'Not assigned' },
                ...drivers.map((dr) => ({ value: dr.id, label: dr.name })),
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Assign one of your drivers so they see this bus &amp; its riders in the driver panel.
            </p>
          </div>
        )}
      </div>

      <FormStatus error={state.error} message={state.message} />
      <Button type="submit" disabled={busy}>
        {uploading ? 'Uploading photos…' : pending ? 'Saving…' : 'Add bus'}
      </Button>
    </form>
  );
}
