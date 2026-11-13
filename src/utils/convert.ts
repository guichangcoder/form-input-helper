import type { FieldType, IFieldMeta, IOpenUser } from '@lark-base-open/js-sdk';
import { CHECKBOX_FALSE, CHECKBOX_TRUE } from '../constants';
import { formatDate } from './excel';
import { extractOptionNames, findOption, optionsFromMeta } from './options';

/** 转换结果 */
export interface ConvertResult {
  ok: boolean;
  /** true 表示该单元格为空，跳过此字段 */
  skip?: boolean;
  /** SDK 可写值 */
  value?: unknown;
  /** 错误信息（ok=false 时） */
  error?: string;
}

/** 将 Excel 单元格 / 用户输入文本按目标字段类型转换为 SDK 可写值 */
export function convertCellValue(raw: unknown, fieldMeta: IFieldMeta): ConvertResult {
  if (isEmpty(raw)) {
    return { ok: true, skip: true };
  }
  switch (fieldMeta.type as FieldType) {
    case 1: // Text
      return { ok: true, value: raw instanceof Date ? formatDate(raw) : String(raw) };
    case 2: // Number
    case 99002: // Progress
    case 99003: // Currency
    case 99004: // Rating
      return convertNumber(raw);
    case 3: // SingleSelect：只能是数据表中已存在的选项
      return convertSingleSelect(raw, fieldMeta);
    case 4: // MultiSelect：同上
      return convertMultiSelect(raw, fieldMeta);
    case 5: // DateTime
      return convertDateTime(raw);
    case 7: // Checkbox
      return convertCheckbox(raw);
    case 13: // Phone
    case 15: // Url
    case 99005: // Email
      return { ok: true, value: String(raw) };
    case 11: // User（人员）：值须为 {id} 结构，来自人员库选择或 open_id 手动输入
      return convertUser(raw);
    default:
      return { ok: false, error: `暂不支持字段类型「${fieldMeta.type}」` };
  }
}

/** 校验并转换数字类值 */
function convertNumber(raw: unknown): ConvertResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, error: '不是有效数字' };
  }
  const cleaned = String(raw)
    .trim()
    .replace(/,/g, '')
    .replace(/[¥￥$€£]/g, '')
    .replace(/%$/, '');
  const num = Number(cleaned);
  if (cleaned === '' || Number.isNaN(num)) {
    return { ok: false, error: `「${String(raw)}」无法解析为数字` };
  }
  return { ok: true, value: num };
}

/**
 * 单选：校验必须命中数据表现有选项，返回选项名（写入时再解析为 { id, text }）。
 * 未命中直接报错，杜绝「写入时自动新增选项」。
 */
function convertSingleSelect(raw: unknown, fieldMeta: IFieldMeta): ConvertResult {
  const name = String(raw).trim();
  const options = optionsFromMeta(fieldMeta);
  if (!options.length) {
    return { ok: false, error: '该字段在数据表中还没有选项，请先在数据表中添加选项' };
  }
  if (!findOption(options, name)) {
    return { ok: false, error: `「${name}」不是数据表中的现有选项（插件不会自动创建选项）` };
  }
  return { ok: true, value: name };
}

/** 多选：每一项都必须命中现有选项，返回选项名数组 */
function convertMultiSelect(raw: unknown, fieldMeta: IFieldMeta): ConvertResult {
  const options = optionsFromMeta(fieldMeta);
  const names = extractOptionNames(raw, options);
  if (!names.length) return { ok: true, skip: true };
  if (!options.length) {
    return { ok: false, error: '该字段在数据表中还没有选项，请先在数据表中添加选项' };
  }
  const missing = names.filter((n) => !findOption(options, n));
  if (missing.length) {
    return { ok: false, error: `选项「${missing.join('、')}」在数据表中不存在（插件不会自动创建选项）` };
  }
  return { ok: true, value: names };
}

/** 复选框：识别常见的是/否表达 */
function convertCheckbox(raw: unknown): ConvertResult {
  const s = String(raw).trim();
  if (CHECKBOX_TRUE.test(s)) return { ok: true, value: true };
  if (CHECKBOX_FALSE.test(s)) return { ok: true, value: false };
  return { ok: false, error: `「${s}」无法识别为勾选状态（用 是/否、1/0、true/false）` };
}

/** 日期：支持 Date、数字时间戳、常见字符串格式，统一转毫秒时间戳（本地时区） */
function convertDateTime(raw: unknown): ConvertResult {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { ok: false, error: '日期无效' } : { ok: true, value: raw.getTime() };
  }
  if (typeof raw === 'number') {
    // 秒级时间戳(1e10 量级)转为毫秒
    const ts = raw < 1e11 ? raw * 1000 : raw;
    return { ok: true, value: ts };
  }
  const s = String(raw).trim();
  const date = parseDateString(s);
  if (!date) {
    return { ok: false, error: `「${s}」无法解析为日期（支持 2024-01-01、2024/1/1、2024年1月1日、2024-01-01 10:30 等）` };
  }
  return { ok: true, value: date.getTime() };
}

/** 解析常见日期字符串 → 本地时区 Date；失败返回 null */
export function parseDateString(s: string): Date | null {
  if (!s) return null;

  // 1) 标准 ISO 时间（含 T 或时间部分）
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (isoMatch) {
    const [, y, m, d, hh, mm, ss] = isoMatch;
    return new Date(+y, +m - 1, +d, hh ? +hh : 0, mm ? +mm : 0, ss ? +ss : 0);
  }

  // 2) 中文日期 2024年1月1日
  const zhMatch = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (zhMatch) {
    const [, y, m, d] = zhMatch;
    return new Date(+y, +m - 1, +d);
  }

  // 3) 紧凑数字 20240101 / 202401011030
  const compactMatch = s.match(/^(\d{8})(?:(\d{4}))?$/);
  if (compactMatch) {
    const [, ymd, hm] = compactMatch;
    const y = +ymd.slice(0, 4);
    const m = +ymd.slice(4, 6);
    const d = +ymd.slice(6, 8);
    const hh = hm ? +hm.slice(0, 2) : 0;
    const mm = hm ? +hm.slice(2, 4) : 0;
    return new Date(y, m - 1, d, hh, mm);
  }

  // 4) 兜底：交给 Date 解析
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 人员字段：接受 IOpenUser / IOpenUser[] / 单个 open_id 字符串 */
function convertUser(raw: unknown): ConvertResult {
  const normalize = (u: unknown): IOpenUser | null => {
    if (u && typeof u === 'object') {
      const obj = u as IOpenUser;
      if (obj.id) {
        const n: IOpenUser = { id: obj.id };
        if (obj.name) n.name = obj.name;
        if (obj.email) n.email = obj.email;
        return n;
      }
      return null;
    }
    const s = String(u).trim();
    if (/^ou_[0-9a-zA-Z]+$/.test(s)) return { id: s };
    return null;
  };

  const input = Array.isArray(raw) ? raw : [raw];
  const users: IOpenUser[] = [];
  for (const u of input) {
    const n = normalize(u);
    if (n && !users.some((x) => x.id === n.id)) users.push(n);
  }
  if (!users.length) {
    return { ok: false, error: '未识别到有效人员（请从人员列表选择，或输入以 ou_ 开头的 open_id）' };
  }
  return { ok: true, value: users };
}

function isEmpty(raw: unknown): boolean {
  return raw == null || (typeof raw === 'string' && raw.trim() === '');
}
