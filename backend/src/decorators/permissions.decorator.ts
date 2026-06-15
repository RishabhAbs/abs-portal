import { SetMetadata } from '@nestjs/common';
import { UserPermissions } from '../services/users.service';

export const PERMISSIONS_KEY = 'permissions';

export interface RequiredPermission {
  entity: keyof UserPermissions;
  action: string;
}

export const RequirePermission = (entity: keyof UserPermissions, action: string) =>
  SetMetadata(PERMISSIONS_KEY, { entity, action });

export const RequireAnyPermission = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
