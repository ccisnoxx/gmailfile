import { Navigate, useLocation } from 'react-router-dom';

export default function SecurityRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const nextSearch = action ? `?action=${encodeURIComponent(action)}` : '';
  return <Navigate to={`/settings/security${nextSearch}`} replace />;
}
