import {
  bitable,
  type IField,
  type IFieldMeta,
  type IOpenUser,
  type ITable,
} from '@lark-base-open/js-sdk';
import { BATCH_SIZE, IMPORTABLE_FIELD_TYPES } from '../constants';

/** 人员字段类型（User / 创建人 / 修改人），用于收集"已在表格中出现过"的人员 */
const USER_FIELD_TYPES = [11, 1003, 1004];

/** 当前表上下文 */
export interface TableContext {
  table: ITable;
  tableName: string;
  tableId: string;
  /** 全部字段 */
  fields: IFieldMeta[];
  /** 支持写入的字段（可按类型过滤后用于映射/录入） */
  supportedFields: IFieldMeta[];
}

/** 获取当前激活的数据表及字段信息 */
export async function getTableContext(): Promise<TableContext> {
  const table = await bitable.base.getActiveTable();
  if (!table) {
    throw new Error('未能获取当前数据表，请停留在某个数据表视图后重试');
  }
  const meta = await table.getMeta();
  const fields = (await table.getFieldMetaList()) ?? [];
  const supportedFields = fields.filter((f) =>
    IMPORTABLE_FIELD_TYPES.includes(f.type as number),
  );
  return {
    table,
    tableName: meta?.name ?? '',
    tableId: meta?.id ?? '',
    fields,
    supportedFields,
  };
}

/** 判断字段类型是否可导入（Excel） */
export function isFieldSupported(field: IFieldMeta): boolean {
  return IMPORTABLE_FIELD_TYPES.includes(field.type as number);
}

/**
 * 收集当前表中"已出现过的所有人员"（人员/创建人/修改人字段值），去重。
 * @param maxPages 最多读取的记录页数上限（每页 500 条），避免大表卡顿
 */
export async function collectUsersFromTable(
  table: ITable,
  maxPages = 10,
): Promise<IOpenUser[]> {
  const metas = await table.getFieldMetaList();
  const userFieldIds = metas
    .filter((f) => USER_FIELD_TYPES.includes(f.type as number))
    .map((f) => f.id);
  if (!userFieldIds.length) return [];

  const users: IOpenUser[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const res = await table.getRecords({ pageSize: 500, pageToken });
    for (const rec of res.records) {
      for (const fid of userFieldIds) {
        const v = rec.fields[fid];
        if (!Array.isArray(v)) continue;
        for (const u of v) {
          if (u && typeof u === 'object' && (u as IOpenUser).id && !seen.has((u as IOpenUser).id!)) {
            seen.add((u as IOpenUser).id!);
            users.push(u as IOpenUser);
          }
        }
      }
    }
    pages++;
    if (!res.hasMore || !res.pageToken) break;
    pageToken = res.pageToken;
  }
  return users;
}

/** 获取当前登录用户 ID */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    return await bitable.bridge.getUserId();
  } catch {
    return null;
  }
}

/** 单选/多选字段的最小可用结构（避免 SDK 泛型约束限制） */
export interface SelectFieldLike {
  getOptions: () => Promise<Array<{ name: string }>>;
  addOptions: (optionList: Array<{ name: string; color?: number }>) => Promise<unknown>;
}

/**
 * 确保单选/多选字段包含指定选项（缺失的自动创建）
 */
export async function ensureSelectOptions(
  field: SelectFieldLike,
  values: string[],
): Promise<{ added: number }> {
  if (!values.length) return { added: 0 };
  const existing = await field.getOptions();
  const existingNames = new Set(existing.map((o) => o.name));
  const missing = Array.from(new Set(values.filter((v) => !existingNames.has(v))));
  if (!missing.length) return { added: 0 };

  // 分批创建选项，避免单次过大
  const CHUNK = 50;
  for (let i = 0; i < missing.length; i += CHUNK) {
    await field.addOptions(missing.slice(i, i + CHUNK).map((name) => ({ name })));
  }
  return { added: missing.length };
}

/**
 * 批量写入记录。
 * @param records 每条记录为 { [fieldId]: 已转换值 }，值为 undefined 的字段跳过
 * @param onProgress 每批完成后的进度回调
 */
export async function writeRecords(
  table: ITable,
  records: Array<Record<string, unknown>>,
  fieldIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; errors: Array<{ index: number; message: string }> }> {
  const errors: Array<{ index: number; message: string }> = [];
  const fieldCache = new Map<string, IField>();

  const getField = async (fieldId: string): Promise<IField> => {
    let f = fieldCache.get(fieldId);
    if (!f) {
      f = await table.getField<IField>(fieldId);
      fieldCache.set(fieldId, f);
    }
    return f;
  };

  let success = 0;
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const batchCells: unknown[][] = [];

    for (let i = 0; i < chunk.length; i++) {
      const record = chunk[i];
      const cells: unknown[] = [];
      for (const fieldId of fieldIds) {
        const value = record[fieldId];
        if (value === undefined) continue; // 空值跳过
        try {
          const field = await getField(fieldId);
          const cell = await field.createCell(value as never);
          cells.push(cell);
        } catch (e) {
          errors.push({ index: start + i, message: `字段转换失败: ${(e as Error).message || e}` });
        }
      }
      batchCells.push(cells);
    }

    if (batchCells.length) {
      try {
        await table.addRecords(batchCells as never);
        success += batchCells.length;
      } catch (e) {
        // 整批失败：逐条重试定位失败行
        for (let i = 0; i < batchCells.length; i++) {
          try {
            await table.addRecords([batchCells[i]] as never);
            success++;
          } catch (e2) {
            errors.push({
              index: start + i,
              message: `写入失败: ${(e2 as Error).message || e2}`,
            });
          }
        }
      }
    }
    onProgress?.(Math.min(start + BATCH_SIZE, records.length), records.length);
  }

  return { success, errors };
}

/** 收集多行记录中指定单选/多选字段出现的全部文本值 */
export function collectSelectValues(
  records: Array<Record<string, unknown>>,
  fieldId: string,
): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = r[fieldId];
    if (Array.isArray(v)) {
      v.forEach((x) => x && set.add(String(x)));
    } else if (v != null) {
      set.add(String(v));
    }
  }
  return Array.from(set);
}
