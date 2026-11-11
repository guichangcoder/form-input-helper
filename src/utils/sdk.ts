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
  /** 当前激活视图的 ID */
  viewId: string;
  /** 数据表全部字段 */
  fields: IFieldMeta[];
  /** 当前视图的可见字段（按视图中的字段顺序，字段名取自数据表字段名） */
  visibleFields: IFieldMeta[];
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
  const { viewId, visibleFields } = await readViewFields(table, fields);
  return {
    table,
    tableName: meta?.name ?? '',
    tableId: meta?.id ?? '',
    viewId,
    fields,
    visibleFields,
    supportedFields,
  };
}

/**
 * 读取当前视图的可见字段。
 * - 顺序取自视图（视图中的字段排列顺序）；
 * - 字段名称一律取自数据表字段元信息（避免使用视图别名）；
 * - 读取失败或结果为空时回退为数据表全部字段。
 */
async function readViewFields(
  table: ITable,
  tableFields: IFieldMeta[],
): Promise<{ viewId: string; visibleFields: IFieldMeta[] }> {
  const byId = new Map(tableFields.map((f) => [f.id, f]));
  try {
    const view = await table.getActiveView();
    if (view) {
      const viewId = view.id ?? '';
      const viewFields = (await view.getFieldMetaList()) ?? [];
      const visibleIds = await view.getVisibleFieldIdList();
      if (viewFields.length) {
        const visibleSet = Array.isArray(visibleIds) ? new Set(visibleIds) : null;
        const picked = visibleSet ? viewFields.filter((f) => visibleSet.has(f.id)) : viewFields;
        if (picked.length) {
          return { viewId, visibleFields: picked.map((f) => byId.get(f.id) ?? f) };
        }
      }
      return { viewId, visibleFields: tableFields };
    }
  } catch (e) {
    console.error('读取当前视图字段失败，回退为数据表全部字段', e);
  }
  return { viewId: '', visibleFields: tableFields };
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
