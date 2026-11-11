import type { IFieldMeta, IOpenCellValue, IOpenUser } from '@lark-base-open/js-sdk';
import { convertCellValue } from './convert';

export type MatchOperator = 'eq' | 'contains' | 'gte' | 'lte';

export interface MatchCondition {
  fieldId: string;
  fieldMeta: IFieldMeta;
  operator: MatchOperator;
  /** 用户原始输入（FieldEditor 输出） */
  rawValue: unknown;
}

/** 单元格值 → 可比较值 */
function cellComparable(cell: IOpenCellValue | null | undefined, fieldMeta: IFieldMeta): unknown {
  if (cell == null) return fieldMeta.type === 7 ? false : '';
  switch (fieldMeta.type as number) {
    case 1: // Text
      if (typeof cell === 'string') return cell;
      if (Array.isArray(cell)) {
        return (cell as Array<{ text?: string }>)
          .map((s) => s?.text ?? '')
          .join('');
      }
      return String(cell);
    case 2: // Number
    case 99002: // Progress
    case 99003: // Currency
    case 99004: // Rating
      return typeof cell === 'number' ? cell : Number(cell);
    case 3: // SingleSelect
      return (cell as { text?: string } | null)?.text ?? '';
    case 4: // MultiSelect
      return Array.isArray(cell) ? (cell as Array<{ text?: string }>).map((x) => x?.text ?? '') : [];
    case 5: // DateTime（毫秒时间戳）
      return typeof cell === 'number' ? cell : NaN;
    case 7: // Checkbox
      return cell === true;
    case 11: // User（人员）
      return Array.isArray(cell)
        ? (cell as Array<{ id?: string }>).map((u) => u?.id).filter(Boolean)
        : [];
    default:
      return null;
  }
}

/** 条件输入 → 可比较值 */
function condComparable(cond: MatchCondition): { value: unknown; ok: boolean } {
  const res = convertCellValue(cond.rawValue, cond.fieldMeta);
  if (!res.ok || res.skip) return { value: undefined, ok: res.ok && !res.skip };
  const v = res.value;
  switch (cond.fieldMeta.type as number) {
    case 1:
      return { value: String(v), ok: true };
    case 2:
    case 99002:
    case 99003:
    case 99004:
      return { value: Number(v), ok: true };
    case 3:
      return { value: String(v), ok: true };
    case 4:
      return { value: Array.isArray(v) ? (v as string[]) : [String(v)], ok: true };
    case 5:
      return { value: Number(v), ok: true };
    case 7:
      return { value: v === true, ok: true };
    case 11:
      return {
        value: Array.isArray(v)
          ? (v as Array<{ id: string }>).map((u) => u.id)
          : [(v as { id: string }).id],
        ok: true,
      };
    default:
      return { value: undefined, ok: false };
  }
}

/** 判断单元格是否满足条件 */
export function matchCell(cell: IOpenCellValue | null | undefined, cond: MatchCondition): boolean {
  const { value: condV } = condComparable(cond);
  if (condV === undefined) return false;
  const cellV = cellComparable(cell, cond.fieldMeta);
  const type = cond.fieldMeta.type as number;

  switch (cond.operator) {
    case 'eq':
      if (type === 5 && typeof cellV === 'number' && typeof condV === 'number') {
        return sameDay(cellV, condV);
      }
      if (Array.isArray(cellV)) {
        const condArr = Array.isArray(condV) ? (condV as unknown[]) : [condV];
        return condArr.every((c) => cellV.some((x) => String(x).trim() === String(c).trim()));
      }
      if (Array.isArray(condV)) {
        const cellS = String(cellV).trim();
        return condV.every((c) => cellS === String(c).trim());
      }
      // 文本忽略大小写与首尾空格
      if (type === 1) {
        return String(cellV).trim().toLowerCase() === String(condV).trim().toLowerCase();
      }
      return cellV === condV;
    case 'contains':
      if (typeof cellV === 'string' && typeof condV === 'string') {
        return cellV.toLowerCase().includes(condV.toLowerCase());
      }
      if (Array.isArray(cellV)) {
        return cellV.some((x) => String(x).toLowerCase().includes(String(condV).toLowerCase()));
      }
      return String(cellV).toLowerCase().includes(String(condV).toLowerCase());
    case 'gte':
      return typeof cellV === 'number' && typeof condV === 'number' ? cellV >= condV : false;
    case 'lte':
      return typeof cellV === 'number' && typeof condV === 'number' ? cellV <= condV : false;
    default:
      return false;
  }
}

