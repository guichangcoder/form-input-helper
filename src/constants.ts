import { FieldType } from '@lark-base-open/js-sdk';

/** 可导入的字段类型（Excel 文本可转换为值） */
export const IMPORTABLE_FIELD_TYPES: FieldType[] = [
  FieldType.Text,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.DateTime,
  FieldType.Checkbox,
  FieldType.Phone,
  FieldType.Url,
  FieldType.Currency,
  FieldType.Progress,
  FieldType.Rating,
  FieldType.Email,
];

/** 固定值/录入模块可写入的字段类型（含人员：需从人员库选择，不可从 Excel 文本解析） */
export const WRITABLE_FIELD_TYPES: FieldType[] = [
  ...IMPORTABLE_FIELD_TYPES,
  FieldType.User,
];

/** 不可用于筛选的字段类型：单元格值无法转换为可比较的文本/数字 */
export const NON_FILTERABLE_FIELD_TYPES: FieldType[] = [
  FieldType.NotSupport,
  FieldType.Attachment,
  FieldType.Location,
  FieldType.GroupChat,
  FieldType.Object,
  FieldType.Denied,
];

/** 字段类型显示名 */
export const FIELD_TYPE_LABEL: Record<number, string> = {
  [FieldType.NotSupport]: '不支持',
  [FieldType.Text]: '文本',
  [FieldType.Number]: '数字',
  [FieldType.SingleSelect]: '单选',
  [FieldType.MultiSelect]: '多选',
  [FieldType.DateTime]: '日期',
  [FieldType.Checkbox]: '复选框',
  [FieldType.User]: '人员',
  [FieldType.Phone]: '电话',
  [FieldType.Url]: '网址',
  [FieldType.Attachment]: '附件',
  [FieldType.SingleLink]: '关联(单)',
  [FieldType.Lookup]: '查找引用',
  [FieldType.Formula]: '公式',
  [FieldType.DuplexLink]: '关联(双)',
  [FieldType.Location]: '地理位置',
  [FieldType.GroupChat]: '群组',
  [FieldType.Object]: '对象',
  [FieldType.CreatedTime]: '创建时间',
  [FieldType.ModifiedTime]: '修改时间',
  [FieldType.CreatedUser]: '创建人',
  [FieldType.ModifiedUser]: '修改人',
  [FieldType.AutoNumber]: '自动编号',
  [FieldType.Barcode]: '条码',
  [FieldType.Progress]: '进度',
  [FieldType.Currency]: '货币',
  [FieldType.Rating]: '评分',
  [FieldType.Email]: '邮箱',
};

/** 多选/多行值拆分分隔符 */
export const MULTI_SPLIT_REGEX = /[,，;；、\n\r\t|/]+/;

/** 复选框中代表 true / false 的文本 */
export const CHECKBOX_TRUE = /^(是|真|√|✔|对|1|true|yes|y|checked)$/i;
export const CHECKBOX_FALSE = /^(否|假|×|✕|错|0|false|no|n|unchecked)$/i;

/** 批量写入时每批条数（addRecords 单次上限 5000，这里保守分批） */
export const BATCH_SIZE = 200;

/** 预览最大行数 */
export const PREVIEW_ROWS = 20;

/** 本地存储 key：映射关系记忆 */
export const MAPPING_STORAGE_KEY = 'base-form-importer:mapping';
