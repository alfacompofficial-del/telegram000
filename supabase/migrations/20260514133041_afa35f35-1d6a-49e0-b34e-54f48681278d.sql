-- Restore trigger that keeps chat previews fresh
DROP TRIGGER IF EXISTS touch_chat_last_msg_trigger ON public.messages;
CREATE TRIGGER touch_chat_last_msg_trigger
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_chat_last_msg();

-- Let authenticated users discover group chats in search while keeping messages member-only
DROP POLICY IF EXISTS "authenticated can discover groups" ON public.chats;
CREATE POLICY "authenticated can discover groups"
ON public.chats
FOR SELECT
TO authenticated
USING (type = 'group');

-- Safer, deterministic direct/bot chat creation that bypasses UI-side RLS inserts
CREATE OR REPLACE FUNCTION public.find_or_create_direct_chat(_other_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_profile uuid;
  _other public.profiles%rowtype;
  _chat_id uuid;
  _chat_type text;
BEGIN
  SELECT id INTO _caller_profile
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _caller_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO _other
  FROM public.profiles
  WHERE id = _other_profile_id;

  IF _other.id IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  IF _other.id = _caller_profile THEN
    RAISE EXCEPTION 'Cannot start chat with yourself';
  END IF;

  _chat_type := CASE WHEN _other.is_bot THEN 'bot' ELSE 'direct' END;

  SELECT c.id INTO _chat_id
  FROM public.chats c
  JOIN public.chat_members cm_me ON cm_me.chat_id = c.id AND cm_me.profile_id = _caller_profile
  JOIN public.chat_members cm_other ON cm_other.chat_id = c.id AND cm_other.profile_id = _other_profile_id
  WHERE c.type = _chat_type
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF _chat_id IS NULL THEN
    INSERT INTO public.chats (type, created_by)
    VALUES (_chat_type, _caller_profile)
    RETURNING id INTO _chat_id;
  END IF;

  INSERT INTO public.chat_members (chat_id, profile_id)
  VALUES (_chat_id, _caller_profile), (_chat_id, _other_profile_id)
  ON CONFLICT DO NOTHING;

  RETURN _chat_id;
END;
$$;

-- Join a group from search safely; users can only add themselves
CREATE OR REPLACE FUNCTION public.join_group_chat(_chat_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_profile uuid;
BEGIN
  SELECT id INTO _caller_profile
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _caller_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chats WHERE id = _chat_id AND type = 'group') THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  INSERT INTO public.chat_members (chat_id, profile_id)
  VALUES (_chat_id, _caller_profile)
  ON CONFLICT DO NOTHING;

  RETURN _chat_id;
END;
$$;

-- CreatorBot privileged operations: keep token/private fields managed on backend
CREATE OR REPLACE FUNCTION public.creator_create_bot(_display_name text, _username text)
RETURNS TABLE(id uuid, username text, display_name text, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_profile uuid;
  _clean_username text;
  _token text;
  _bot_id uuid;
BEGIN
  SELECT p.id INTO _owner_profile
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF _owner_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  _clean_username := regexp_replace(trim(coalesce(_username, '')), '^@', '');

  IF length(trim(coalesce(_display_name, ''))) < 1 THEN
    RAISE EXCEPTION 'Bot name is required';
  END IF;

  IF _clean_username !~ '^[A-Za-z0-9_]{3,32}$' OR lower(_clean_username) NOT LIKE '%bot' THEN
    RAISE EXCEPTION 'Invalid bot username';
  END IF;

  IF (SELECT count(*) FROM public.profiles WHERE bot_owner_id = _owner_profile) >= 5 THEN
    RAISE EXCEPTION 'Bot limit reached';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(profiles.username) = lower(_clean_username)) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  _token := floor(random() * 900000000 + 100000000)::bigint::text || ':' || encode(gen_random_bytes(24), 'base64');

  INSERT INTO public.profiles (username, display_name, is_bot, bot_owner_id, bot_token)
  VALUES (_clean_username, trim(_display_name), true, _owner_profile, _token)
  RETURNING profiles.id INTO _bot_id;

  RETURN QUERY SELECT _bot_id, _clean_username, trim(_display_name), _token;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_list_bots()
RETURNS TABLE(id uuid, username text, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.username, b.display_name
  FROM public.profiles owner
  JOIN public.profiles b ON b.bot_owner_id = owner.id AND b.is_bot = true
  WHERE owner.user_id = auth.uid()
  ORDER BY b.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.creator_delete_bot(_bot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_profile uuid;
BEGIN
  SELECT id INTO _owner_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF _owner_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  DELETE FROM public.profiles
  WHERE id = _bot_id AND is_bot = true AND bot_owner_id = _owner_profile;

  IF NOT FOUND THEN RAISE EXCEPTION 'Bot not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_revoke_bot_token(_bot_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_profile uuid;
  _token text;
BEGIN
  SELECT id INTO _owner_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF _owner_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  _token := floor(random() * 900000000 + 100000000)::bigint::text || ':' || encode(gen_random_bytes(24), 'base64');

  UPDATE public.profiles
  SET bot_token = _token
  WHERE id = _bot_id AND is_bot = true AND bot_owner_id = _owner_profile;

  IF NOT FOUND THEN RAISE EXCEPTION 'Bot not found'; END IF;
  RETURN _token;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_set_bot_command(_bot_id uuid, _command text, _description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_profile uuid;
  _clean_command text;
BEGIN
  SELECT id INTO _owner_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF _owner_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _bot_id AND is_bot = true AND bot_owner_id = _owner_profile) THEN
    RAISE EXCEPTION 'Bot not found';
  END IF;

  _clean_command := CASE WHEN left(trim(coalesce(_command, '')), 1) = '/' THEN trim(_command) ELSE '/' || trim(coalesce(_command, '')) END;

  IF _clean_command !~ '^/[A-Za-z0-9_]{1,32}$' THEN
    RAISE EXCEPTION 'Invalid command';
  END IF;

  IF length(trim(coalesce(_description, ''))) < 1 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  INSERT INTO public.bot_commands (bot_id, command, description)
  VALUES (_bot_id, _clean_command, trim(_description))
  ON CONFLICT (bot_id, command)
  DO UPDATE SET description = excluded.description;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_set_bot_link(_bot_id uuid, _link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_profile uuid;
BEGIN
  SELECT id INTO _owner_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF _owner_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF length(trim(coalesce(_link, ''))) < 1 THEN
    RAISE EXCEPTION 'Link is required';
  END IF;

  UPDATE public.profiles
  SET bot_link = trim(_link)
  WHERE id = _bot_id AND is_bot = true AND bot_owner_id = _owner_profile;

  IF NOT FOUND THEN RAISE EXCEPTION 'Bot not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_direct_chat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_group_chat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_create_bot(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_list_bots() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_delete_bot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_revoke_bot_token(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_set_bot_command(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_set_bot_link(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.find_or_create_direct_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_create_bot(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_list_bots() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_delete_bot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_revoke_bot_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_set_bot_command(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_set_bot_link(uuid, text) TO authenticated;