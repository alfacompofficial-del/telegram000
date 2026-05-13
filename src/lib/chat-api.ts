import { supabase } from "@/integrations/supabase/client";

export type ChatRow = {
  id: string; type: "direct" | "group" | "bot"; name: string | null;
  avatar_url: string | null; last_message_at: string;
};
export type ChatListItem = ChatRow & {
  other?: { id: string; username: string; display_name: string; avatar_url: string | null; is_bot: boolean } | null;
  last_text?: string | null;
};

export async function loadChatsForProfile(profileId: string): Promise<ChatListItem[]> {
  const { data: memberships } = await supabase
    .from("chat_members").select("chat_id").eq("profile_id", profileId);
  const ids = (memberships ?? []).map((m: any) => m.chat_id);
  if (!ids.length) return [];
  const { data: chats } = await supabase.from("chats").select("*")
    .in("id", ids).order("last_message_at", { ascending: false });
  // For direct/bot chats, find the other member
  const result: ChatListItem[] = [];
  for (const c of chats ?? []) {
    let other = null;
    if (c.type === "direct" || c.type === "bot") {
      const { data: members } = await supabase.from("chat_members")
        .select("profile_id").eq("chat_id", c.id);
      const otherId = members?.find((m: any) => m.profile_id !== profileId)?.profile_id;
      if (otherId) {
        const { data: p } = await supabase.from("profiles")
          .select("id,username,display_name,avatar_url,is_bot").eq("id", otherId).maybeSingle();
        other = p as any;
      }
    }
    const { data: lastMsg } = await supabase.from("messages")
      .select("content,type").eq("chat_id", c.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    result.push({ ...c, other, last_text: lastMsg?.content ?? (lastMsg?.type ? `[${lastMsg.type}]` : null) } as any);
  }
  return result;
}

export async function findOrCreateDirectChat(_myProfileId: string, otherProfileId: string, _isBot: boolean): Promise<string> {
  const { data: chatId, error } = await (supabase as any).rpc("find_or_create_direct_chat", {
    _other_profile_id: otherProfileId,
  });
  if (error) throw error;
  return chatId;
}

export async function createGroupChat(_myProfileId: string, name: string, memberIds: string[]) {
  const { data: chatId, error } = await (supabase as any).rpc("create_group_chat", {
    _name: name,
    _member_ids: memberIds,
  });
  if (error) throw error;
  return chatId;
}

export async function searchAll(query: string) {
  const q = query.trim();
  if (!q) return { users: [], groups: [], bots: [] };
  const isAt = q.startsWith("@");
  const term = q.replace(/^@/, "");
  const { data: profiles } = await supabase.from("profiles").select("*")
    .ilike("username", `%${term}%`).limit(20);
  const users = (profiles ?? []).filter((p: any) => !p.is_bot);
  const bots = (profiles ?? []).filter((p: any) => p.is_bot && p.username.toLowerCase().endsWith("bot"));
  let groups: any[] = [];
  if (!isAt) {
    const { data: g } = await supabase.from("chats").select("*")
      .eq("type", "group").ilike("name", `%${q}%`).limit(20);
    groups = g ?? [];
  }
  return { users, groups, bots };
}
