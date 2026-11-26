import { Navigate, useLocation } from 'react-router-dom';

export default function OperationsRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');

  if (tab === 'audit') {
    return <Navigate to="/settings/audit" replace />;
  }
  if (tab === 'sessions') {
    return <Navigate to="/settings/security" replace />;
  }
  if (tab === 'status') {
    return <Navigate to="/settings/backup" replace />;
  }
  if (tab === 'export') {
    const next = new URLSearchParams(location.search);
    next.set('tab', 'export');
    return <Navigate to={`/transfers/csv?${next.toString()}`} replace />;
  }
  return <Navigate to="/transfers/csv" replace />;
}
