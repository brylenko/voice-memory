import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { join } from 'path';
import { existsSync } from 'fs';
import express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  if (config.get<string>('env') === 'development') {
    const publicDir = join(__dirname, '..', 'public');
    if (existsSync(publicDir)) {
      app.use('/public', express.static(publicDir));
    }
  }

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  console.log(`plaud-backend listening on port ${port}`);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      console.log(`${signal} received — shutting down gracefully`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap();
