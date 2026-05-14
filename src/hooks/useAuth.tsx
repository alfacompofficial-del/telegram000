import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string; user_id: string | null; username: string;
  display_name: string; avatar_url: string | null; bio: string | null;
  is_bot: boolean; bot_owner_id: string | null;
};

const Ctx = createContext<{
  user: User | null; session: Session | null; profile: Profile | null;
  loading: boolean; refreshProfile: () => Promise<void>;
}>({ user: null, session: null, profile: null, loading: true, refreshProfile: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (authUser: User) => {
    const uid = authUser.id;
    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
    if (error) {
      console.error("loadProfile failed", error);
      setProfile(null);
      return;
    }
    if (data) {
      setProfile(data as Profile);
      return;
    }

    const rawUsername = String(authUser.user_metadata?.username ?? authUser.email?.split("@")[0] ?? `user_${uid.slice(0, 8)}`);
    const username = rawUsername.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20) || `user_${uid.slice(0, 8)}`;
    const { data: created, error: createError } = await supabase.from("profiles").upsert({
      user_id: uid,
      username,
      display_name: String(authUser.user_metadata?.display_name ?? username),
      email: authUser.email,
      is_bot: false,
    }, { onConflict: "user_id" }).select("*").single();
    if (createError) {
      console.error("createProfile failed", createError);
      setProfile(null);
      return;
    }
    setProfile(created as Profile);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setLoading(true);
        setTimeout(() => loadProfile(s.user).finally(() => setLoading(false)), 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadProfile(s.user).finally(() => setLoading(false));
      else setLoading(false);
    }).catch(() => setLoading(false));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{
      user: session?.user ?? null, session, profile, loading,
      refreshProfile: async () => { if (session?.user) await loadProfile(session.user); },
    }}>{children}</Ctx.Provider>
  );
}
export const useAuth = () => useContext(Ctx);
