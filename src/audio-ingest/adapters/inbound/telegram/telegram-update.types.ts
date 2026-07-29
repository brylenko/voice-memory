// Minimal shape of the Telegram fields this adapter actually reads.
// (Not the full Bot API type — deliberately narrow, KISS.)
export interface TelegramVoice {
  file_id: string;
  duration: number; // seconds, reported natively by Telegram for voice notes
}

export interface TelegramAudio {
  file_id: string;
  duration: number;
  file_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string };
  chat: { id: number };
  voice?: TelegramVoice;
  audio?: TelegramAudio;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: { message_id: number; chat: { id: number } };
  data?: string; // payload encoded as "action:param"
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
