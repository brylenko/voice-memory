import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { DeviceAuthGuard } from './device-auth.guard';
import {
  REQUEST_UPLOAD_USE_CASE,
  RequestUploadUseCase,
} from '../../../application/ports/inbound/request-upload.use-case';
import {
  COMPLETE_UPLOAD_USE_CASE,
  CompleteUploadUseCase,
} from '../../../application/ports/inbound/complete-upload.use-case';
import {
  InsufficientBalanceError,
  TrackAlreadyProcessingError,
  TrackNotFoundError,
  TrackOwnershipError,
} from '../../../application/errors';
import { UserEntity } from '../../../../user/user.entity';

class RequestUploadDto {
  @IsInt()
  @IsPositive()
  durationSeconds: number;

  @IsString()
  @IsNotEmpty()
  fileName: string;
}

class CompleteUploadDto {
  @IsString()
  @IsNotEmpty()
  trackId: string;
}

/**
 * Two-phase, direct-to-storage upload for the HTTP device channel. Neither
 * endpoint ever touches audio bytes — the device PUTs those straight to
 * storage using the URL from phase 1. That's what lets this scale to many
 * concurrent uploads without our server buffering files in memory or paying
 * egress to relay them: see AudioStoragePort.createUploadUrl().
 */
@Controller('audio')
export class UploadController {
  constructor(
    @Inject(REQUEST_UPLOAD_USE_CASE) private readonly requestUpload: RequestUploadUseCase,
    @Inject(COMPLETE_UPLOAD_USE_CASE) private readonly completeUpload: CompleteUploadUseCase,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  private async resolveUserId(deviceSerial: string): Promise<string> {
    let user = await this.userRepo.findOneBy({ deviceId: deviceSerial });
    if (!user) {
      user = await this.userRepo.save(this.userRepo.create({ deviceId: deviceSerial }));
    }
    return user.id;
  }

  /** Phase 1: authorize + get a URL to PUT the file to directly. */
  @Post('upload-url')
  @UseGuards(DeviceAuthGuard)
  @HttpCode(HttpStatus.OK)
  async requestUploadUrl(
    @Body() dto: RequestUploadDto,
    @Req() req: Request & { deviceSerial: string },
  ) {
    const userId = await this.resolveUserId(req.deviceSerial);
    try {
      return await this.requestUpload.execute({
        userId,
        channel: 'iot-device',
        durationSeconds: dto.durationSeconds,
        suggestedFileName: dto.fileName,
      });
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  /** Phase 2: device calls this once its direct PUT to storage has finished. */
  @Post('upload-complete')
  @UseGuards(DeviceAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async completeUploadEndpoint(
    @Body() dto: CompleteUploadDto,
    @Req() req: Request & { deviceSerial: string },
  ) {
    const userId = await this.resolveUserId(req.deviceSerial);
    try {
      const result = await this.completeUpload.execute({ trackId: dto.trackId, userId });
      return { ...result, message: 'Upload accepted, processing started' };
    } catch (error) {
      if (error instanceof TrackNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof TrackOwnershipError) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof TrackAlreadyProcessingError) {
        // Idempotent: device retried upload-complete — acknowledge without creating duplicate job
        return { message: error.message };
      }
      throw error;
    }
  }
}
