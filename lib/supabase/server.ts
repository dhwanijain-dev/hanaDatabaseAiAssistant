import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Prefer a service role key for server actions, fall back to anon / publishable keys
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Log which env vars we detected (don't log secret values)
  // eslint-disable-next-line no-console
  console.log("createServerClient: env presence", {
    urlPresent: !!url,
    serviceRolePresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonPresent: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    publishablePresent: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.error("Supabase server client creation failed: missing url or key");
    throw new Error(
      "Supabase URL and public key are required. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your environment.",
    );
  }

  return createServerClient(url, key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
