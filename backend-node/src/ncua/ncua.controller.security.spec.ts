import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NcuaController } from './ncua.controller';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Security spec for the NCUA body-IDOR closure (R3 verify-body-trust
// flagged this in commit 19f103f5). Direct-construction style; mirrors
// agents.controller.security.spec.ts. Locks the structural invariant
// that `importCreditUnion` calls `verifyWorkspaceOwnership(workspaceId)`
// BEFORE `importService.importCreditUnion(...)` runs.
//
// Why this matters: class-level @UseGuards(AuthTenantGuard,
// InstitutionScopeGuard) authenticates but only enforces ownership on
// :institutionId path params. The import route receives workspaceId
// in the body — without an explicit ownership check, any authenticated
// user could POST { charterNumber, workspaceId: <victim-uuid> } and
// write NCUA Form 5300 data into another tenant's workspace.

describe('NcuaController.importCreditUnion (body-IDOR closure)', () => {
  let importService: { importCreditUnion: jest.Mock };
  let apiService: any;
  let fieldMapper: any;
  let scope: {
    verifyWorkspaceOwnership: jest.Mock;
  };
  let controller: NcuaController;

  const validBody = {
    charterNumber: '12345',
    workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };

  const buildReq = (
    overrides: { userId?: string; isPlatformAdmin?: boolean } = {},
  ) => ({
    user: {
      userId: overrides.userId ?? 'user-1',
      access: { isPlatformAdmin: overrides.isPlatformAdmin === true },
    },
  });

  beforeEach(() => {
    importService = {
      importCreditUnion: jest
        .fn()
        .mockResolvedValue({ institutionId: 'inst-1' }),
    };
    apiService = {};
    fieldMapper = {};
    scope = {
      verifyWorkspaceOwnership: jest.fn().mockResolvedValue(undefined),
    };
    controller = new NcuaController(
      importService as any,
      apiService,
      fieldMapper,
      scope as unknown as InstitutionScopeGuard,
    );
  });

  it('calls verifyWorkspaceOwnership BEFORE importService.importCreditUnion (call-order lock)', async () => {
    await controller.importCreditUnion(validBody, buildReq());

    const verifyOrder =
      scope.verifyWorkspaceOwnership.mock.invocationCallOrder[0];
    const importOrder =
      importService.importCreditUnion.mock.invocationCallOrder[0];
    expect(verifyOrder).toBeLessThan(importOrder);

    expect(scope.verifyWorkspaceOwnership).toHaveBeenCalledWith(
      validBody.workspaceId,
      'user-1',
      false,
    );
  });

  it('propagates Forbidden when ownership check denies; never calls importService', async () => {
    scope.verifyWorkspaceOwnership.mockRejectedValue(
      new ForbiddenException('not authorized for this workspace'),
    );
    await expect(
      controller.importCreditUnion(validBody, buildReq()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(importService.importCreditUnion).not.toHaveBeenCalled();
  });

  it('propagates NotFound when the workspace does not exist; never calls importService', async () => {
    scope.verifyWorkspaceOwnership.mockRejectedValue(
      new NotFoundException('workspace not found'),
    );
    await expect(
      controller.importCreditUnion(validBody, buildReq()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(importService.importCreditUnion).not.toHaveBeenCalled();
  });

  it('passes isPlatformAdmin=true to verifyWorkspaceOwnership for platform-admin callers', async () => {
    await controller.importCreditUnion(
      validBody,
      buildReq({ isPlatformAdmin: true }),
    );
    expect(scope.verifyWorkspaceOwnership).toHaveBeenCalledWith(
      validBody.workspaceId,
      'user-1',
      true,
    );
  });

  it('rejects with BadRequest when no authenticated user is present (defense-in-depth)', async () => {
    await expect(
      controller.importCreditUnion(validBody, { user: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scope.verifyWorkspaceOwnership).not.toHaveBeenCalled();
    expect(importService.importCreditUnion).not.toHaveBeenCalled();
  });

  it('rejects malformed body with BadRequest BEFORE running the ownership check', async () => {
    await expect(
      controller.importCreditUnion(
        { charterNumber: '12345' /* missing workspaceId */ },
        buildReq(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scope.verifyWorkspaceOwnership).not.toHaveBeenCalled();
    expect(importService.importCreditUnion).not.toHaveBeenCalled();
  });

  it('reads userId from legacy `id` shape when canonical `userId` is absent', async () => {
    const req = { user: { id: 'legacy-user', access: {} } };
    await controller.importCreditUnion(validBody, req);
    expect(scope.verifyWorkspaceOwnership).toHaveBeenCalledWith(
      validBody.workspaceId,
      'legacy-user',
      false,
    );
  });
});
