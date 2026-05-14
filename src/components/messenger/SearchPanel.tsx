import { useEffect, useState } from "react";
import { searchAll, findOrCreateDirectChat, joinGroupChat } from "@/lib/chat-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export function SearchPanel({ query, myProfileId, onPick, onClose }: {
  query: string; myProfileId: string;
  onPick: (chatId: string, preview?: any) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [results, setResults] = useState<{ users: any[]; groups: any[]; bots: any[] }>({
    users: [], groups: [], bots: [],
  });

  useEffect(() => {
    const id = setTimeout(() => searchAll(query).then(setResults), 200);
    return () => clearTimeout(id);
  }, [query]);

  const pickProfile = async (p: any, isBot: boolean) => {
    try {
      const chatId = await findOrCreateDirectChat(myProfileId, p.id, isBot);
      onPick(chatId, {
        id: chatId, type: isBot ? "bot" : "direct", name: null, avatar_url: null,
        last_message_at: new Date().toISOString(), other: p, last_text: null,
      });
    } catch (e: any) {
      toast.error(e.message ?? "Не удалось открыть чат");
    }
  };
  const pickGroup = async (g: any) => {
    try {
      const chatId = await joinGroupChat(g.id);
      onPick(g.id, { ...g, other: null, last_text: null });
    } catch (e: any) {
      toast.error(e.message ?? "Не удалось открыть группу");
    }
  };

  const empty = !results.users.length && !results.groups.length && !results.bots.length;
  return (
    <div className="absolute inset-x-0 bottom-0 top-[60px] z-10 overflow-y-auto bg-sidebar text-sidebar-foreground">
      {empty && <p className="p-8 text-center text-muted-foreground">{t("noResults")}</p>}
      {!!results.users.length && <Section title={t("users")}>
        {results.users.map((p) => (
          <Row key={p.id} title={p.display_name} subtitle={`@${p.username}`}
            avatar={p.avatar_url} onClick={() => pickProfile(p, false)} />
        ))}
      </Section>}
      {!!results.bots.length && <Section title={t("bots")}>
        {results.bots.map((p) => (
          <Row key={p.id} title={`${p.display_name} 🤖`} subtitle={`@${p.username}`}
            avatar={p.avatar_url} onClick={() => pickProfile(p, true)} />
        ))}
      </Section>}
      {!!results.groups.length && <Section title={t("groups")}>
        {results.groups.map((g) => (
          <Row key={g.id} title={g.name ?? "Группа"} subtitle="Группа"
            avatar={g.avatar_url} onClick={() => pickGroup(g)} />
        ))}
      </Section>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
function Row({ title, subtitle, avatar, onClick }: {
  title: string; subtitle: string; avatar?: string | null; onClick: () => void;
}) {
  const initials = (title.match(/\S/) ?? ["?"])[0].toUpperCase();
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent">
      <Avatar className="h-11 w-11">
        {avatar && <AvatarImage src={avatar} />}
        <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
      </div>
    </button>
  );
}
