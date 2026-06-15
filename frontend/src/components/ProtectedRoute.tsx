import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';
import { useData } from '../context/DataContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { isAuthenticated, user, isAdmin, isLoading: authLoading, loadUsers } = useAuth();
  const { loadData, isLoading: dataLoading } = useData();
  const location = useLocation();
  const [dataLoaded, setDataLoaded] = useState(false);

  // Load data when authenticated
  useEffect(() => {
    if (isAuthenticated && !dataLoaded) {
      loadData().then(() => setDataLoaded(true));
      if (user?.role?.toLowerCase() === 'admin') {
        loadUsers();
      }
    }
  }, [isAuthenticated, dataLoaded, loadData, loadUsers, user?.role]);

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show loading while fetching data
  if (dataLoading && !dataLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading data...</p>
        </div>
      </div>
    );
  }

  // Check role-based access if specified
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  // Mandatory 2FA Check
  if (user && !user.is_two_fa_enabled && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

  // Users page is admin only
  if (location.pathname.startsWith('/users') && !isAdmin()) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
