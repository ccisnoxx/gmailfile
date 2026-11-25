import { useCallback, useEffect, useRef, useState } from 'react';
import { csvCommit, csvPreview } from '@/api/generated';
import type {
  CsvIssue,
  CsvOptions,
  CsvPreview,
  SessionResponse,
} from '@/api/generated';
import { failureText } from './shared';

export const csvFieldLabels = {
  account_no: '账号编号',
  gmail_email: 'Gmail 地址',
  password: '密码（不预览）',
  registered_at: '注册时间',
  recovery_email: '外部辅助邮箱',
  recovery_account: '关联已有账号',
  phone: '手机号（不预览）',
  status: '状态代码',
  two_factor_status: '二步验证代码',
  last_login_at: '最后登录',
  last_verified_at: '最后验证',
  password_changed_at: '密码修改时间',
  purpose: '用途',
  tags: '标签（|分隔）',
  notes: '备注（不预览）',
} as const;

export type CsvFieldKey = keyof typeof csvFieldLabels;

export function useCsvImport({
  session,
  onFailure,
}: {
  session: SessionResponse;
  onFailure: (error: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvOptions['mapping']>({});
  const [strategy, setStrategy] = useState<CsvOptions['strategy']>('skip');
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);

  const clear = useCallback((resetInput = true) => {
    generation.current++;
    running.current = false;
    setBusy(false);
    setFile(null);
    setPreview(null);
    setMapping({});
    setIssues([]);
    setConfirmed(false);
    if (resetInput && inputRef.current) inputRef.current.value = '';
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        clear();
        setMessage('导入内容已清除，请重新选择文件。');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [clear]);

  const selectFile = useCallback(
    (next: File | undefined) => {
      clear(false);
      setMessage('');
      if (!next) return;
      if (
        next.size > 10 * 1024 * 1024 ||
        !next.name.toLowerCase().endsWith('.csv')
      ) {
        setMessage('请选择不超过10 MiB的.csv文件。');
      } else {
        setFile(next);
      }
    },
    [clear],
  );

  const changeStrategy = useCallback((next: CsvOptions['strategy']) => {
    setStrategy(next);
    setPreview(null);
    setConfirmed(false);
  }, []);

  const updateMapping = useCallback((field: CsvFieldKey, rawValue: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (rawValue === '') delete next[field];
      else next[field] = Number(rawValue);
      return next;
    });
    setPreview((current) =>
      current ? { ...current, receipt_id: null } : current,
    );
    setConfirmed(false);
  }, []);

  const analyze = useCallback(
    async (custom = false) => {
      if (!file || running.current) return;
      running.current = true;
      setBusy(true);
      setMessage('');
      setIssues([]);
      setPreview(null);
      setConfirmed(false);
      const ticket = generation.current;
      try {
        const result = await csvPreview({
          body: file,
          query: {
            options: JSON.stringify({
              strategy,
              ...(custom ? { mapping } : {}),
            }),
          },
          headers: { 'X-CSRF-Token': session.csrf_token },
          throwOnError: true,
        });
        if (ticket !== generation.current || document.hidden) return;
        setPreview(result.data);
        setMapping(result.data.mapping);
        setIssues(result.data.errors);
      } catch (error) {
        if (ticket === generation.current) {
          setMessage(failureText(error));
          onFailure(error);
        }
      } finally {
        if (ticket === generation.current) {
          setBusy(false);
          running.current = false;
        }
      }
    },
    [file, mapping, onFailure, session.csrf_token, strategy],
  );

  const submit = useCallback(async () => {
    if (!file || !preview?.receipt_id || !confirmed || running.current) return;
    const content = file;
    const receipt = preview.receipt_id;
    const ticket = generation.current;
    running.current = true;
    setBusy(true);
    setPreview(null);
    setFile(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = '';
    try {
      const result = await csvCommit({
        body: content,
        query: { receipt_id: receipt },
        headers: { 'X-CSRF-Token': session.csrf_token },
      });
      if (ticket !== generation.current || document.hidden) return;
      if (result.data?.status === 'committed') {
        setMessage(
          `已提交：新增 ${result.data.created}，更新 ${result.data.updated}，跳过 ${result.data.skipped}。`,
        );
        setIssues([]);
      } else if (result.error && 'status' in result.error) {
        setIssues(result.error.errors ?? []);
        setMessage('校验或并发冲突，整批未提交。请重新选择文件并预览。');
      } else {
        setMessage(failureText(result.error, true));
        onFailure(result.error);
      }
    } catch (error) {
      if (ticket === generation.current) {
        setMessage(failureText(error, true));
        onFailure(error);
      }
    } finally {
      if (ticket === generation.current) {
        setBusy(false);
        running.current = false;
      }
    }
  }, [confirmed, file, onFailure, preview, session.csrf_token]);

  const resetWithNotice = useCallback(() => {
    clear();
    setMessage('导入内容已清除。');
  }, [clear]);

  return {
    file,
    preview,
    mapping,
    strategy,
    issues,
    message,
    busy,
    confirmed,
    inputRef,
    setConfirmed,
    selectFile,
    changeStrategy,
    updateMapping,
    analyze,
    submit,
    resetWithNotice,
  };
}
