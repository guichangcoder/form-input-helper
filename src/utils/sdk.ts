import {
  bitable,
  type IField,
  type IFieldMeta,
  type IOpenUser,
  type ITable,
} from '@lark-base-open/js-sdk';
import { BATCH_SIZE, IMPORTABLE_FIELD_TYPES } from '../constants';
import type { SourceCondition, ValueSource } from './formConfig';
import {
  fetchSelectOptions,
  optionsFromMeta,
  toMultiSelectCell,
  toSingleSelectCell,
  type SelectOption,
} from './options';

/** 人员字段类型（User / 创建人 / 修改人），用于收集"已在表格中出现过"的人员 */
export const USER_FIELD_TYPES = [11, 1003, 1004];

/** 单选 / 多选字段类型 */
export const OPTION_FIELD_TYPES = [3, 4];

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
  return collectUsersByFieldIds(table, userFieldIds, undefined, maxPages);
}

/**
 * 收集指定表中「指定人员类字段」已出现过的所有人员，去重。
 * 单元格内包含多人时按人拆分，逐个作为独立候选。
 * @param conditions 来源表记录的筛选条件（多条 AND），不传=不过滤
 * @param maxPages 最多读取的记录页数上限（每页 500 条），避免大表卡顿
 */
export async function collectUsersFromTableField(
  table: ITable,
  fieldId: string,
  conditions?: SourceCondition[],
  maxPages = 10,
): Promise<IOpenUser[]> {
  if (!fieldId) return [];
  return collectUsersByFieldIds(table, [fieldId], conditions, maxPages);
}

/** 扫描表中指定字段的记录值，收集去重后的人员列表 */
async function collectUsersByFieldIds(
  table: ITable,
  userFieldIds: string[],
  conditions?: SourceCondition[],
  maxPages = 10,
): Promise<IOpenUser[]> {
  if (!userFieldIds.length) return [];

  const users: IOpenUser[] = [];
  const seen = new Set<string>();

  await forEachRecord(table, maxPages, (fields) => {
    if (!matchConditions(fields, conditions)) return;
    for (const fid of userFieldIds) {
      const v = fields[fid];
      if (!Array.isArray(v)) continue;
      for (const u of v) {
        const id = u && typeof u === 'object' ? (u as IOpenUser).id : undefined;
        if (id && !seen.has(id)) {
          seen.add(id);
          users.push(u as IOpenUser);
        }
      }
    }
  });

  return users;
}

/**
 * 扫描表中指定「单选/多选字段」的记录值，收集去重后的文本。
 * 单元格含多个选项时按项拆分，逐个作为独立候选。
 */
export async function collectOptionsFromTableField(
  table: ITable,
  fieldId: string,
  conditions?: SourceCondition[],
  maxPages = 10,
): Promise<string[]> {
  if (!fieldId) return [];

  const texts: string[] = [];
  const seen = new Set<string>();

  await forEachRecord(table, maxPages, (fields) => {
    if (!matchConditions(fields, conditions)) return;
    cellToTexts(fields[fieldId]).forEach((t) => {
      if (t && !seen.has(t)) {
        seen.add(t);
        texts.push(t);
      }
    });
  });

  return texts;
}

/** 逐页遍历记录（最多 maxPages 页），每页回调一次记录字段表 */
async function forEachRecord(
  table: ITable,
  maxPages: number,
  cb: (fields: Record<string, unknown>) => void,
): Promise<void> {
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const res = await table.getRecords({ pageSize: 500, pageToken });
    for (const rec of res.records) {
      cb(rec.fields as unknown as Record<string, unknown>);
    }
    pages++;
    if (!res.hasMore || !res.pageToken) break;
    pageToken = res.pageToken;
  }
}

/** 把单元格值归一化为可比较的文本数组（选项取 text、人员取 name） */
function cellToTexts(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => cellToTexts(x));
  if (typeof v === 'boolean') return [v ? '是' : '否'];
  if (typeof v === 'object') {
    const o = v as { text?: unknown; name?: unknown };
    if (o.text !== undefined && o.text !== null && o.text !== '') return [String(o.text)];
    if (o.name) return [String(o.name)];
    return [];
  }
  return [String(v)];
}

/** 判断一条记录是否满足全部筛选条件（AND） */
function matchConditions(
  fields: Record<string, unknown>,
  conditions?: SourceCondition[],
): boolean {
  if (!conditions || !conditions.length) return true;
  return conditions
    .filter((c) => c && c.fieldId)
    .every((c) => {
      const texts = cellToTexts(fields[c.fieldId]);
      const target = (c.value ?? '').trim();
      switch (c.operator) {
        case 'empty':
          return texts.length === 0;
        case 'notEmpty':
          return texts.length > 0;
        case 'eq':
          return texts.includes(target);
        case 'ne':
          return !texts.includes(target);
        case 'contains':
          return Boolean(target) && texts.some((t) => t.includes(target));
        case 'notContains':
          return Boolean(target) && !texts.some((t) => t.includes(target));
        default:
          return true;
      }
    });
}

/** 来源引用的缓存键（同表同字段同条件只扫描一次） */
function sourceCacheKey(source: ValueSource): string {
  const conds = (source.conditions ?? [])
    .filter((c) => c && c.fieldId)
    .map((c) => `${c.fieldId}:${c.operator}:${c.value ?? ''}`)
    .join(',');
  return `${source.tableId}::${source.fieldId}::${conds}`;
}

