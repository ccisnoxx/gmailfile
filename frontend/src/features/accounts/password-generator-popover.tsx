import { useCallback, useEffect, useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { RefreshCw, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}?';

function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let val = 0;
  do {
    crypto.getRandomValues(buf);
    val = buf[0];
  } while (val >= limit);
  return val % max;
}

export function generateMemoryPassword(options: {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}): { value: string; entropyBits: number } {
  const pools: string[] = [];
  if (options.lower) pools.push(LOWER);
  if (options.upper) pools.push(UPPER);
  if (options.digits) pools.push(DIGITS);
  if (options.symbols) pools.push(SYMBOLS);
  if (pools.length === 0) pools.push(LOWER, UPPER, DIGITS);

  const combined = pools.join('');
  const length = Math.max(12, Math.min(64, options.length));
  const chars: string[] = [];

  // 确保每个启用字符集至少命中 1 个字符
  for (const pool of pools) {
    if (chars.length < length) {
      chars.push(pool[randomIndex(pool.length)]);
    }
  }
  while (chars.length < length) {
    chars.push(combined[randomIndex(combined.length)]);
  }
  // Fisher-Yates CSPRNG 洗牌
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  const entropyBits = Math.round(length * Math.log2(combined.length));
  return { value: chars.join(''), entropyBits };
}

export function PasswordGeneratorPopover({
  onApply,
  disabled,
}: {
  onApply: (password: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(20);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [generated, setGenerated] = useState<{
    value: string;
    entropyBits: number;
  } | null>(null);

  const regenerate = useCallback(
    (nextOpts?: {
      length?: number;
      upper?: boolean;
      lower?: boolean;
      digits?: boolean;
      symbols?: boolean;
    }) => {
      setGenerated(
        generateMemoryPassword({
          length: nextOpts?.length ?? length,
          upper: nextOpts?.upper ?? upper,
          lower: nextOpts?.lower ?? lower,
          digits: nextOpts?.digits ?? digits,
          symbols: nextOpts?.symbols ?? symbols,
        }),
      );
    },
    [digits, length, lower, symbols, upper],
  );

  // 关闭弹窗或隐藏标签页时立即销毁内存中的候选密码
  useEffect(() => {
    if (!open) {
      setGenerated(null);
      return;
    }
    const onVis = () => {
      if (document.hidden) {
        setGenerated(null);
        setOpen(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      setGenerated(null);
    };
  }, [open]);

  const strengthLabel =
    !generated || generated.entropyBits < 80
      ? '良好'
      : generated.entropyBits < 110
        ? '强'
        : '极强';

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) regenerate();
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-slot="password-generator-trigger"
          className="inline-flex h-6 items-center gap-1 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:brightness-95 disabled:opacity-50"
        >
          <Wand2 className="size-3" aria-hidden="true" />
          <span>生成强密码</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          aria-label="随机密码生成器"
          className="macos-glass-modal z-[70] w-80 space-y-3 rounded-2xl p-3.5 text-xs text-[var(--text-primary)] outline-none"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">纯内存强密码生成（CSPRNG）</span>
            {generated && (
              <span className="rounded-full bg-[var(--badge-green-bg)] px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-[var(--badge-green-text)]">
                ~{generated.entropyBits} bits · {strengthLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <output
              aria-label="生成的候选随机密码"
              className="flex h-9 min-w-0 flex-1 items-center truncate rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 font-mono text-xs select-all"
            >
              {generated?.value ?? ''}
            </output>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="重新生成随机密码"
              onClick={() => regenerate()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <label htmlFor="pwd-gen-len">长度</label>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {length} 位
              </span>
            </div>
            <input
              id="pwd-gen-len"
              type="range"
              min={16}
              max={64}
              value={length}
              onChange={(e) => {
                const nextLen = Number(e.target.value);
                setLength(nextLen);
                regenerate({ length: nextLen });
              }}
              className="w-full accent-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
            {[
              {
                label: '大写 A-Z',
                checked: upper,
                set: (v: boolean) => {
                  if (!v && !lower && !digits && !symbols) return;
                  setUpper(v);
                  regenerate({ upper: v });
                },
              },
              {
                label: '小写 a-z',
                checked: lower,
                set: (v: boolean) => {
                  if (!v && !upper && !digits && !symbols) return;
                  setLower(v);
                  regenerate({ lower: v });
                },
              },
              {
                label: '数字 2-9',
                checked: digits,
                set: (v: boolean) => {
                  if (!v && !upper && !lower && !symbols) return;
                  setDigits(v);
                  regenerate({ digits: v });
                },
              },
              {
                label: '符号 !@#$',
                checked: symbols,
                set: (v: boolean) => {
                  if (!v && !upper && !lower && !digits) return;
                  setSymbols(v);
                  regenerate({ symbols: v });
                },
              },
            ].map((opt) => (
              <label
                key={opt.label}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-[var(--surface-control-hover)]"
              >
                <input
                  type="checkbox"
                  checked={opt.checked}
                  onChange={(e) => opt.set(e.target.checked)}
                  className="size-3.5 rounded accent-[var(--accent)]"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--table-divider)] pt-2.5">
            <span className="text-[10.5px] text-[var(--text-secondary)]">
              不写入剪贴板或缓存
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (generated?.value) {
                  onApply(generated.value);
                }
                setGenerated(null);
                setOpen(false);
              }}
            >
              填入密码框
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
