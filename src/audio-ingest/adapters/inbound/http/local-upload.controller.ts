import { Controller, NotFoundException, Param, Put, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createWriteStream } from 'fs';
import { join, normalize } from 'path';

/**
 * Dev-only counterpart to S3's presigned PUT — exists purely so
 * LocalDiskStorageAdapter.createUploadUrl() has somewhere real to point to
 * when STORAGE_DRIVER=local. Streams the raw request body straight to disk;
 * no multer/memory buffering. Returns 404 when STORAGE_DRIVER≠local because
 * in that mode the device sends bytes directly to S3 and this endpoint is never
 * referenced in upload URLs.
 */
@Controller('audio/local-upload')
export class LocalUploadController {
  constructor(private readonly config: ConfigService) {}

  @Put(':userId/:fileName')
  async handleUpload(
    @Param('userId') userId: string,
    @Param('fileName') fileName: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (this.config.get<string>('storageDriver') !== 'local') {
      throw new NotFoundException('Local upload endpoint is not active in this environment');
    }

    const uploadDir = this.config.get<string>('uploadDir') ?? './uploads';
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    const targetPath = normalize(join(uploadDir, safeUserId, safeName));

    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(targetPath);
      req.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
    });

    res.status(200).json({ ok: true });
  }
}
