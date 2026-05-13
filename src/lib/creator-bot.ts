import { supabase } from "@/integrations/supabase/client";

// Local conversation state per user with CreatorBot
type State =
  | { step: "idle" }
  | { step: "newbot_name" }
  | { step: "newbot_username"; name: string }
  | { step: "deletebot_pick"; bots: any[] }
  | { step: "revoketoken_pick"; bots: any[] }
  | { step: "setcommand_pickbot"; bots: any[] }
  | { step: "setcommand_command"; botId: string }
  | { step: "setcommand_desc"; botId: string; command: string }
  | { step: "getlink_pickbot"; bots: any[] }
  | { step: "getlink_link"; botId: string };

const stateMap = new Map<string, State>(); // key: ownerProfileId

const getState = (id: string): State => stateMap.get(id) ?? { step: "idle" };
const setState = (id: string, s: State) => stateMap.set(id, s);

async function botSay(chatId: string, botId: string, text: string) {
  const { error } = await supabase.rpc("send_bot_message", {
    _chat_id: chatId, _bot_id: botId, _content: text, _type: "text",
  });
  if (error) console.error("botSay failed", error);
}

function genToken() {
  const num = Math.floor(100000000 + Math.random() * 900000000);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
  return `${num}:${rand}`;
}

export async function handleCreatorBotMessage(opts: {
  chatId: string; botId: string; ownerProfileId: string; text: string;
}) {
  const { chatId, botId, ownerProfileId, text } = opts;
  const cmd = text.trim();
  const state = getState(ownerProfileId);

  // Multi-step flows first
  if (state.step === "newbot_name") {
    setState(ownerProfileId, { step: "newbot_username", name: cmd });
    await botSay(chatId, botId, `Отлично! Теперь введите @никнейм для бота. Он обязательно должен заканчиваться на **bot** (например: MusicBot).`);
    return;
  }
  if (state.step === "newbot_username") {
    const uname = cmd.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(uname) || !uname.toLowerCase().endsWith("bot")) {
      await botSay(chatId, botId, `❌ Неверный формат. Никнейм должен заканчиваться на **bot**, 3–32 символа (латиница/цифры/_).`);
      return;
    }
    // Limit 5 bots
    const { count } = await supabase.from("profiles").select("*", { count: "exact", head: true })
      .eq("bot_owner_id", ownerProfileId);
    if ((count ?? 0) >= 5) {
      setState(ownerProfileId, { step: "idle" });
      await botSay(chatId, botId, `❌ Лимит: один пользователь может создать не более 5 ботов.`);
      return;
    }
    const { data: exists } = await supabase.from("profiles").select("id").eq("username", uname).maybeSingle();
    if (exists) {
      await botSay(chatId, botId, `❌ Этот никнейм уже занят. Попробуйте другой.`);
      return;
    }
    const token = genToken();
    const { data: bot, error } = await supabase.from("profiles").insert({
      username: uname, display_name: state.name, is_bot: true,
      bot_owner_id: ownerProfileId, bot_token: token,
    }).select().single();
    setState(ownerProfileId, { step: "idle" });
    if (error) { await botSay(chatId, botId, `❌ Ошибка: ${error.message}`); return; }
    await botSay(chatId, botId,
`✅ Готово! Бот создан.

Имя: ${state.name}
Ник: @${uname}
Ссылка: t.me/${uname} (внутри приложения откройте поиском «@${uname}»)

🔑 API-токен:
\`${token}\`

Сохраните токен — с его помощью можно управлять ботом из Python кода.`);
    return;
  }

  if (state.step === "deletebot_pick") {
    const target = state.bots.find((b) => b.username.toLowerCase() === cmd.replace(/^@/, "").toLowerCase());
    setState(ownerProfileId, { step: "idle" });
    if (!target) { await botSay(chatId, botId, `Бот не найден.`); return; }
    await supabase.from("profiles").delete().eq("id", target.id);
    await botSay(chatId, botId, `🗑️ Бот @${target.username} удалён.`);
    return;
  }

  if (state.step === "revoketoken_pick") {
    const target = state.bots.find((b) => b.username.toLowerCase() === cmd.replace(/^@/, "").toLowerCase());
    setState(ownerProfileId, { step: "idle" });
    if (!target) { await botSay(chatId, botId, `Бот не найден.`); return; }
    const newToken = genToken();
    await supabase.from("profiles").update({ bot_token: newToken }).eq("id", target.id);
    await botSay(chatId, botId, `🔄 Новый токен для @${target.username}:\n\n\`${newToken}\``);
    return;
  }

  if (state.step === "setcommand_pickbot") {
    const target = state.bots.find((b) => b.username.toLowerCase() === cmd.replace(/^@/, "").toLowerCase());
    if (!target) { await botSay(chatId, botId, `Бот не найден.`); return; }
    setState(ownerProfileId, { step: "setcommand_command", botId: target.id });
    await botSay(chatId, botId, `Введите команду (например: /start):`);
    return;
  }
  if (state.step === "setcommand_command") {
    const c = cmd.startsWith("/") ? cmd : `/${cmd}`;
    setState(ownerProfileId, { step: "setcommand_desc", botId: state.botId, command: c });
    await botSay(chatId, botId, `Введите описание команды:`);
    return;
  }
  if (state.step === "setcommand_desc") {
    await supabase.from("bot_commands").upsert({
      bot_id: state.botId, command: state.command, description: cmd,
    }, { onConflict: "bot_id,command" });
    setState(ownerProfileId, { step: "idle" });
    await botSay(chatId, botId, `✅ Команда ${state.command} установлена.`);
    return;
  }

  if (state.step === "getlink_pickbot") {
    const target = state.bots.find((b) => b.username.toLowerCase() === cmd.replace(/^@/, "").toLowerCase());
    if (!target) { await botSay(chatId, botId, `Бот не найден.`); return; }
    setState(ownerProfileId, { step: "getlink_link", botId: target.id });
    await botSay(chatId, botId, `Отправьте ссылку для прикрепления к боту:`);
    return;
  }
  if (state.step === "getlink_link") {
    await supabase.from("profiles").update({ bot_link: cmd }).eq("id", state.botId);
    setState(ownerProfileId, { step: "idle" });
    await botSay(chatId, botId, `🔗 Ссылка прикреплена.`);
    return;
  }

  // Top-level commands
  if (cmd === "/start" || cmd === "/help") {
    await botSay(chatId, botId,
`👋 Я — CreatorBot. Помогаю создавать и управлять ботами.

Команды:
/newbot — создать бота
/mybots — список ваших ботов
/deletebot — удалить бота
/revoketoken — обновить API-токен
/setcommand — настроить команды бота
/getlink — прикрепить ссылку к боту`);
    return;
  }

  if (cmd === "/newbot") {
    setState(ownerProfileId, { step: "newbot_name" });
    await botSay(chatId, botId, `Хорошо! Введите отображаемое имя для бота (любое):`);
    return;
  }

  if (cmd === "/mybots") {
    const { data: bots } = await supabase.from("profiles").select("*").eq("bot_owner_id", ownerProfileId);
    if (!bots?.length) { await botSay(chatId, botId, `У вас пока нет ботов. Создайте: /newbot`); return; }
    const list = bots.map((b: any) => `• ${b.display_name} (@${b.username})`).join("\n");
    await botSay(chatId, botId, `Ваши боты (${bots.length}/5):\n\n${list}`);
    return;
  }

  if (cmd === "/deletebot" || cmd === "/revoketoken" || cmd === "/setcommand" || cmd === "/getlink") {
    const { data: bots } = await supabase.from("profiles").select("*").eq("bot_owner_id", ownerProfileId);
    if (!bots?.length) { await botSay(chatId, botId, `У вас нет ботов. Создайте: /newbot`); return; }
    const list = bots.map((b: any) => `@${b.username}`).join(", ");
    if (cmd === "/deletebot") {
      setState(ownerProfileId, { step: "deletebot_pick", bots });
      await botSay(chatId, botId, `Какого бота удалить?\n${list}\n\nОтправьте @никнейм:`);
    } else if (cmd === "/revoketoken") {
      setState(ownerProfileId, { step: "revoketoken_pick", bots });
      await botSay(chatId, botId, `У какого бота обновить токен?\n${list}\n\nОтправьте @никнейм:`);
    } else if (cmd === "/setcommand") {
      setState(ownerProfileId, { step: "setcommand_pickbot", bots });
      await botSay(chatId, botId, `Для какого бота настроить команду?\n${list}`);
    } else {
      setState(ownerProfileId, { step: "getlink_pickbot", bots });
      await botSay(chatId, botId, `К какому боту прикрепить ссылку?\n${list}`);
    }
    return;
  }

  await botSay(chatId, botId, `Неизвестная команда. Отправьте /help для списка.`);
}
