import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  meetLink?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  private get clientId(): string {
    return this.config.get<string>('google.clientId') ?? '';
  }

  private get clientSecret(): string {
    return this.config.get<string>('google.clientSecret') ?? '';
  }

  private get redirectUri(): string {
    return this.config.get<string>('google.redirectUri') ?? '';
  }

  constructor(private readonly config: ConfigService) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    if (!data.access_token) throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiry: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = (await res.json()) as { access_token: string; expires_in: number };
    if (!data.access_token) throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
    return {
      accessToken: data.access_token,
      refreshToken,
      expiry: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async getUpcomingEvents(accessToken: string, maxResults = 10): Promise<CalendarEvent[]> {
    const now = new Date().toISOString();
    const params = new URLSearchParams({
      timeMin: now,
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
        conferenceData?: { entryPoints?: Array<{ uri: string; entryPointType: string }> };
      }>;
    };
    if (!data.items) {
      this.logger.warn(`Calendar API unexpected response: ${JSON.stringify(data)}`);
      return [];
    }
    return data.items.map((e) => ({
      id: e.id,
      title: e.summary ?? '(untitled)',
      start: new Date(e.start.dateTime ?? e.start.date ?? now),
      end: new Date(e.end.dateTime ?? e.end.date ?? now),
      meetLink: e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri,
    }));
  }
}
