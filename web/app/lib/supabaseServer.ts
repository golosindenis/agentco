import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The AUTH client — anon key, carries the session cookie, and is the only
 * Supabase client in this app that a user's identity flows through. It is
 * never used to read operations data: that goes through `../../src/db.js`,
 * which holds the service role key and knows nothing about sessions.
 * Keeping the two apart is what stops a session bug from becoming a data
 * leak, and vice versa.
 */
export async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function currentUser() {
  const supabase = await getSupabaseAuthClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
