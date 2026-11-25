import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=-]+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * 纯 Node.js RFC 6238 TOTP 生成器（SHA-1, 6 位, 30 秒步长）。
 */
export function generateTotpForStep(
  secretBase32: string,
  step: number,
): string {
  const key = decodeBase32(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step), 0);
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function currentTotpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / 30);
}

/**
 * 单调递增步长生成器：利用服务端 valid_window=1（允许 currentStep-1, currentStep, currentStep+1），
 * 在同一 30 秒窗口内可连续生成最多 3 个互不重放的有效验证码，无需人工 sleep。
 */
export class MonotonicTotpGenerator {
  private lastStep: number | null = null;

  constructor(private readonly secretBase32: string) {}

  async nextCode(): Promise<string> {
    while (true) {
      const nowStep = currentTotpStep();
      const targetStep =
        this.lastStep === null
          ? nowStep - 1
          : Math.max(this.lastStep + 1, nowStep - 1);
      if (targetStep <= nowStep + 1) {
        this.lastStep = targetStep;
        return generateTotpForStep(this.secretBase32, targetStep);
      }
      // 极少数场景若 30s 内已消耗全部 3 个窗口步长，仅等待至下一 30s 边界
      const waitMs = (nowStep + 1) * 30_000 - Date.now() + 250;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(250, waitMs)),
      );
    }
  }
}
