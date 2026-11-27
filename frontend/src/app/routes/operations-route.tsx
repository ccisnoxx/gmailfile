import { Navigate, useLocation } from 'react-router-dom';
import {
  resolveAppHref,
  resolveOperationsDestination,
  type OperationsRouteTab,
} from '@/app/navigation';

function parseOperationsTab(
  raw: string | null,
): OperationsRouteTab | undefined {
  if (
    raw === 'audit' ||
    raw === 'sessions' ||
    raw === 'status' ||
    raw === 'export' ||
    raw === 'import'
  ) {
    return raw;
  }
  return undefined;
}

export default function OperationsRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = parseOperationsTab(params.get('tab'));
  const target = resolveAppHref(
    resolveOperationsDestination(tab, location.search),
  );
  return <Navigate to={target} replace />;
}
