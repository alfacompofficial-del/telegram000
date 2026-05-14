import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";

export function AuthScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const clean = username.replace(/^@/, "").trim();
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(clean)) {
          toast.error("Никнейм: 3-20 символов, латиница/цифры/_");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { username: clean, display_name: clean },
          },
        });
        if (error) throw error;
        if (data.session?.user) {
          const { error: profileError } = await supabase.from("profiles").upsert({
            user_id: data.session.user.id,
            username: clean,
            display_name: clean,
            email,
            is_bot: false,
          }, { onConflict: "user_id" });
          if (profileError) throw profileError;
        }
        toast.success("Аккаунт создан!");
      } else {
        const clean = username.replace(/^@/, "").trim();
        const { data: emailData, error: rpcErr } = await supabase
          .rpc("get_email_by_username", { _username: clean });
        if (rpcErr || !emailData) { toast.error("Пользователь не найден"); return; }
        const { error } = await supabase.auth.signInWithPassword({
          email: emailData as string, password,
        });
        if (error) throw error;
        if (!remember) {
          // best-effort: clear after window close handled by browser
        }
      }
    } catch (err: any) {
      toast.error(err.message ?? "Ошибка");
    } finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background chat-bg p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <MessageCircle className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-semibold">{t("appName")}</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login" ? t("login") : t("signup")}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label>{t("email")}</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>@{t("username")}</Label>
            <Input required placeholder="@nickname" value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("password")}</Label>
            <Input type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === "signup" && (
            <div className="flex items-center gap-2">
              <Checkbox id="remember" checked={remember}
                onCheckedChange={(v) => setRemember(!!v)} />
              <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
                {t("remember")}
              </Label>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "login" ? t("signIn") : t("signUp")}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <button onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="text-link hover:underline">
            {mode === "login" ? t("noAccount") + " " + t("signUp") : t("haveAccount") + " " + t("signIn")}
          </button>
        </div>
      </div>
    </div>
  );
}
