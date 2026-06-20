import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, RequiredPermission } from '../decorators/permissions.decorator';
import { User } from '../services/users.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission | RequiredPermission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermission) {
      return true; // No permission required
    }

    const { user }: { user: User } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Admin / superadmin bypass
    const role = user.role?.toLowerCase();
    if (role === 'admin' || role === 'superadmin') {
      return true;
    }

    // Check permission
    const permissionsToCheck = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    
    const hasPermission = permissionsToCheck.some(req => {
      const { entity, action } = req;
      return (user.permissions[entity] as any)?.[action];
    });

    if (!hasPermission) {
      throw new ForbiddenException(`You do not have permission to perform this action`);
    }

    return true;
  }
}
