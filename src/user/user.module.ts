import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { DeviceUserResolver } from './device-user.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [DeviceUserResolver],
  exports: [DeviceUserResolver],
})
export class UserModule {}
