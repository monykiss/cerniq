import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      organizationMember: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  // ─── create ─────────────────────────────────────────────

  describe('create', () => {
    it('creates an organization with the creator as ADMIN', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue({
        id: 'org-1',
        name: 'Test Org',
        slug: 'test-org',
        members: [{ role: 'ADMIN', userId: 'user-1' }],
      });

      const result = await service.create(
        { name: 'Test Org', slug: 'test-org' },
        'user-1',
      );

      expect(result.name).toBe('Test Org');
      expect(prisma.organization.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'test-org' } }),
      );
      expect(prisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Org',
            slug: 'test-org',
            members: expect.objectContaining({
              create: { userId: 'user-1', role: 'ADMIN' },
            }),
          }),
        }),
      );
    });

    it('includes description when provided', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue({ id: 'org-2' });

      await service.create(
        { name: 'Desc Org', slug: 'desc-org', description: 'A great org' },
        'user-1',
      );

      expect(prisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: 'A great org' }),
        }),
      );
    });

    it('throws ConflictException when slug already exists', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ name: 'Dup', slug: 'existing-slug' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('includes members with user relation in the response', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue({
        id: 'org-3',
        name: 'Inc Org',
        slug: 'inc-org',
        members: [
          { role: 'ADMIN', userId: 'u-1', user: { id: 'u-1', email: 'a@b.c' } },
        ],
      });

      const result = await service.create(
        { name: 'Inc Org', slug: 'inc-org' },
        'u-1',
      );

      expect(prisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            members: expect.objectContaining({
              include: { user: true },
            }),
          }),
        }),
      );
      expect(result.members[0].user.email).toBe('a@b.c');
    });
  });

  // ─── findAll ────────────────────────────────────────────

  describe('findAll', () => {
    it('returns organizations where user is a member', async () => {
      prisma.organization.findMany.mockResolvedValue([
        { id: 'org-1', name: 'Org 1' },
        { id: 'org-2', name: 'Org 2' },
      ]);

      const result = await service.findAll('user-1');
      expect(result).toHaveLength(2);
      expect(prisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { members: { some: { userId: 'user-1' } } },
          take: 100,
        }),
      );
    });

    it('returns empty array when user has no organizations', async () => {
      prisma.organization.findMany.mockResolvedValue([]);
      const result = await service.findAll('user-nobody');
      expect(result).toHaveLength(0);
    });

    it('includes _count of expenses', async () => {
      prisma.organization.findMany.mockResolvedValue([]);
      await service.findAll('user-1');

      expect(prisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: { select: { expenses: true } },
          }),
        }),
      );
    });
  });

  // ─── findOne ────────────────────────────────────────────

  describe('findOne', () => {
    it('returns organization when user is a member', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'My Org',
        members: [{ userId: 'user-1', role: 'ADMIN' }],
        expenses: [],
      });

      const result = await service.findOne('org-1', 'user-1');
      expect(result.name).toBe('My Org');
    });

    it('throws NotFoundException when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.findOne('no-org', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when user is not a member', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Private Org',
        members: [{ userId: 'other-user', role: 'ADMIN' }],
        expenses: [],
      });

      await expect(service.findOne('org-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('includes recent expenses in the response', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        members: [{ userId: 'user-1', role: 'MEMBER' }],
        expenses: [{ id: 'exp-1', amount: 100 }],
      });

      const result = await service.findOne('org-1', 'user-1');
      expect(result.expenses).toHaveLength(1);
      expect(result.expenses[0].id).toBe('exp-1');
    });
  });

  // ─── addMember ──────────────────────────────────────────

  describe('addMember', () => {
    it('adds a member when requester is ADMIN and target is not already a member', async () => {
      prisma.organizationMember.findUnique
        .mockResolvedValueOnce({ id: '1', role: 'ADMIN' })
        .mockResolvedValueOnce(null);
      prisma.organizationMember.create.mockResolvedValue({
        id: 'mem-1',
        role: 'MEMBER',
        userId: 'new-user',
      });

      const result = await service.addMember(
        'org-1',
        { userId: 'new-user', role: 'MEMBER' as any },
        'admin-user',
      );

      expect(result.role).toBe('MEMBER');
      expect(prisma.organizationMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            userId: 'new-user',
            role: 'MEMBER',
            invitedBy: 'admin-user',
          }),
        }),
      );
    });

    it('throws ForbiddenException when requester is not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addMember(
          'org-1',
          { userId: 'new', role: 'MEMBER' as any },
          'unknown-user',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when requester is MEMBER (not ADMIN)', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'MEMBER',
      });

      await expect(
        service.addMember(
          'org-1',
          { userId: 'new', role: 'MEMBER' as any },
          'member-user',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when target is already a member', async () => {
      prisma.organizationMember.findUnique
        .mockResolvedValueOnce({ id: '1', role: 'ADMIN' })
        .mockResolvedValueOnce({ id: '2', role: 'MEMBER' });

      await expect(
        service.addMember(
          'org-1',
          { userId: 'existing', role: 'MEMBER' as any },
          'admin-user',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('includes user select in create response', async () => {
      prisma.organizationMember.findUnique
        .mockResolvedValueOnce({ id: '1', role: 'ADMIN' })
        .mockResolvedValueOnce(null);
      prisma.organizationMember.create.mockResolvedValue({
        id: 'mem-1',
        role: 'ADMIN',
        user: {
          id: 'u-new',
          email: 'new@test.com',
          name: 'New',
          avatarUrl: null,
        },
      });

      const result = await service.addMember(
        'org-1',
        { userId: 'u-new', role: 'ADMIN' as any },
        'admin-user',
      );
      expect(result.user.email).toBe('new@test.com');
    });
  });

  // ─── removeMember ───────────────────────────────────────

  describe('removeMember', () => {
    it('removes a member when requester is ADMIN', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
        userId: 'admin-user',
      });
      prisma.organizationMember.delete.mockResolvedValue({});

      const result = await service.removeMember(
        'org-1',
        'target-user',
        'admin-user',
      );
      expect(result).toEqual({ message: 'Member removed successfully' });
      expect(prisma.organizationMember.delete).toHaveBeenCalledWith({
        where: {
          organizationId_userId: {
            organizationId: 'org-1',
            userId: 'target-user',
          },
        },
      });
    });

    it('throws ForbiddenException when requester is not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.removeMember('org-1', 'target', 'nobody'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when requester is not ADMIN', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'MEMBER',
        userId: 'member-user',
      });

      await expect(
        service.removeMember('org-1', 'target', 'member-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('prevents removing the last admin (self-removal)', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
        userId: 'admin-user',
      });
      prisma.organizationMember.count.mockResolvedValue(1);

      await expect(
        service.removeMember('org-1', 'admin-user', 'admin-user'),
      ).rejects.toThrow('Cannot remove the last admin');
    });

    it('allows admin self-removal when there are multiple admins', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
        userId: 'admin-user',
      });
      prisma.organizationMember.count.mockResolvedValue(2);
      prisma.organizationMember.delete.mockResolvedValue({});

      const result = await service.removeMember(
        'org-1',
        'admin-user',
        'admin-user',
      );
      expect(result).toEqual({ message: 'Member removed successfully' });
    });

    it('does not check admin count when removing a different user', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
        userId: 'admin-user',
      });
      prisma.organizationMember.delete.mockResolvedValue({});

      await service.removeMember('org-1', 'other-user', 'admin-user');
      expect(prisma.organizationMember.count).not.toHaveBeenCalled();
    });
  });

  // ─── updateMemberRole ───────────────────────────────────

  describe('updateMemberRole', () => {
    it('updates role when requester is ADMIN', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
      });
      prisma.organizationMember.update.mockResolvedValue({
        id: 'mem-1',
        role: 'ADMIN',
        userId: 'target-user',
      });

      const result = await service.updateMemberRole(
        'org-1',
        'target-user',
        'ADMIN' as any,
        'admin-user',
      );

      expect(result.role).toBe('ADMIN');
      expect(prisma.organizationMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_userId: {
              organizationId: 'org-1',
              userId: 'target-user',
            },
          },
          data: { role: 'ADMIN' },
        }),
      );
    });

    it('throws ForbiddenException when requester is not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateMemberRole('org-1', 'target', 'ADMIN' as any, 'nobody'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when requester is not ADMIN', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'MEMBER',
      });

      await expect(
        service.updateMemberRole('org-1', 'target', 'ADMIN' as any, 'member'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates role to MEMBER', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
      });
      prisma.organizationMember.update.mockResolvedValue({
        id: 'mem-1',
        role: 'MEMBER',
        userId: 'target-user',
      });

      const result = await service.updateMemberRole(
        'org-1',
        'target-user',
        'MEMBER' as any,
        'admin-user',
      );
      expect(result.role).toBe('MEMBER');
    });

    it('includes user select in update response', async () => {
      prisma.organizationMember.findUnique.mockResolvedValueOnce({
        id: '1',
        role: 'ADMIN',
      });
      prisma.organizationMember.update.mockResolvedValue({
        id: 'mem-1',
        role: 'ADMIN',
        userId: 'target',
        user: { id: 'target', email: 't@test.com', name: 'T', avatarUrl: null },
      });

      await service.updateMemberRole(
        'org-1',
        'target',
        'ADMIN' as any,
        'admin',
      );

      expect(prisma.organizationMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          }),
        }),
      );
    });
  });
});
