import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Some projects set the anon key under NEXT_PUBLIC_SUPABASE_ANON_KEY; older code uses NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Log presence of env vars to help debugging (do NOT log secret values)
  if (!url || !key) {
    // Helpful error log for server console during development
    // Shows which piece is missing without printing secrets
    // eslint-disable-next-line no-console
    console.error("Supabase client creation failed. Missing URL or Key.", {
      urlPresent: !!url,
      anonKeyPresent: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      publishableKeyPresent: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    throw new Error("Supabase URL and Key are required to create a client. Check your env variables.");
  }
  
  // eslint-disable-next-line no-console
  console.log("Creating browser Supabase client (url and key present)");

  return createBrowserClient(url, key);
}
