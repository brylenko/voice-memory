import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { RagService } from './rag.service';
import { AskDto } from './dto/ask.dto';
import { DeviceAuthGuard } from '../audio-ingest/adapters/inbound/http/device-auth.guard';
import { UserEntity } from '../user/user.entity';

@Controller('api/search')
export class SearchController {
  constructor(
    private readonly ragService: RagService,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  @Post('ask')
  @UseGuards(DeviceAuthGuard)
  @HttpCode(HttpStatus.OK)
  async ask(
    @Body() dto: AskDto,
    @Req() req: Request & { deviceSerial: string },
  ) {
    const user = await this.userRepo.findOneBy({ deviceId: req.deviceSerial });
    if (!user) {
      return { answer: 'No recordings found for this device.', sourceChunks: [] };
    }
    return this.ragService.ask(user.id, dto.query);
  }
}
