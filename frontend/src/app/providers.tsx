import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import { DEFAULT_QUERY_CLIENT_OPTIONS } from '@/lib/query-cache-policy';

export function Providers({ children }: PropsWithChildren) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: DEFAULT_QUERY_CLIENT_OPTIONS,
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
