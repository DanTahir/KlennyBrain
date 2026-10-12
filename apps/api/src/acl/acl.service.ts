import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DirectoryPerson, OrgRole } from '@prisma/client';
import type { PersonaDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';

export const ADMIN_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

/** Who is asking, and with which HydraDB ACL. Always resolved server-side. */
export interface BrainIdentity {
  userId: string;
  organizationId: string;
  /** The signed-in user's email. */
  email: string;
  role: OrgRole;
  /** Directory entry of the signed-in user, if any. */
  person: PersonaDto | null;
  /** Set when an OWNER/ADMIN asks as someone else. */
  viewAs: PersonaDto | null;
  /** Email whose permissions apply (the view-as target or the user). */
  effectiveEmail: string;
  /** ACL sent to HydraDB: effective email plus directory groups. */
  acl: string[];
}

@Injectable()
export class AclService {
  private readonly logger = new Logger(AclService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /** Lowercased email first, then unique non-empty groups. */
  static buildAcl(email: string, groups: string[] = []): string[] {
    const acl = new Set<string>();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) acl.add(normalizedEmail);
    for (const group of groups) {
      const value = group?.trim();
      if (value) acl.add(value);
    }
    return [...acl];
  }

  static canViewAs(role: OrgRole): boolean {
    return ADMIN_ROLES.includes(role);
  }

  static toPersona(person: DirectoryPerson): PersonaDto {
    return {
      email: person.email,
      name: person.name,
      title: person.title,
      department: person.department,
      groups: person.groups,
    };
  }

  /** Membership check; optionally restricted to a set of roles. */
  async requireRole(userId: string, organizationId: string, allowed?: OrgRole[]): Promise<OrgRole> {
    const role = await this.organizationsService.getUserRoleInOrganization(userId, organizationId);
    if (!role) throw new ForbiddenException('You are not a member of this organization');
    if (allowed && !allowed.includes(role)) {
      throw new ForbiddenException('This action requires an organization owner or admin');
    }
    return role;
  }

  async resolveIdentity(userId: string, organizationId: string, viewAsEmail?: string | null): Promise<BrainIdentity> {
    const role = await this.requireRole(userId, organizationId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new ForbiddenException('Unknown user');

    const email = user.email.trim().toLowerCase();
    const self = await this.findPerson(organizationId, email);
    const selfPersona = self ? AclService.toPersona(self) : null;

    const target = viewAsEmail?.trim().toLowerCase();
    if (target && target !== email) {
      if (!AclService.canViewAs(role)) {
        throw new ForbiddenException('Only organization owners and admins can ask as another person');
      }
      const person = await this.findPerson(organizationId, target);
      if (!person) throw new NotFoundException('That person is not in this organization directory');
      const viewAs = AclService.toPersona(person);
      this.logger.log(`view-as: user ${userId} is asking as ${viewAs.email} in org ${organizationId}`);
      return {
        userId,
        organizationId,
        email,
        role,
        person: selfPersona,
        viewAs,
        effectiveEmail: viewAs.email.toLowerCase(),
        acl: AclService.buildAcl(viewAs.email, viewAs.groups),
      };
    }

    return {
      userId,
      organizationId,
      email,
      role,
      person: selfPersona,
      viewAs: null,
      effectiveEmail: email,
      acl: AclService.buildAcl(email, selfPersona?.groups ?? []),
    };
  }

  /** ACL for a non-app identity (e.g. a Slack user resolved by email). */
  async aclForEmail(organizationId: string, email: string): Promise<{ acl: string[]; person: PersonaDto | null }> {
    const person = await this.findPerson(organizationId, email.trim().toLowerCase());
    const persona = person ? AclService.toPersona(person) : null;
    return { acl: AclService.buildAcl(email, persona?.groups ?? []), person: persona };
  }

  async listPersonas(organizationId: string): Promise<PersonaDto[]> {
    const people = await this.prisma.directoryPerson.findMany({
      where: { organizationId },
      orderBy: [{ department: 'asc' }, { name: 'asc' }],
    });
    return people.map((person) => AclService.toPersona(person));
  }

  private findPerson(organizationId: string, email: string) {
    return this.prisma.directoryPerson.findUnique({
      where: { organizationId_email: { organizationId, email } },
    });
  }
}
