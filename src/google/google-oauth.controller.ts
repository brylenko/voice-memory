import { Controller, Get, Query, Logger, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { GoogleCalendarService } from './google-calendar.service';
import { OAuthStateStore } from './oauth-state.store';
import { UserEntity } from '../user/user.entity';

@Controller('auth/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  constructor(
    private readonly calendar: GoogleCalendarService,
    private readonly oauthState: OAuthStateStore,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).send('Error: missing parameters.');
      return;
    }

    // Validate and consume the one-time CSRF state token.
    // consume() deletes the token immediately — replayed callbacks are rejected.
    const userId = this.oauthState.consume(state);
    if (!userId) {
      this.logger.warn(`OAuth callback with invalid/expired state token`);
      res.status(400).send('Invalid or expired authorization request. Please try again.');
      return;
    }

    try {
      const tokens = await this.calendar.exchangeCode(code);
      await this.userRepo.update(userId, {
        googleAccessToken: tokens.accessToken,
        googleRefreshToken: tokens.refreshToken,
        googleTokenExpiry: tokens.expiry,
      });
      this.logger.log(`Google Calendar linked for user ${userId}`);

      res.send(`
        <html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>✅ Google Calendar connected!</h2>
          <p>Return to Telegram — meeting tags will now show your upcoming events.</p>
        </body></html>
      `);
    } catch (err) {
      this.logger.error(`Google OAuth callback failed: ${(err as Error).message}`);
      res.status(500).send('Authorization error. Please try again.');
    }
  }
}