/** 根据字段类型返回可用的筛选操作符 */
export function operatorsForField(fieldMeta: IFieldMeta): Array<{ label: string; value: MatchOperator }> {
  switch (fieldMeta.type as number) {
    case 1: // Text
      return [
        { label: '等于', value: 'eq' },
        { label: '包含', value: 'contains' },
      ];
    case 2:
    case 99002:
    case 99003:
    case 99004: // 数字类
      return [
        { label: '等于', value: 'eq' },
        { label: '大于等于', value: 'gte' },
        { label: '小于等于', value: 'lte' },
      ];
    case 5: // 日期
      return [
        { label: '等于（当天）', value: 'eq' },
        { label: '不早于', value: 'gte' },
        { label: '不晚于', value: 'lte' },
      ];
    default:
      return [{ label: '等于', value: 'eq' }];
  }
}

/** 单元格值 → 编辑器预填值（逐条修改时使用） */
export function cellToRawValue(
  cell: IOpenCellValue | null | undefined,
  fieldMeta: IFieldMeta,
): unknown {
  if (cell == null) return '';
  switch (fieldMeta.type as number) {
    case 1: // Text
      return cellText(cell, fieldMeta);
    case 2: // Number
    case 99002: // Progress
    case 99003: // Currency
    case 99004: // Rating
      return typeof cell === 'number' ? cell : '';
    case 3: // SingleSelect
      return (cell as { text?: string } | null)?.text ?? '';
    case 4: // MultiSelect
      return Array.isArray(cell)
        ? (cell as Array<{ text?: string }>).map((x) => x?.text ?? '').filter(Boolean)
        : [];
    case 5: // DateTime
      return typeof cell === 'number' ? cell : '';
    case 7: // Checkbox
      return cell === true ? '是' : '';
    case 11: // User
      return Array.isArray(cell) ? (cell as IOpenUser[]) : [];
    default:
      return '';
  }
}

function sameDay(ms1: number, ms2: number): boolean {
  const d1 = new Date(ms1);
  const d2 = new Date(ms2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/** 记录标识文本（展示用）：主字段 + 指定字段值 */
export function recordDisplayText(
  fields: Record<string, IOpenCellValue>,
  primaryField: IFieldMeta | undefined,
  extraFields: IFieldMeta[],
): string {
  const parts: string[] = [];
  if (primaryField) {
    const v = fields[primaryField.id];
    parts.push(`${primaryField.name}: ${cellText(v, primaryField)}`);
  }
  for (const f of extraFields.slice(0, 4)) {
    const v = fields[f.id];
    const t = cellText(v, f);
    if (t !== '') parts.push(`${f.name}: ${t}`);
  }
  return parts.join(' | ') || '（无主字段值）';
}

/** 单元格值 → 展示文本 */
export function cellText(cell: IOpenCellValue | null | undefined, fieldMeta: IFieldMeta): string {
  if (cell == null) return '';
  switch (fieldMeta.type as number) {
    case 1:
      if (typeof cell === 'string') return cell;
      if (Array.isArray(cell)) return (cell as Array<{ text?: string }>).map((s) => s?.text ?? '').join('');
      return String(cell);
    case 3:
      return (cell as { text?: string } | null)?.text ?? '';
    case 4:
      return Array.isArray(cell)
        ? (cell as Array<{ text?: string }>).map((x) => x?.text ?? '').join('、')
        : String(cell);
    case 5:
      return typeof cell === 'number'
        ? new Date(cell).toLocaleString('zh-CN', { hour12: false })
        : String(cell);
    case 7:
      return cell === true ? '是' : '否';
    case 11:
      return Array.isArray(cell)
        ? (cell as Array<{ name?: string; email?: string; id?: string }>)
            .map((u) => u?.name || u?.email || u?.id || '')
            .filter(Boolean)
            .join('、')
        : String(cell);
    default:
      return String(cell);
  }
}
