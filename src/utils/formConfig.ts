import {
  bitable,
  OperationType,
  PermissionEntity,
  type IFieldMeta,
} from '@lark-base-open/js-sdk';
import { WRITABLE_FIELD_TYPES } from '../constants';

/** 单个字段的表单配置 */
export interface FormFieldConfig {
  fieldId: string;
  /** 是否在表单中显示（false = 对用户隐藏） */
  visible: boolean;
  /** 是否必填（仅对可见且可编辑的字段生效） */
  required: boolean;
  /** 是否只读（用户不可修改，写入管理员设置的固定值） */
  readOnly: boolean;
  /** 只读字段的固定值（由管理员配置） */
  fixedValue?: unknown;
}

/** 一张数据表的表单配置 */
export interface TableFormConfig {
  /** 是否启用表单填写（关闭后用户看不到表单） */
  enabled: boolean;
  /** 表单标题 */
  title: string;
  /** 表单说明 */
  description: string;
  /** 字段配置，数组顺序即表单中的字段顺序 */
  fields: FormFieldConfig[];
  /** 最近更新时间（由保存时写入） */
  updatedAt: number;
}

const KEY_PREFIX = 'base-form-importer:form-config:';

/** 按数据表维度存储：同一多维表格内的用户共享这份配置 */
function storageKey(tableId: string): string {
  return `${KEY_PREFIX}${tableId}`;
}

/** 读取指定数据表的表单配置；未配置或读取失败时返回 null */
export async function loadFormConfig(tableId: string): Promise<TableFormConfig | null> {
  if (!tableId) return null;
  try {
    const data = await bitable.bridge.getData<TableFormConfig | null>(storageKey(tableId));
    if (!data || typeof data !== 'object' || !Array.isArray(data.fields)) return null;
    return {
      enabled: data.enabled !== false,
      title: data.title || '表单填写',
      description: data.description || '',
      fields: data.fields,
      updatedAt: data.updatedAt || 0,
    };
  } catch (e) {
    console.error('读取表单配置失败', e);
    return null;
  }
}

/** 保存表单配置（仅管理员使用） */
export async function saveFormConfig(tableId: string, config: TableFormConfig): Promise<void> {
  const ok = await bitable.bridge.setData(storageKey(tableId), {
    ...config,
    updatedAt: Date.now(),
  });
  if (!ok) {
    throw new Error('配置保存失败，请确认你对当前多维表格有可管理权限');
  }
}

/** 当前用户是否拥有该多维表格的可管理权限（即管理员） */
export async function isBaseManager(): Promise<boolean> {
  try {
    return await bitable.base.getPermission({
      entity: PermissionEntity.Base,
      type: OperationType.Manageable,
    });
  } catch (e) {
    console.error('读取管理权限失败', e);
    return false;
  }
}

/** 判断字段是否可填写（表单中可写入值） */
export function isWritableField(field: IFieldMeta): boolean {
  return WRITABLE_FIELD_TYPES.includes(field.type as number);
}

/** 依据字段生成默认配置：可填写字段默认显示，不可填写字段默认隐藏但可在配置中查看 */
export function buildDefaultConfig(fields: IFieldMeta[]): TableFormConfig {
  return {
    enabled: true,
    title: '表单填写',
    description: '',
    fields: fields.map((f) => {
      const writable = isWritableField(f);
      return {
        fieldId: f.id,
        visible: writable,
        required: false,
        readOnly: !writable,
      };
    }),
    updatedAt: 0,
  };
}

/**
 * 用最新字段列表校正配置：
 * - 保留已有字段的顺序与设置
 * - 剔除已被删除的字段
 * - 新增字段追加到末尾（可填写字段默认显示，不可填写字段默认隐藏）
 */
export function mergeConfigWithFields(
  config: TableFormConfig,
  fields: IFieldMeta[],
): TableFormConfig {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const kept = config.fields.filter((f) => byId.has(f.fieldId));
  const existing = new Set(kept.map((f) => f.fieldId));
  const added: FormFieldConfig[] = fields
    .filter((f) => !existing.has(f.id))
    .map((f) => {
      const writable = isWritableField(f);
      return {
        fieldId: f.id,
        visible: writable,
        required: false,
        readOnly: !writable,
      };
    });
  return { ...config, fields: [...kept, ...added] };
}
