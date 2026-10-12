import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AclService } from './acl.service';

@Module({
  imports: [PrismaModule, OrganizationsModule],
  providers: [AclService],
  exports: [AclService],
})
export class AclModule {}
