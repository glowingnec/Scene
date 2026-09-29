export type BooruSource = "yandere";
export type RatingFilter = "sfw" | "nsfw" | "all";
export type DeliveryMode = "top" | "random";

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  OWNER_USERNAME?: string;
  OWNER_CHAT_ID?: string;
  CHANNEL_ID?: string;
  DEFAULT_SOURCE?: string;
  DEFAULT_RATING?: string;
  DEFAULT_LIMIT?: string;
  DEFAULT_MODE?: string;
  DELIVERY_MODE?: string;
  DEFAULT_SPOILER_NSFW?: string;
  SECRET_TOKEN?: string;
}

export interface BooruPost {
  id: number | string;
  source: BooruSource;
  imageUrl: string;
  postUrl: string;
  sourceUrl?: string;
  rating: string;
  isNsfw: boolean;
  tags: string[];
  artist?: string;
  characterTags?: string[];
  copyrightTags?: string[];
  score: number;
}

export interface BotSettings {
  source: BooruSource;
  rating: RatingFilter;
  mode: DeliveryMode;
  limit: number;
  ownerChatId?: number | string;
  subscribedChatIds: (number | string)[];
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