/**
 * 解析某个「人员」字段的候选人员。
 * - 未配置来源：本表已出现过的人员（人员/创建人/修改人字段）；
 * - 配置了来源：取来源表中该字段出现过、且满足条件的人员；读取失败时回退为本表人员库。
 */
export async function getPeopleCandidates(
  mainTable: ITable,
  source?: ValueSource | null,
): Promise<IOpenUser[]> {
  if (!source || !source.tableId || !source.fieldId) {
    return collectUsersFromTable(mainTable);
  }
  try {
    const sourceTable = await bitable.base.getTable(source.tableId);
    return await collectUsersFromTableField(sourceTable, source.fieldId, source.conditions);
  } catch (e) {
    console.error('读取跨表人员来源失败，回退为本表人员库', e);
    return collectUsersFromTable(mainTable);
  }
}

/**
 * 批量解析表单中各「人员」字段的候选人员：相同来源 + 条件只扫描一次。
 * @returns Map<fieldId, IOpenUser[]>
 */
export async function loadPeopleCandidates(
  mainTable: ITable,
  entries: Array<{ fieldId: string; source?: ValueSource | null }>,
): Promise<Map<string, IOpenUser[]>> {
  const result = new Map<string, IOpenUser[]>();
  const cache = new Map<string, Promise<IOpenUser[]>>();

  const resolve = (source?: ValueSource | null): Promise<IOpenUser[]> => {
    const key = source && source.tableId && source.fieldId ? sourceCacheKey(source) : '__self__';
    let p = cache.get(key);
    if (!p) {
      p = getPeopleCandidates(mainTable, source);
      cache.set(key, p);
    }
    return p;
  };

  for (const e of entries) {
    result.set(e.fieldId, await resolve(e.source));
  }
  return result;
}

/**
 * 批量解析表单中各「单选/多选」字段的候选选项（仅处理配置了跨表来源的字段）。
 * 读取失败或无来源的字段不出现在结果中，由调用方回退为字段自身选项。
 * @returns Map<fieldId, string[]>
 */
export async function loadOptionCandidates(
  entries: Array<{ fieldId: string; field: IFieldMeta; source?: ValueSource | null }>,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const cache = new Map<string, Promise<string[]>>();

  for (const e of entries) {
    if (!e.source || !e.source.tableId || !e.source.fieldId) continue;
    const key = sourceCacheKey(e.source);
    let p = cache.get(key);
    if (!p) {
      p = (async () => {
        const sourceTable = await bitable.base.getTable(e.source!.tableId);
        return collectOptionsFromTableField(sourceTable, e.source!.fieldId, e.source!.conditions);
      })();
      cache.set(key, p);
    }
    let refTexts: string[];
    try {
      refTexts = await p;
    } catch (err) {
      console.error('读取跨表选项来源失败，回退为本字段现有选项', err);
      continue;
    }
    const refSet = new Set(refTexts);
    result.set(
      e.fieldId,
      optionsFromMeta(e.field)
        .map((o) => o.name)
        .filter((n) => refSet.has(n)),
    );
  }
  return result;
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
 *
 * 注意：单选/多选字段会先用「数据表现有选项」做白名单校验，再以 { id, text }（多选 [{ id, text }]）
 * 的形式写入，从而短路 SDK 的选项自动新增逻辑——插件只选择选项，绝不修改数据表的选项配置。
 *
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
  const metaCache = new Map<string, IFieldMeta>();
  const optionCache = new Map<string, SelectOption[]>();

  const getField = async (fieldId: string): Promise<IField> => {
    let f = fieldCache.get(fieldId);
    if (!f) {
      f = await table.getField<IField>(fieldId);
      fieldCache.set(fieldId, f);
    }
    return f;
  };

  const getMeta = async (fieldId: string, field: IField): Promise<IFieldMeta> => {
    let m = metaCache.get(fieldId);
    if (!m) {
      m = (await field.getMeta()) as IFieldMeta;
      metaCache.set(fieldId, m);
    }
    return m;
  };

  const getOptions = async (
    fieldId: string,
    field: IField,
    meta: IFieldMeta,
  ): Promise<SelectOption[]> => {
    let opts = optionCache.get(fieldId);
    if (!opts) {
      opts = await fetchSelectOptions(field, meta);
      optionCache.set(fieldId, opts);
    }
    return opts;
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
          const meta = await getMeta(fieldId, field);
          const type = meta.type as number;

          // 单选/多选：白名单校验 + 传 { id, text } 绕过 SDK 的选项自动新增
          if (type === 3 || type === 4) {
            const options = await getOptions(fieldId, field, meta);
            const resolved =
              type === 3
                ? toSingleSelectCell(value, options, meta.name)
                : toMultiSelectCell(value, options, meta.name);
            if (!resolved.ok) {
              errors.push({ index: start + i, message: `字段「${meta.name}」：${resolved.error}` });
              continue;
            }
            if (resolved.skip || resolved.value === undefined) continue;
            const cell = await field.createCell(resolved.value as never);
            cells.push(cell);
            continue;
          }

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
