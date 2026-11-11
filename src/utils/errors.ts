/** 权限不足时的统一提示文案 */
export const PERMISSION_HINT =
  '你对当前数据表或部分字段没有权限，请联系多维表格管理员开通后重试';

/** 权限不足错误的常见特征（不同宿主 / SDK 返回的措辞不同） */
const PERMISSION_PATTERNS = [
  /permission/i,
  /无权限/,
  /没有权限/,
  /权限不足/,
  /not\s+authori[sz]ed/i,
  /unauthori[sz]ed/i,
  /forbidden/i,
  /access\s+denied/i,
  /\b403\b/,
];

/** 从任意错误对象中提取可读信息 */
export function getErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || '';
  if (typeof err === 'object') {
    const anyErr = err as { message?: unknown; msg?: unknown; code?: unknown };
    if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message;
    if (typeof anyErr.msg === 'string' && anyErr.msg) return anyErr.msg;
    if (anyErr.code !== undefined) return `错误码：${String(anyErr.code)}`;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** 判断是否为权限相关错误 */
export function isPermissionError(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return PERMISSION_PATTERNS.some((re) => re.test(msg));
}

/**
 * 转成面向用户的提示：权限错误统一为可读文案，
 * 其余错误优先展示原始信息，取不到时用 fallback。
 */
export function describeError(err: unknown, fallback: string): string {
  if (isPermissionError(err)) return PERMISSION_HINT;
  const msg = getErrorMessage(err);
  return msg || fallback;
}
