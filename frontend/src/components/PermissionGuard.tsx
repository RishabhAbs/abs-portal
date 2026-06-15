import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, EntityType } from '../context/AuthContext';

interface PermissionGuardProps {
    children: React.ReactNode;
    entity?: EntityType | EntityType[];
    adminOnly?: boolean;
}

const PermissionGuard: React.FC<PermissionGuardProps> = ({ children, entity, adminOnly }) => {
    const { canView, isAdmin } = useAuth();

    // When both adminOnly and entity are set, allow access if EITHER condition is met
    if (adminOnly && entity) {
        if (isAdmin()) return <>{children}</>;
        const entities = Array.isArray(entity) ? entity : [entity];
        const hasAccess = entities.some(e => canView(e));
        if (!hasAccess) return <Navigate to="/" replace />;
        return <>{children}</>;
    }

    if (adminOnly && !isAdmin()) {
        return <Navigate to="/" replace />;
    }

    if (entity) {
        const entities = Array.isArray(entity) ? entity : [entity];
        const hasAccess = entities.some(e => canView(e));
        if (!hasAccess) {
            return <Navigate to="/" replace />;
        }
    }

    return <>{children}</>;
};

export default PermissionGuard;
