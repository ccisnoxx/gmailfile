import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardSummary, tagsList } from '@/api/generated';
import type { SidebarCounts, SidebarTagItem } from './primary-sidebar';

export function useLiveSidebarData(enabled = true) {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const summaryQuery = useQuery({
    queryKey: ['summary', timezone],
    enabled,
    queryFn: async ({ signal }) =>
      (
        await dashboardSummary({
          query: { timezone },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    enabled,
    queryFn: async ({ signal }) =>
      (await tagsList({ signal, throwOnError: true })).data,
  });

  const counts: SidebarCounts | undefined = useMemo(() => {
    const s = summaryQuery.data;
    if (!s || typeof s.total !== 'number') return undefined;
    return {
      all: s.total,
      normal: s.normal,
      pending: s.pending_verification,
      risk: s.risk ?? s.abnormal,
      disabled: s.disabled ?? 0,
      archived: s.archived ?? 0,
      trash: s.deleted_count ?? 0,
    };
  }, [summaryQuery.data]);

  const tags: SidebarTagItem[] = useMemo(() => {
    const rawTags = Array.isArray(tagsQuery.data) ? tagsQuery.data : [];
    const tagCounts = summaryQuery.data?.tag_counts;
    return rawTags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: tagCounts ? (tagCounts[tag.id] ?? 0) : undefined,
    }));
  }, [summaryQuery.data?.tag_counts, tagsQuery.data]);

  return {
    counts,
    tags,
    summaryQuery,
    tagsQuery,
  };
}
