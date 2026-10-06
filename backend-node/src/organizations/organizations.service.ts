import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MemberRole } from '@prisma/client';

export interface CreateOrganizationDto {
  name: string;
  slug: string;
  description?: string;
}

export interface AddMemberDto {
  userId: string;
  role: MemberRole;
}

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateOrganizationDto, creatorUserId: string) {
    // Check if slug is already taken
    const existing = await this.prisma.organization.findUnique({
      where: { slug: data.slug },
    });

    if (existing) {
      throw new ConflictException('Organization slug already exists');
    }

    // Create organization and add creator as admin
    const organization = await this.prisma.organization.create({
      data: {
        ...data,
        members: {
          create: {
            userId: creatorUserId,
            role: 'ADMIN',
          },
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    return organization;
  }

  async findAll(userId: string) {
    return this.prisma.organization.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
        _count: {
          select: {
            expenses: true,
          },
        },
      },
      take: 100,
    });
  }

  async findOne(id: string, userId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
        expenses: {
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Check if user is a member
    const isMember = organization.members.some((m: any) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    return organization;
  }

  async addMember(orgId: string, data: AddMemberDto, requestingUserId: string) {
    // Check if requesting user is an admin
    const requester = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: requestingUserId,
        },
      },
    });

    if (!requester || requester.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can add members');
    }

    // Check if user is already a member
    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: data.userId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member');
    }

    return this.prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: data.userId,
        role: data.role,
        invitedBy: requestingUserId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async removeMember(orgId: string, userId: string, requestingUserId: string) {
    // Check if requesting user is an admin
    const requester = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: requestingUserId,
        },
      },
    });

    if (!requester || requester.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can remove members');
    }

    // Prevent removing the last admin
    if (requester.userId === userId) {
      const adminCount = await this.prisma.organizationMember.count({
        where: {
          organizationId: orgId,
          role: 'ADMIN',
        },
      });

      if (adminCount === 1) {
        throw new ForbiddenException('Cannot remove the last admin');
      }
    }

    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
    });

    return { message: 'Member removed successfully' };
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: MemberRole,
    requestingUserId: string,
  ) {
    // Check if requesting user is an admin
    const requester = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: requestingUserId,
        },
      },
    });

    if (!requester || requester.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can update member roles');
    }

    return this.prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
  }
}
