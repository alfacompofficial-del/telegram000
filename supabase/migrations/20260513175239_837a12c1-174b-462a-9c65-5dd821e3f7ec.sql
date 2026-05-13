create or replace function public.find_or_create_direct_chat(_other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _caller_profile uuid;
  _other public.profiles%rowtype;
  _chat_id uuid;
  _chat_type text;
begin
  select id into _caller_profile
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if _caller_profile is null then
    raise exception 'Profile not found';
  end if;

  select * into _other
  from public.profiles
  where id = _other_profile_id;

  if _other.id is null then
    raise exception 'Target profile not found';
  end if;

  if _other.id = _caller_profile then
    raise exception 'Cannot start chat with yourself';
  end if;

  _chat_type := case when _other.is_bot then 'bot' else 'direct' end;

  select c.id into _chat_id
  from public.chats c
  join public.chat_members cm_me on cm_me.chat_id = c.id and cm_me.profile_id = _caller_profile
  join public.chat_members cm_other on cm_other.chat_id = c.id and cm_other.profile_id = _other_profile_id
  where c.type = _chat_type
  order by c.created_at asc
  limit 1;

  if _chat_id is not null then
    return _chat_id;
  end if;

  insert into public.chats (type, created_by)
  values (_chat_type, _caller_profile)
  returning id into _chat_id;

  insert into public.chat_members (chat_id, profile_id)
  values (_chat_id, _caller_profile), (_chat_id, _other_profile_id)
  on conflict do nothing;

  return _chat_id;
end;
$$;

grant execute on function public.find_or_create_direct_chat(uuid) to authenticated;

create or replace function public.create_group_chat(_name text, _member_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _caller_profile uuid;
  _chat_id uuid;
  _member_id uuid;
begin
  select id into _caller_profile
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if _caller_profile is null then
    raise exception 'Profile not found';
  end if;

  if length(trim(coalesce(_name, '')), 1) < 1 then
    raise exception 'Group name is required';
  end if;

  insert into public.chats (type, name, created_by)
  values ('group', trim(_name), _caller_profile)
  returning id into _chat_id;

  insert into public.chat_members (chat_id, profile_id)
  values (_chat_id, _caller_profile)
  on conflict do nothing;

  foreach _member_id in array coalesce(_member_ids, '{}') loop
    if exists (select 1 from public.profiles where id = _member_id and is_bot = false) then
      insert into public.chat_members (chat_id, profile_id)
      values (_chat_id, _member_id)
      on conflict do nothing;
    end if;
  end loop;

  return _chat_id;
end;
$$;

grant execute on function public.create_group_chat(text, uuid[]) to authenticated;