import { InlineKeyboardMarkup, InputMediaPhoto } from "../types";

export interface TelegramApiResponse<T = any> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export class TelegramApi {
  private baseUrl: string;

  constructor(private token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
      reply_markup?: InlineKeyboardMarkup;
      disable_web_page_preview?: boolean;
    }
  ): Promise<TelegramApiResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parse_mode ?? "HTML",
          reply_markup: options?.reply_markup,
          disable_web_page_preview: options?.disable_web_page_preview ?? false,
        }),
      });

      return await res.json();
    } catch (err: any) {
      return { ok: false, description: err?.message || "Network request failed" };
    }
  }

  async sendMediaGroup(
    chatId: number | string,
    media: InputMediaPhoto[]
  ): Promise<TelegramApiResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/sendMediaGroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          media,
        }),
      });

      return await res.json();
    } catch (err: any) {
      return { ok: false, description: err?.message || "Network request failed" };
    }
  }

  async sendPhoto(
    chatId: number | string,
    photo: string,
    options?: {
      caption?: string;
      parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
      has_spoiler?: boolean;
    }
  ): Promise<TelegramApiResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo,
          caption: options?.caption,
          parse_mode: options?.parse_mode ?? "HTML",
          has_spoiler: options?.has_spoiler,
        }),
      });

      return await res.json();
    } catch (err: any) {
      return { ok: false, description: err?.message || "Network request failed" };
    }
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: {
      parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
      reply_markup?: InlineKeyboardMarkup;
    }
  ): Promise<{ ok: boolean; result?: any; description?: string }> {
    const res = await fetch(`${this.baseUrl}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options?.parse_mode ?? "HTML",
        reply_markup: options?.reply_markup,
      }),
    });

    return await res.json();
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert: boolean = false
  ): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });

    return await res.json();
  }

  async setWebhook(url: string, secretToken?: string): Promise<{ ok: boolean; description?: string }> {
    const res = await fetch(`${this.baseUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
      }),
    });

    return await res.json();
  }

  async deleteMessage(
    chatId: number | string,
    messageId: number
  ): Promise<TelegramApiResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      });

      return await res.json();
    } catch (err: any) {
      return { ok: false, description: err?.message || "Network request failed" };
    }
  }
}
