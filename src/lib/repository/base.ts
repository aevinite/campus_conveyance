import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Base class for repositories. Feature repositories extend this and expose
 * typed methods, so services depend on a narrow interface rather than calling
 * the Supabase client directly.
 */
export abstract class BaseRepository {
  constructor(protected readonly db: SupabaseClient) {}
}
