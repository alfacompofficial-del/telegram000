import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ChatList } from "./ChatList";
import { ChatView } from "./ChatView";
import { SettingsSheet } from "./SettingsSheet";
import { ProfileDialog } from "./ProfileDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import { ContactsDialog } from "./ContactsDialog";
import { SearchPanel } from "./SearchPanel";
import { loadChatsForProfile, type ChatListItem } from "@/lib/chat-api";

export function Messenger() {
  const { profile } = useAuth();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showContacts, setShowContacts] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) return;
    const list = await loadChatsForProfile(profile.id);
    setChats(list);
  }, [profile?.id]);

  useEffect(() => { refresh(); }, [profile?.id]);

  // Realtime: refresh chat list on any new message
  useEffect(() => {
    if (!profile) return;
    const ch = supabase.channel("messenger-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]);

  const [pendingChat, setPendingChat] = useState<ChatListItem | null>(null);
  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId)
       ?? (pendingChat?.id === activeChatId ? pendingChat : null),
    [chats, activeChatId, pendingChat],
  );

  if (!profile) return null;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* LEFT: sidebar with search overlay */}
      <div className="relative flex-shrink-0">
        <ChatList
          chats={chats}
          activeId={activeChatId}
          onSelect={(id) => { setSearch(""); setActiveChatId(id); }}
          search={search}
          onSearchChange={setSearch}
          onOpenSettings={() => setShowSettings(true)}
          myProfile={profile}
        />
        {search.trim() && (
          <SearchPanel
            query={search}
            myProfileId={profile.id}
            onPick={async (chatId, preview) => {
              setSearch("");
              if (preview) setPendingChat(preview);
              setActiveChatId(chatId);
              await refresh();
            }}
            onClose={() => setSearch("")}
          />
        )}
      </div>
      {/* RIGHT: chat view */}
      <div className="relative flex-1">
        {activeChat ? (
          <ChatView chat={activeChat} myProfile={profile} onChanged={refresh} />
        ) : (
          <EmptyState />
        )}
      </div>

      <SettingsSheet
        open={showSettings} onOpenChange={setShowSettings}
        onOpenProfile={() => { setShowSettings(false); setShowProfile(true); }}
        onOpenNewGroup={() => { setShowSettings(false); setShowNewGroup(true); }}
        onOpenContacts={() => { setShowSettings(false); setShowContacts(true); }}
      />
      <ProfileDialog open={showProfile} onOpenChange={setShowProfile} />
      <NewGroupDialog open={showNewGroup} onOpenChange={setShowNewGroup} myProfileId={profile.id} onCreated={refresh} />
      <ContactsDialog open={showContacts} onOpenChange={setShowContacts} myProfileId={profile.id}
        onPickChat={(id) => { setShowContacts(false); setActiveChatId(id); refresh(); }} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center chat-bg">
      <div className="rounded-full bg-card/60 px-6 py-3 text-sm text-muted-foreground backdrop-blur">
        Выберите чат, чтобы начать общение
      </div>
    </div>
  );
}
