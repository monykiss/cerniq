import { OrganizationsController } from './organizations.controller';

describe('OrganizationsController', () => {
  let controller: OrganizationsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      addMember: jest.fn(),
      removeMember: jest.fn(),
      updateMemberRole: jest.fn(),
    };
    controller = new OrganizationsController(mockService);
  });

  // ── create ────────────────────────────────────────────────────

  describe('create', () => {
    it('calls service.create with dto and userId from request', async () => {
      const dto = { name: 'Test Org', slug: 'test-org' };
      const req = { user: { userId: 'user-1' } };
      mockService.create.mockResolvedValue({ id: 'org-1', ...dto });

      const result = await controller.create(dto, req);

      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
      expect(result.id).toBe('org-1');
    });

    it('passes description when provided', async () => {
      const dto = { name: 'Org', slug: 'org', description: 'A description' };
      const req = { user: { userId: 'user-1' } };
      mockService.create.mockResolvedValue({ id: 'org-2' });

      await controller.create(dto, req);
      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'A description' }),
        'user-1',
      );
    });
  });

  // ── findAll ───────────────────────────────────────────────────

  describe('findAll', () => {
    it('calls service.findAll with userId from request', async () => {
      const req = { user: { userId: 'user-1' } };
      mockService.findAll.mockResolvedValue([{ id: 'org-1' }]);

      const result = await controller.findAll(req);

      expect(mockService.findAll).toHaveBeenCalledWith('user-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── findOne ───────────────────────────────────────────────────

  describe('findOne', () => {
    it('calls service.findOne with id and userId', async () => {
      const req = { user: { userId: 'user-1' } };
      mockService.findOne.mockResolvedValue({ id: 'org-1', name: 'My Org' });

      const result = await controller.findOne('org-1', req);

      expect(mockService.findOne).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result.name).toBe('My Org');
    });
  });

  // ── addMember ─────────────────────────────────────────────────

  describe('addMember', () => {
    it('calls service.addMember with org id, dto, and requesting userId', async () => {
      const req = { user: { userId: 'admin-1' } };
      const dto = { userId: 'new-user', role: 'MEMBER' };
      mockService.addMember.mockResolvedValue({ id: 'mem-1', role: 'MEMBER' });

      const result = await controller.addMember('org-1', dto, req);

      expect(mockService.addMember).toHaveBeenCalledWith(
        'org-1',
        dto,
        'admin-1',
      );
      expect(result.role).toBe('MEMBER');
    });
  });

  // ── removeMember ──────────────────────────────────────────────

  describe('removeMember', () => {
    it('calls service.removeMember with org id, userId, and requesting userId', async () => {
      const req = { user: { userId: 'admin-1' } };
      mockService.removeMember.mockResolvedValue({
        message: 'Member removed successfully',
      });

      const result = await controller.removeMember('org-1', 'target-user', req);

      expect(mockService.removeMember).toHaveBeenCalledWith(
        'org-1',
        'target-user',
        'admin-1',
      );
      expect(result.message).toBe('Member removed successfully');
    });
  });

  // ── updateMemberRole ──────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('calls service.updateMemberRole with all params', async () => {
      const req = { user: { userId: 'admin-1' } };
      const body = { role: 'ADMIN' };
      mockService.updateMemberRole.mockResolvedValue({
        id: 'mem-1',
        role: 'ADMIN',
      });

      const result = await controller.updateMemberRole(
        'org-1',
        'target-user',
        body as any,
        req,
      );

      expect(mockService.updateMemberRole).toHaveBeenCalledWith(
        'org-1',
        'target-user',
        'ADMIN',
        'admin-1',
      );
      expect(result.role).toBe('ADMIN');
    });
  });
});
