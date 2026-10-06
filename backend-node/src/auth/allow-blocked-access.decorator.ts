import { SetMetadata } from '@nestjs/common';

export const ALLOW_BLOCKED_ACCESS_KEY = 'allow_blocked_access';

export const AllowBlockedAccess = () =>
  SetMetadata(ALLOW_BLOCKED_ACCESS_KEY, true);
