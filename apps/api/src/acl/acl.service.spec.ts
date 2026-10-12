import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { AclService } from './acl.service';

describe('AclService', () => {
  const organizationId = 'org-1';
  const directory: Record<string, unknown> = {
    'elena@northwind.dev': {
      email: 'elena@northwind.dev',
      name: 'Elena Park',
      title: 'CEO & Co-founder',
      department: 'exec',
      groups: ['group:slack:leadership', 'group:dept:exec'],
    },
    'ollie@northwind.dev': {
      email: 'ollie@northwind.dev',
      name: 'Ollie Brooks',
      title: 'Engineering Intern',
      department: 'engineering',
      groups: ['group:dept:engineering'],
    },
  };

  function buildService(role: OrgRole | null, userEmail = 'elena@northwind.dev') {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ email: userEmail }) },
      directoryPerson: {
        findUnique: jest.fn(({ where }: { where: { organizationId_email: { email: string } } }) =>
          Promise.resolve(directory[where.organizationId_email.email] ?? null),
        ),
      },
    };
    const organizationsService = { getUserRoleInOrganization: jest.fn().mockResolvedValue(role) };
    return new AclService(prisma as never, organizationsService as never);
  }

  describe('buildAcl', () => {
    it('lowercases the email and de-duplicates groups', () => {
      // Arrange
      const inputEmail = ' Elena@Northwind.dev ';
      const inputGroups = ['group:slack:leadership', 'group:slack:leadership', '  ', 'group:dept:exec'];

      // Act
      const actualAcl = AclService.buildAcl(inputEmail, inputGroups);

      // Assert
      expect(actualAcl).toEqual(['elena@northwind.dev', 'group:slack:leadership', 'group:dept:exec']);
    });

    it('always includes the email so the ACL is never empty', () => {
      // Arrange
      const inputEmail = 'guest@example.com';

      // Act
      const actualAcl = AclService.buildAcl(inputEmail);

      // Assert
      expect(actualAcl).toEqual(['guest@example.com']);
    });
  });

  describe('resolveIdentity', () => {
    it('uses the signed-in person groups by default', async () => {
      // Arrange
      const service = buildService(OrgRole.OWNER);

      // Act
      const actualIdentity = await service.resolveIdentity('user-1', organizationId);

      // Assert
      expect(actualIdentity.viewAs).toBeNull();
      expect(actualIdentity.acl).toEqual(['elena@northwind.dev', 'group:slack:leadership', 'group:dept:exec']);
    });

    it('lets an owner ask as the intern with only the intern permissions', async () => {
      // Arrange
      const service = buildService(OrgRole.OWNER);

      // Act
      const actualIdentity = await service.resolveIdentity('user-1', organizationId, 'Ollie@northwind.dev');

      // Assert
      expect(actualIdentity.viewAs?.email).toBe('ollie@northwind.dev');
      expect(actualIdentity.effectiveEmail).toBe('ollie@northwind.dev');
      expect(actualIdentity.acl).toEqual(['ollie@northwind.dev', 'group:dept:engineering']);
      expect(actualIdentity.acl).not.toContain('group:slack:leadership');
    });

    it('forbids members from asking as someone else', async () => {
      // Arrange
      const service = buildService(OrgRole.MEMBER, 'ollie@northwind.dev');

      // Act
      const actualPromise = service.resolveIdentity('user-2', organizationId, 'elena@northwind.dev');

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('treats view-as of yourself as a normal request', async () => {
      // Arrange
      const service = buildService(OrgRole.MEMBER, 'ollie@northwind.dev');

      // Act
      const actualIdentity = await service.resolveIdentity('user-2', organizationId, 'ollie@northwind.dev');

      // Assert
      expect(actualIdentity.viewAs).toBeNull();
      expect(actualIdentity.acl).toEqual(['ollie@northwind.dev', 'group:dept:engineering']);
    });

    it('rejects non-members', async () => {
      // Arrange
      const service = buildService(null);

      // Act
      const actualPromise = service.resolveIdentity('stranger', organizationId);

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects view-as targets outside the directory', async () => {
      // Arrange
      const service = buildService(OrgRole.ADMIN);

      // Act
      const actualPromise = service.resolveIdentity('user-1', organizationId, 'nobody@northwind.dev');

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('requireRole', () => {
    it('rejects members for admin-only actions', async () => {
      // Arrange
      const service = buildService(OrgRole.MEMBER);

      // Act
      const actualPromise = service.requireRole('user-2', organizationId, [OrgRole.OWNER, OrgRole.ADMIN]);

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
