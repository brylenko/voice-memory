import { Controller, Param, Put, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createWriteStream } from 'fs';
import { join, normalize } from 'path';

/**
 * Dev-only counterpart to S3's presigned PUT — exists purely so
 * LocalDiskStorageAdapter.createUploadUrl() has somewhere real to point to
 * when STORAGE_DRIVER=local. Streams the raw request body straight to disk;
 * no multer/memory buffering, same "don't hold the whole file in RAM" property
 * the S3 path gets for free. Irrelevant in production (STORAGE_DRIVER=s3).
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
