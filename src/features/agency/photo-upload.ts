// Client-side photo upload for bus/driver images. Uploads straight from the
// browser to Supabase Storage (bucket `vehicle-photos`) so files never pass
// through Next's Server Action / middleware body-size limits; the caller then
// submits only the returned public URL.
import { createClient } from '@/lib/supabase/client';

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // 6 MB

/** Returns an error message if the file isn't a valid photo, else null. */
export function validatePhoto(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Photos must be image files.';
  if (file.size > MAX_PHOTO_BYTES) return 'Each photo must be under 6 MB.';
  return null;
}

export async function uploadVehiclePhoto(file: File): Promise<string> {
  const sb = createClient();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage
    .from('vehicle-photos')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return sb.storage.from('vehicle-photos').getPublicUrl(path).data.publicUrl;
}
