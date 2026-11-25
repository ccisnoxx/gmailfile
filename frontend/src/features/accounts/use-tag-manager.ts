import { useCallback, useState } from 'react';
import type { TagResponse } from '@/api/generated';
import { tagsCreate, tagsDelete, tagsPatch } from '@/api/generated';

export function useTagManager({
  headers,
  run,
  onRefresh,
  onCaptureFocus,
}: {
  headers: { 'X-CSRF-Token': string };
  run: (action: () => Promise<void>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCaptureFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<TagResponse | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TagResponse | null>(null);

  const openDialog = useCallback(() => {
    onCaptureFocus();
    setLoaded(true);
    setOpen(true);
  }, [onCaptureFocus]);

  const startRename = useCallback((tag: TagResponse) => {
    setTarget(tag);
    setName(tag.name);
  }, []);

  const cancelRename = useCallback(() => {
    setTarget(null);
    setName('');
  }, []);

  const saveTag = useCallback(() => {
    void run(async () => {
      if (target) {
        await tagsPatch({
          path: { tag_id: target.id },
          body: { name },
          headers,
          throwOnError: true,
        });
      } else {
        await tagsCreate({
          body: { name },
          headers,
          throwOnError: true,
        });
      }
      setName('');
      setTarget(null);
      await onRefresh();
    });
  }, [headers, name, onRefresh, run, target]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    void run(async () => {
      await tagsDelete({
        path: { tag_id: targetId },
        headers,
        throwOnError: true,
      });
      setDeleteTarget(null);
      await onRefresh();
    });
  }, [deleteTarget, headers, onRefresh, run]);

  return {
    open,
    setOpen,
    loaded,
    target,
    name,
    setName,
    deleteTarget,
    setDeleteTarget,
    openDialog,
    startRename,
    cancelRename,
    saveTag,
    confirmDelete,
  };
}
