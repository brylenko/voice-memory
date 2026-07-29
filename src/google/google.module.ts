import { Module } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleOAuthController } from './google-oauth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [GoogleOAuthController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleModule {}
