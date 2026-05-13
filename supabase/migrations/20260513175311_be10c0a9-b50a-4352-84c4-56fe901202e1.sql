revoke execute on function public.find_or_create_direct_chat(uuid) from public, anon;
revoke execute on function public.create_group_chat(text, uuid[]) from public, anon;
revoke execute on function public.send_bot_message(uuid, uuid, text, text) from public, anon;
revoke execute on function public.is_chat_member(uuid) from public, anon;
revoke execute on function public.get_email_by_username(text) from public, anon;

grant execute on function public.find_or_create_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.send_bot_message(uuid, uuid, text, text) to authenticated;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.get_email_by_username(text) to authenticated, anon;

drop policy if exists "auth can create chats" on public.chats;
create policy "users create chats from own profile"
on public.chats
for insert
to authenticated
with check (
  created_by in (select id from public.profiles where user_id = auth.uid())
);

drop policy if exists "auth add members" on public.chat_members;
create policy "users add own membership"
on public.chat_members
for insert
to authenticated
with check (
  profile_id in (select id from public.profiles where user_id = auth.uid())
);