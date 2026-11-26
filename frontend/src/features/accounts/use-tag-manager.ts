import { useCallback, useState } from 'react';
import type { ErrorResponse, TagResponse } from '@/api/generated';
import { tagsCreate, tagsDelete, tagsPatch } from '@/api/generated';

export function useTagManager({
  headers,
  onFailure,
  onRefresh,
  onCaptureFocus,
}: {
  headers: { 'X-CSRF-Token': string };
  onFailure: (error: unknown) => void;
  onRefresh: () => Promise<void>;
  onCaptureFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<TagResponse | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TagResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && busy) return;
      setOpen(next);
      if (!next) {
        setNotice('');
        setTarget(null);
        setName('');
        setDeleteTarget(null);
      }
    },
    [busy],
  );

  const openDialog = useCallback(() => {
    onCaptureFocus();
    setNotice('');
    setLoaded(true);
    setOpen(true);
  }, [onCaptureFocus]);

  const startRename = useCallback((tag: TagResponse) => {
    setNotice('');
    setTarget(tag);
    setName(tag.name);
  }, []);

  const cancelRename = useCallback(() => {
    setNotice('');
    setTarget(null);
    setName('');
  }, []);

  const handleError = useCallback(
    (error: unknown) => {
      const err = error as Partial<ErrorResponse>;
      const code = err?.error?.code;
      setNotice(err?.error?.message ?? '标签操作失败，请稍后重试。');
      if (
        ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code ?? '')
      ) {
        onFailure(error);
      }
    },
    [onFailure],
  );

  const saveTag = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice('请输入非空标签名称。');
      return;
    }
    if (busy) return;
    setBusy(true);
    setNotice('');
    void (async () => {
      try {
        if (target) {
          await tagsPatch({
            path: { tag_id: target.id },
            body: { name: trimmed },
            headers,
            throwOnError: true,
          });
          setNotice(`标签已重命名为“${trimmed}”。`);
        } else {
          await tagsCreate({
            body: { name: trimmed },
            headers,
            throwOnError: true,
          });
          setNotice(`已添加标签“${trimmed}”。`);
        }
        setName('');
        setTarget(null);
        await onRefresh();
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, handleError, headers, name, onRefresh, target]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget || busy) return;
    const targetId = deleteTarget.id;
    const targetName = deleteTarget.name;
    setBusy(true);
    setNotice('');
    void (async () => {
      try {
        await tagsDelete({
          path: { tag_id: targetId },
          headers,
          throwOnError: true,
        });
        setDeleteTarget(null);
        if (target?.id === targetId) {
          setTarget(null);
          setName('');
        }
        setNotice(`已删除标签“${targetName}”。`);
        await onRefresh();
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, deleteTarget, handleError, headers, onRefresh, target?.id]);

  return {
    open,
    setOpen: handleOpenChange,
    loaded,
    target,
    name,
    setName: (value: string) => {
      setName(value);
      if (notice) setNotice('');
    },
    deleteTarget,
    setDeleteTarget: (value: TagResponse | null) => {
      if (!busy) {
        setDeleteTarget(value);
        if (value) setNotice('');
      }
    },
    busy,
    notice,
    openDialog,
    startRename,
    cancelRename,
    saveTag,
    confirmDelete,
  };
}
