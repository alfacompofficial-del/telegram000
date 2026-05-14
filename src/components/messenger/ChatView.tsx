import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import type { ChatListItem } from "@/lib/chat-api";
import type { Profile } from "@/hooks/useAuth";
import { handleCreatorBotMessage } from "@/lib/creator-bot";
import { toast } from "sonner";

export type Message = {
  id: string; chat_id: string; sender_id: string; content: string | null;
  type: "text" | "voice" | "sticker" | "file" | "image";
  file_url: string | null; file_name: string | null; created_at: string;
};

export function ChatView({ chat, myProfile, onChanged }: {
  chat: ChatListItem; myProfile: Profile; onChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [senders, setSenders] = useState<Record<string, Profile>>({});
  const [botCommands, setBotCommands] = useState<{ command: string; description: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const otherIsCreatorBot = chat.other?.username?.toLowerCase() === "creatorbot";
  const otherIsBot = chat.other?.is_bot;

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.from("messages").select("*")
        .eq("chat_id", chat.id).order("created_at", { ascending: true });
      if (!active) return;
      setMessages((data ?? []) as Message[]);
      // fetch sender profiles
      const ids = Array.from(new Set((data ?? []).map((m: any) => m.sender_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("*").in("id", ids);
        const map: Record<string, Profile> = {};
        ps?.forEach((p: any) => { map[p.id] = p; });
        setSenders(map);
      }
      // fetch bot commands for the active bot
      if (otherIsBot && chat.other) {
        const { data: cmds } = await supabase.from("bot_commands").select("command,description")
          .eq("bot_id", chat.other.id);
        setBotCommands(cmds ?? []);
      } else {
        setBotCommands([]);
      }
    })();
    const ch = supabase.channel(`chat-${chat.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        async (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
          if (!senders[m.sender_id]) {
            const { data: p } = await supabase.from("profiles").select("*").eq("id", m.sender_id).maybeSingle();
            if (p) setSenders((s) => ({ ...s, [m.sender_id]: p as Profile }));
          }
        })
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [chat.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async (payload: Partial<Message>) => {
    const { error } = await supabase.from("messages").insert({
      chat_id: chat.id, sender_id: myProfile.id, ...payload,
    });
    if (error) {
      toast.error(error.message ?? "Не удалось отправить сообщение");
      return;
    }
    onChanged();
    if (otherIsCreatorBot && chat.other && payload.type === "text" && payload.content) {
      await handleCreatorBotMessage({
        chatId: chat.id, botId: chat.other.id,
        ownerProfileId: myProfile.id, text: payload.content,
      });
    }
  };

  const title = chat.type === "group" ? (chat.name ?? "Группа") : (chat.other?.display_name ?? "");
  const subtitle = chat.type === "group" ? "Группа" : (chat.other ? `@${chat.other.username}${otherIsBot ? " · бот" : ""}` : "");
  const avatarUrl = chat.type === "group" ? chat.avatar_url : chat.other?.avatar_url;
  const initials = (title.match(/\S/) ?? ["?"])[0].toUpperCase();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3 shadow-sm">
        <Avatar className="h-10 w-10">
          {avatarUrl && <AvatarImage src={avatarUrl} />}
          <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-bg p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} mine={m.sender_id === myProfile.id}
              sender={senders[m.sender_id]} showSender={chat.type === "group"} />
          ))}
        </div>
      </div>
      <MessageInput onSend={send} botCommands={otherIsBot ? botCommands : []} />
    </div>
  );
}
