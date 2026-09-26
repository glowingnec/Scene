export type BooruSource = "danbooru" | "yandere";
export type RatingFilter = "sfw" | "nsfw" | "all";

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  OWNER_USERNAME?: string;
  OWNER_CHAT_ID?: string;
  DEFAULT_SOURCE?: string;
  DEFAULT_RATING?: string;
  DEFAULT_LIMIT?: string;
  SECRET_TOKEN?: string;
  DANBOORU_LOGIN?: string;
  DANBOORU_API_KEY?: string;
  BOORU_KV?: KVNamespace;
}

export interface BooruPost {
  id: number | string;
  source: BooruSource;
  imageUrl: string;
  postUrl: string;
  rating: string;
  isNsfw: boolean;
  tags: string[];
  artist?: string;
  score: number;
}

export interface BotSettings {
  source: BooruSource;
  rating: RatingFilter;
  limit: number;
  ownerChatId?: number;
  subscribedChatIds: number[];
  spoilerNsfw: boolean;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InputMediaPhoto {
  type: "photo";
  media: string;
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  has_spoiler?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}
