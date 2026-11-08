import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { draftbitApi } from '@/draftbit-api';

const studentsEndpoint = draftbitApi.endpoints['supabase-reset__get__students'];
const publishableKey = studentsEndpoint.headers.find((header) => header.name.toLowerCase() === 'apikey')?.value;
const supabaseProjectUrl = new URL(studentsEndpoint.baseUrl);

if (!publishableKey) {
  throw new Error('The existing Supabase publishable key is unavailable.');
}

/**
 * Non-secret diagnostic identifier for the configured Supabase project.
 * This intentionally exposes only the public project reference, never a URL,
 * publishable key, session, or other credential.
 */
export const configuredSupabaseProjectReference = supabaseProjectUrl.hostname.split('.')[0] ?? 'unavailable';

export const supabase = createClient(supabaseProjectUrl.origin, publishableKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
