import { Navigate, useLocation } from 'react-router-dom';
import { resolveAppHref } from '@/app/navigation';

export default function SecurityRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const nextSearch = action ? `?action=${encodeURIComponent(action)}` : '';
  return (
    <Navigate
      to={resolveAppHref({
        kind: 'settings',
        section: 'security',
        search: nextSearch,
      })}
      replace
    />
  );
}
