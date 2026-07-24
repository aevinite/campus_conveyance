'use client';
import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Bus, IdCard, Pencil, Phone, ShieldCheck, User, X } from 'lucide-react';
import { updateBusAction, type FormState } from '@/features/agency/actions';
import { uploadVehiclePhoto, validatePhoto } from '@/features/agency/photo-upload';
import { BusPhotosField, type PhotoItem } from '@/components/bus-photos-field';
import type { BusFull } from '@/features/agency/repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormStatus } from '@/components/form-status';
import { formatDateMedium } from '@/lib/format-date';
import { DriverChangePanel } from './driver-change-panel';

// Editing keeps at least one photo (for the cover); the full 5-photo rule only
// applies when ADDING a bus, so legacy buses with fewer photos stay editable.
const MIN_PHOTOS = 1;

const fileCls =
  'flex w-full cursor-pointer rounded-lg border border-input bg-transparent text-sm text-muted-foreground shadow-2xs outline-none transition-colors file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

function EditField({
  name,
  label,
  defaultValue,
  type = 'text',
  required = false,
  min,
  max,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-edit`}>{label}</Label>
      <Input
        id={`${name}-edit`}
        name={name}
        type={type}
        required={required}
        min={min}
        max={max}
        defaultValue={defaultValue ?? ''}
      />
    </div>
  );
}

export function EditableBusCard({
  bus,
  substituteDrivers = [],
}: {
  bus: BusFull;
  substituteDrivers?: { id: string; name: string; phone: string | null }[];
}) {
  // The permanent-driver dropdown = unassigned drivers + this bus's CURRENT one
  // (kept selectable). We reconstruct the current option from the bus itself
  // instead of receiving the whole agency roster as a prop on every card.
  const currentDriver =
    bus.driver_id ? [{ id: bus.driver_id, name: bus.driver_name ?? bus.driver_email ?? 'Driver' }] : [];
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<PhotoItem[]>(
    (bus.photos.length ? bus.photos : bus.image_url ? [bus.image_url] : []).map((url) => ({
      kind: 'url' as const,
      url,
    })),
  );
  const formRef = useRef<HTMLFormElement>(null);
  const driverPhotoRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploading || pending) return; // re-entry guard (Enter during the upload)
    setState({});
    const form = formRef.current;
    if (!form) return;

    if (photos.length < MIN_PHOTOS) {
      setState({ error: 'Please keep at least one photo of the bus.' });
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
    const uploadedUrls: string[] = [];
    try {
      for (const p of photos) {
        uploadedUrls.push(p.kind === 'url' ? p.url : await uploadVehiclePhoto(p.file));
      }
      fd.set('busPhotos', JSON.stringify(uploadedUrls));
      if (driverFile) fd.set('driverPhotoUrl', await uploadVehiclePhoto(driverFile));
    } catch (err) {
      setUploading(false);
      setState({ error: `Photo upload failed: ${err instanceof Error ? err.message : 'please try again'}` });
      return;
    }
    setUploading(false);

    startTransition(async () => {
      const res = await updateBusAction({}, fd);
      setState(res);
      if (res.message) {
        // Replace local File entries with the uploaded URLs so re-opening Edit
        // and saving again doesn't re-upload the same image (a duplicate storage
        // object). Now every entry is already a stored URL.
        setPhotos(uploadedUrls.map((url) => ({ kind: 'url' as const, url })));
        setEditing(false);
        router.refresh();
      }
    });
  }

  const busy = uploading || pending;

  // ---- View mode ----------------------------------------------------------
  if (!editing) {
    return (
      <div className="rounded-2xl border border-border bg-card/50 p-4 shadow-xs transition-colors hover:border-primary/30">
        <div className="flex flex-wrap items-start gap-4">
          {bus.image_url ? (
            <div className="relative h-28 w-40 shrink-0">
              <Image
                src={bus.image_url}
                alt={bus.bus_number ? `Bus ${bus.bus_number}` : 'Bus'}
                width={160}
                height={112}
                unoptimized
                className="h-28 w-40 rounded-xl border border-border object-cover"
              />
              {bus.photos.length > 1 && (
                <span className="absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {bus.photos.length} photos
                </span>
              )}
            </div>
          ) : (
            <div className="grid h-28 w-40 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
              <Bus className="size-8" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">
                {bus.bus_number ? `Bus ${bus.bus_number}` : 'Bus'}
              </span>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {bus.is_ac ? 'AC' : 'Non-AC'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {[bus.bus_model, bus.bus_color].filter(Boolean).join(' · ') || 'Bus'} · {bus.capacity} seats
            </p>
            {bus.registration_no && (
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <IdCard className="size-3.5" /> {bus.registration_no}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
              {bus.driver_photo_url ? (
                <Image
                  src={bus.driver_photo_url}
                  alt={bus.driver_name ?? 'Driver'}
                  width={28}
                  height={28}
                  unoptimized
                  className="size-7 rounded-full border border-border object-cover"
                />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-muted text-muted-foreground">
                  <User className="size-4" />
                </span>
              )}
              <span className="min-w-0 font-medium break-words">{bus.driver_name || 'Driver'}</span>
              {bus.driver_phone && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Phone className="size-3.5" /> {bus.driver_phone}
                </span>
              )}
              {bus.driver_verified && (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <ShieldCheck className="size-3" /> Verified
                </span>
              )}
            </div>
            {(bus.driver_license_no ||
              bus.driver_govt_id ||
              bus.driver_blood_group ||
              bus.driver_alt_phone ||
              bus.driver_dob ||
              bus.driver_address ||
              bus.driver_experience_years != null) && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                {bus.driver_license_no && <span>Licence: {bus.driver_license_no}</span>}
                {bus.driver_govt_id && <span>ID: {bus.driver_govt_id}</span>}
                {bus.driver_blood_group && <span>Blood group: {bus.driver_blood_group}</span>}
                {bus.driver_experience_years != null && <span>{bus.driver_experience_years} yrs experience</span>}
                {bus.driver_alt_phone && <span>Alt: {bus.driver_alt_phone}</span>}
                {bus.driver_dob && <span>DOB: {formatDateMedium(bus.driver_dob)}</span>}
                {bus.driver_address && <span>{bus.driver_address}</span>}
              </div>
            )}
            {bus.conductor_name && (
              <div className="pt-1.5 text-sm">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Conductor: </span>
                <span className="font-medium">{bus.conductor_name}</span>
                {bus.conductor_phone && <span className="text-muted-foreground"> · {bus.conductor_phone}</span>}
                {bus.conductor_verified && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    <ShieldCheck className="size-3" /> Verified
                  </span>
                )}
                {(bus.conductor_govt_id || bus.conductor_blood_group || bus.conductor_alt_phone) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                    {bus.conductor_govt_id && <span>ID: {bus.conductor_govt_id}</span>}
                    {bus.conductor_blood_group && <span>Blood group: {bus.conductor_blood_group}</span>}
                    {bus.conductor_alt_phone && <span>Alt: {bus.conductor_alt_phone}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          <Button type="button" variant="outline" size="sm" className="gap-1.5" aria-expanded={editing} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>
        <DriverChangePanel
          busId={bus.id}
          role="DRIVER"
          todayId={bus.today_driver_id}
          todayName={bus.today_driver_name}
          todayPhone={bus.today_driver_phone}
          todayReason={bus.today_driver_reason}
          regularName={bus.driver_name}
          drivers={substituteDrivers}
        />
        <DriverChangePanel
          busId={bus.id}
          role="CONDUCTOR"
          todayId={bus.today_conductor_id}
          todayName={bus.today_conductor_name}
          todayPhone={bus.today_conductor_phone}
          todayReason={bus.today_conductor_reason}
          regularName={bus.conductor_name}
          drivers={substituteDrivers}
        />
      </div>
    );
  }

  // ---- Edit mode ----------------------------------------------------------
  return (
    <div className="rounded-2xl border border-primary/40 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Edit {bus.bus_number ? `Bus ${bus.bus_number}` : 'bus'}</p>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setEditing(false); setState({}); }}>
          <X className="size-4" /> Cancel
        </Button>
      </div>

      <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
        <input type="hidden" name="busId" value={bus.id} />

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Bus details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditField name="busNumber" label="Bus number" required defaultValue={bus.bus_number} />
            <EditField name="registrationNo" label="RC / Registration number" required defaultValue={bus.registration_no} />
            <EditField name="capacity" label="Capacity (seats)" type="number" min={1} max={100} required defaultValue={bus.capacity} />
            <EditField name="busModel" label="Bus model / make (optional)" defaultValue={bus.bus_model} />
            <EditField name="busColor" label="Bus colour (optional)" defaultValue={bus.bus_color} />
          </div>
          <div className="space-y-1.5">
            <Label>Air conditioning</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'AC', label: 'AC', on: bus.is_ac },
                { value: 'NON_AC', label: 'Non-AC', on: !bus.is_ac },
              ] as const).map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:font-medium has-[:checked]:text-primary"
                >
                  <input type="radio" name="acType" value={o.value} defaultChecked={o.on} className="size-4 accent-primary" />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Bus photos</Label>
            <BusPhotosField value={photos} onChange={setPhotos} min={MIN_PHOTOS} />
            <p className="text-xs text-muted-foreground">
              Remove or add photos as needed — keep at least one (5 recommended). The first is the cover.
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Driver details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditField name="driverName" label="Driver name" required defaultValue={bus.driver_name} />
            <EditField name="driverPhone" label="Driver phone number" type="tel" required defaultValue={bus.driver_phone} />
            <EditField name="driverLicenseNo" label="Driving licence number" required defaultValue={bus.driver_license_no} />
            <EditField name="driverGovtId" label="Aadhaar / ID card number (optional)" defaultValue={bus.driver_govt_id} />
            <EditField name="driverAltPhone" label="Alternate / emergency contact (optional)" type="tel" defaultValue={bus.driver_alt_phone} />
            <EditField name="driverExperienceYears" label="Experience (years, optional)" type="number" min={0} defaultValue={bus.driver_experience_years} />
            <EditField name="driverDob" label="Date of birth (optional)" type="date" defaultValue={bus.driver_dob} />
            <EditField name="driverBloodGroup" label="Blood group (optional)" defaultValue={bus.driver_blood_group} />
            <EditField name="driverEmail" label="Driver email (optional)" type="email" defaultValue={bus.driver_email} />
            <EditField name="driverAddress" label="Residential address (optional)" defaultValue={bus.driver_address} />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-input px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="checkbox" name="driverVerified" defaultChecked={bus.driver_verified} className="size-4 accent-primary" />
            <span>Background / police verification completed for this driver</span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor={`driverPhoto-${bus.id}`}>Driver photo (leave empty to keep current)</Label>
            <input ref={driverPhotoRef} id={`driverPhoto-${bus.id}`} name="driverPhoto" type="file" accept="image/*" className={fileCls} />
          </div>
          {(substituteDrivers.length > 0 || currentDriver.length > 0) && (
            <div className="space-y-1.5">
              <Label htmlFor={`driverId-${bus.id}`}>Driver login account (optional)</Label>
              <SelectMenu
                id={`driverId-${bus.id}`}
                name="driverId"
                defaultValue={bus.driver_id ?? ''}
                placeholder="Not assigned"
                // Only UNASSIGNED drivers (+ this bus's current one) — a driver
                // can be the permanent driver of a single bus, so don't offer one
                // already driving another. (Server also enforces this.)
                options={[
                  { value: '', label: 'Not assigned' },
                  ...[...substituteDrivers, ...currentDriver].map((dr) => ({ value: dr.id, label: dr.name })),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                The assigned driver sees this bus &amp; its riders in the driver panel.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Conductor details (optional)</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditField name="conductorName" label="Conductor name" defaultValue={bus.conductor_name} />
            <EditField name="conductorPhone" label="Conductor phone number" type="tel" defaultValue={bus.conductor_phone} />
            <EditField name="conductorGovtId" label="Aadhaar / ID card number" defaultValue={bus.conductor_govt_id} />
            <EditField name="conductorAltPhone" label="Alternate / emergency contact" type="tel" defaultValue={bus.conductor_alt_phone} />
            <EditField name="conductorDob" label="Date of birth" type="date" defaultValue={bus.conductor_dob} />
            <EditField name="conductorBloodGroup" label="Blood group" defaultValue={bus.conductor_blood_group} />
            <EditField name="conductorAddress" label="Residential address" defaultValue={bus.conductor_address} />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-input px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="checkbox" name="conductorVerified" defaultChecked={bus.conductor_verified} className="size-4 accent-primary" />
            <span>Background / police verification completed for this conductor</span>
          </label>
        </div>

        <FormStatus error={state.error} message={state.message} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {uploading ? 'Uploading photos…' : pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className="w-full sm:w-auto"
            onClick={() => { setEditing(false); setState({}); }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
