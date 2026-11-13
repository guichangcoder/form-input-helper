import type { IField, IFieldMeta, ISelectFieldOption } from '@lark-base-open/js-sdk';
import { MULTI_SPLIT_REGEX } from '../constants';

/**
 * 单选/多选字段的选项（只读）。
 *
 * 重要：插件只「读取现有选项并选择」，绝不新增/修改/删除数据表的选项。
 * SDK 内部的 select 字段 transform 在值不完全匹配现有选项时会自动新增选项并写回字段配置，
 * 因此写入时必须传入 { id, text } 结构（多选为 [{ id, text }]）来短路该行为。
 */
export interface SelectOption {
  id: string;
  name: string;
}

/** 从字段元信息读取选项（可能为打开插件时的快照） */
export function optionsFromMeta(meta: IFieldMeta | null | undefined): SelectOption[] {
  const opts = (meta?.property as { options?: Array<{ id?: string; name?: string }> } | null)?.options;
  if (!Array.isArray(opts)) return [];
  return opts
    .filter((o): o is { id?: string; name: string } => Boolean(o) && typeof o.name === 'string')
    .map((o) => ({ id: String(o.id ?? ''), name: o.name }));
}

/** 实时读取单选/多选字段的现有选项（优先 RPC 最新值，失败回退元信息快照） */
export async function fetchSelectOptions(
  field: IField,
  fallbackMeta?: IFieldMeta | null,
): Promise<SelectOption[]> {
  const selectField = field as unknown as { getOptions?: () => Promise<ISelectFieldOption[]> };
  try {
    const opts = await selectField.getOptions?.();
    if (Array.isArray(opts)) {
      return opts
        .map((o) => ({ id: String(o?.id ?? ''), name: String(o?.name ?? '') }))
        .filter((o) => o.name !== '');
    }
  } catch (e) {
    console.warn('读取字段选项失败，回退为元信息快照', e);
  }
  if (fallbackMeta) return optionsFromMeta(fallbackMeta);
  try {
    const meta = await field.getMeta();
    return optionsFromMeta(meta as IFieldMeta);
  } catch {
    return [];
  }
}

/** 匹配单个选项：先按名称（忽略首尾空格），再按选项 id */
export function findOption(options: SelectOption[], raw: unknown): SelectOption | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return options.find((o) => o.name === s) ?? options.find((o) => o.id === s) ?? null;
}

/**
 * 提取多选输入中的选项名。
 * - 数组输入按元素取；字符串输入优先尝试「整串本身即为现有选项」（兼容选项名含分隔符），
 *   否则按分隔符拆分。
 */
export function extractOptionNames(raw: unknown, options: SelectOption[] = []): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (Array.isArray(raw)) {
    raw.forEach((x) => push(String(x)));
    return out;
  }
  const s = String(raw ?? '').trim();
  if (!s) return out;
  if (findOption(options, s)) return [s];
  s.split(MULTI_SPLIT_REGEX).forEach(push);
  return out;
}

/** 解析结果：ok=false 表示存在非法选项（绝不会自动创建选项） */
export type SelectCellResult<T> =
  | { ok: true; skip?: boolean; value?: T }
  | { ok: false; error: string };

/** 单选：值 → SDK 规范值 { id, text } */
export function toSingleSelectCell(
  raw: unknown,
  options: SelectOption[],
  fieldLabel: string,
): SelectCellResult<{ id: string; text: string }> {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: true, skip: true };
  if (!options.length) {
    return { ok: false, error: '该字段在数据表中还没有选项，请先在数据表中添加选项' };
  }
  const hit = findOption(options, s);
  if (!hit) {
    return { ok: false, error: `「${s}」不是「${fieldLabel}」的现有选项（插件不会自动创建选项）` };
  }
  return { ok: true, value: { id: hit.id, text: hit.name } };
}

/** 多选：值 → SDK 规范值 [{ id, text }] */
export function toMultiSelectCell(
  raw: unknown,
  options: SelectOption[],
  fieldLabel: string,
): SelectCellResult<Array<{ id: string; text: string }>> {
  const names = extractOptionNames(raw, options);
  if (!names.length) return { ok: true, skip: true };
  if (!options.length) {
    return { ok: false, error: '该字段在数据表中还没有选项，请先在数据表中添加选项' };
  }
  const missing: string[] = [];
  const values: Array<{ id: string; text: string }> = [];
  names.forEach((n) => {
    const hit = findOption(options, n);
    if (!hit) missing.push(n);
    else if (!values.some((v) => v.id === hit.id)) values.push({ id: hit.id, text: hit.name });
  });
  if (missing.length) {
    return { ok: false, error: `选项「${missing.join('、')}」在数据表中不存在（插件不会自动创建选项）` };
  }
  return { ok: true, value: values };
}

/** 返回多选/单选固定值中「已失效（不再存在于选项列表）」的项 */
export function findInvalidOptions(raw: unknown, options: SelectOption[], multiple: boolean): string[] {
  if (multiple) {
    return extractOptionNames(raw, options).filter((n) => !findOption(options, n));
  }
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return findOption(options, s) ? [] : [s];
}
