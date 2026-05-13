-- Allow bots to send messages via SECURITY DEFINER function.
-- Callers must be authenticated AND either:
--  * own the bot (bot_owner_id matches caller's profile), OR
--  * the bot is the system @CreatorBot (no owner).
create or replace function public.send_bot_message(
  _chat_id uuid,
  _bot_id uuid,
  _content text,
  _type text default 'text'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _caller_profile uuid;
  _bot record;
  _msg_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id into _caller_profile from public.profiles where user_id = auth.uid() limit 1;
  if _caller_profile is null then
    raise exception 'caller profile not found';
  end if;

  select * into _bot from public.profiles where id = _bot_id and is_bot = true;
  if _bot is null then
    raise exception 'bot not found';
  end if;

  -- Permission: caller must own the bot OR bot is the system CreatorBot
  if _bot.bot_owner_id is distinct from _caller_profile
     and lower(_bot.username) <> 'creatorbot' then
    raise exception 'not permitted to act as this bot';
  end if;

  -- Caller must be a member of the chat (so bots only post in chats the user is in)
  if not exists (
    select 1 from public.chat_members
    where chat_id = _chat_id and profile_id = _caller_profile
  ) then
    raise exception 'caller not in chat';
  end if;

  -- Make sure bot is also a member of the chat
  insert into public.chat_members (chat_id, profile_id)
  values (_chat_id, _bot_id)
  on conflict do nothing;

  insert into public.messages (chat_id, sender_id, content, type)
  values (_chat_id, _bot_id, _content, _type)
  returning id into _msg_id;

  return _msg_id;
end $$;

grant execute on function public.send_bot_message(uuid, uuid, text, text) to authenticated;