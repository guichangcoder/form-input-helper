import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Select, Switch, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import { bitable, type IFieldMeta, type IOpenUser, type ITable } from '@lark-base-open/js-sdk';
import { FIELD_TYPE_LABEL } from '../constants';
import { describeError } from '../utils/errors';
import { findInvalidOptions, optionsFromMeta } from '../utils/options';
import {
  OPTION_FIELD_TYPES,
  USER_FIELD_TYPES,
  collectUsersFromTable,
  getCurrentUserId,
} from '../utils/sdk';
import {
  CONDITION_OPERATOR_LABEL,
  buildDefaultConfig,
  isWritableField,
  mergeConfigWithFields,
  saveFormConfig,
  type ConditionOperator,
  type FormFieldConfig,
  type SourceCondition,
  type TableFormConfig,
  type ValueSource,
} from '../utils/formConfig';
import FieldEditor from './FieldEditor';

/** 配置体积参考上限（KB）：插件存储单 key 携带的数据量有限，超出可能导致保存失败 */
const CONFIG_SIZE_LIMIT_KB = 100;

/** 单个来源引用最多允许的筛选条件条数 */
const MAX_CONDITIONS = 5;

/** 条件操作符下拉项 */
const OPERATOR_OPTIONS = (Object.keys(CONDITION_OPERATOR_LABEL) as ConditionOperator[]).map(
  (op) => ({ label: CONDITION_OPERATOR_LABEL[op], value: op }),
);

/** 无比较值的操作符 */
function operatorNeedsValue(op: ConditionOperator): boolean {
  return op !== 'empty' && op !== 'notEmpty';
}

/** 字节数格式化 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 条件比较值编辑器：按条件字段类型渲染 */
function ConditionValueInput({
  field,
  value,
  onChange,
}: {
  field?: IFieldMeta;
  value: string;
  onChange: (v: string) => void;
}) {
  const type = field?.type as number | undefined;
  if (field && (type === 3 || type === 4)) {
    return (
      <Select
        style={{ minWidth: 120, flex: 1 }}
        filter
        placeholder="选项值"
        value={value || undefined}
        optionList={optionsFromMeta(field).map((o) => ({ label: o.name, value: o.name }))}
        onChange={(v) => onChange(typeof v === 'string' ? v : '')}
      />
    );
  }
  if (type === 7) {
    return (
      <Select
        style={{ minWidth: 120, flex: 1 }}
        placeholder="是 / 否"
        value={value || undefined}
        optionList={[
          { label: '是', value: '是' },
          { label: '否', value: '否' },
        ]}
        onChange={(v) => onChange(typeof v === 'string' ? v : '')}
      />
    );
  }
  return (
    <Input
      style={{ minWidth: 120, flex: 1 }}
      value={value}
      placeholder={type === 11 ? '姓名或 open_id' : '比较值'}
      onChange={onChange}
    />
  );
}

interface SourcePickerProps {
  /** 功能说明 */
  hint: string;
  /** 可选来源数据表 */
  tables: Array<{ id: string; name: string }>;
  currentTableId: string;
  /** tableId -> 该表全部字段 */
  fieldsByTable: Record<string, IFieldMeta[]>;
  /** 正在加载字段的表 ID */
  loadingTableId: string | null;
  /** 需要某张表的字段时回调（带缓存） */
  onNeedFields: (tableId: string) => void;
  /** 允许作为来源字段的类型过滤 */
  sourceFieldFilter: (f: IFieldMeta) => boolean;
  sourceFieldPlaceholder: string;
  source?: ValueSource;
  onChange: (next: ValueSource | undefined) => void;
}

/** 跨表来源配置：来源数据表 + 来源字段 + 可选筛选条件（多条 AND） */
function SourcePicker({
  hint,
  tables,
  currentTableId,
  fieldsByTable,
  loadingTableId,
  onNeedFields,
  sourceFieldFilter,
  sourceFieldPlaceholder,
  source,
  onChange,
}: SourcePickerProps) {
  const tableFields = source?.tableId ? fieldsByTable[source.tableId] ?? [] : [];
  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    tableFields.forEach((f) => m.set(f.id, f));
    return m;
  }, [tableFields]);
  const conditions = source?.conditions ?? [];

  const patch = (p: Partial<ValueSource>) => {
    if (source) onChange({ ...source, ...p });
  };

  const setCondition = (idx: number, p: Partial<SourceCondition>) => {
    patch({ conditions: conditions.map((c, i) => (i === idx ? { ...c, ...p } : c)) });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div className="hint-text" style={{ marginBottom: 4 }}>
        {hint}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Select
          style={{ minWidth: 150, flex: 1 }}
          filter
          placeholder="来源数据表"
          value={source?.tableId || undefined}
          optionList={tables.map((t) => ({
            label: t.id === currentTableId ? `${t.name}（当前表）` : t.name,
            value: t.id,
          }))}
          onChange={(v) => {
            if (typeof v !== 'string') return;
            onNeedFields(v);
            onChange({ tableId: v, fieldId: '' });
          }}
        />
        <Select
          style={{ minWidth: 150, flex: 1 }}
          filter
          placeholder={sourceFieldPlaceholder}
          disabled={!source?.tableId}
          loading={loadingTableId === source?.tableId}
          value={source?.fieldId || undefined}
          optionList={tableFields.filter(sourceFieldFilter).map((f) => ({
            label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}）`,
            value: f.id,
          }))}
          onChange={(v) => {
            if (typeof v === 'string') patch({ fieldId: v });
          }}
        />
        {source && (
          <Button size="small" theme="borderless" onClick={() => onChange(undefined)}>
            恢复默认
          </Button>
        )}
      </div>

      {source?.tableId && (
        <div style={{ marginTop: 6 }}>
          <div className="hint-text" style={{ marginBottom: 4 }}>
            筛选条件（可选，多条之间为「且」，全部满足才纳入候选）：
          </div>
          {conditions.map((c, i) => (
            <div
              key={`${c.fieldId}-${i}`}
              style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}
            >
              <Select
                style={{ minWidth: 130, flex: 1 }}
                filter
                placeholder="条件字段"
                value={c.fieldId || undefined}
                optionList={tableFields.map((f) => ({ label: f.name, value: f.id }))}
                onChange={(v) => {
                  if (typeof v === 'string') setCondition(i, { fieldId: v, value: '' });
                }}
              />
              <Select
                style={{ minWidth: 96 }}
                value={c.operator}
                optionList={OPERATOR_OPTIONS}
                onChange={(v) => {
                  if (typeof v === 'string') setCondition(i, { operator: v as ConditionOperator });
                }}
              />
              {operatorNeedsValue(c.operator) && (
                <ConditionValueInput
                  field={fieldById.get(c.fieldId)}
                  value={c.value ?? ''}
                  onChange={(v) => setCondition(i, { value: v })}
                />
              )}
              <Button
                size="small"
                theme="borderless"
                onClick={() =>
                  patch({
                    conditions: (() => {
                      const next = conditions.filter((_, idx) => idx !== i);
                      return next.length ? next : undefined;
                    })(),
                  })
                }
              >
                删除
              </Button>
            </div>
          ))}
          {conditions.length < MAX_CONDITIONS ? (
            <Button
              size="small"
              onClick={() =>
                patch({
                  conditions: [...conditions, { fieldId: '', operator: 'eq' as ConditionOperator, value: '' }],
                })
              }
            >
              + 添加条件
            </Button>
          ) : (
            <span className="hint-text">最多 {MAX_CONDITIONS} 条条件</span>
          )}
        </div>
      )}
    </div>
  );
}

interface FormConfigPanelProps {
  table: ITable | null;
  tableId: string;
  tableName: string;
  /** 数据表全部字段（用于字段名与类型查询） */
  fields: IFieldMeta[];
  /** 当前视图可见字段的 ID（按视图顺序） */
  visibleFieldIds: string[];
  config: TableFormConfig;
  onSaved: (config: TableFormConfig) => void;
}

/** 管理员配置：设置哪些字段显示/隐藏、必填、只读（只读可设固定值）以及字段顺序 */
export default function FormConfigPanel({
  table,
  tableId,
  tableName,
  fields,
  visibleFieldIds,
  config,
  onSaved,
}: FormConfigPanelProps) {
  const [local, setLocal] = useState<TableFormConfig>(config);
  const [saving, setSaving] = useState(false);
  /** 正在拖拽的字段 */
  const [dragId, setDragId] = useState<string | null>(null);
  /** 拖拽悬停到的字段（用于高亮落点） */
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    setLocal(config);
  }, [config]);

  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  const visibleIdSet = useMemo(() => new Set(visibleFieldIds), [visibleFieldIds]);

  // 只展示当前视图可见的字段，顺序沿用配置中的顺序
  const shownFields = useMemo(
    () => local.fields.filter((fc) => visibleIdSet.has(fc.fieldId)),
    [local.fields, visibleIdSet],
  );

  // 人员库（只读字段选人时用）
  const [users, setUsers] = useState<IOpenUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!table) return;
    let cancelled = false;
    Promise.all([collectUsersFromTable(table), getCurrentUserId()])
      .then(([list, uid]) => {
        if (cancelled) return;
        setUsers(list);
        setCurrentUserId(uid);
      })
      .catch((e) => console.error('读取人员字段失败', e));
    return () => {
      cancelled = true;
    };
  }, [table]);

  const userById = useMemo(() => {
    const m = new Map<string, IOpenUser>();
    users.forEach((u) => u.id && m.set(u.id, u));
    if (currentUserId) m.set(currentUserId, { id: currentUserId });
    return m;
  }, [users, currentUserId]);

  // 跨表来源：可选来源数据表 + 各表字段（人员/选项来源与筛选条件共用）
  const [sourceTables, setSourceTables] = useState<Array<{ id: string; name: string }>>([]);
  /** tableId -> 该表全部字段 */
  const [sourceFieldMap, setSourceFieldMap] = useState<Record<string, IFieldMeta[]>>({});
  const [sourceFieldLoading, setSourceFieldLoading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bitable.base
      .getTableMetaList()
      .then((list) => {
        if (cancelled) return;
        setSourceTables((list ?? []).map((t) => ({ id: t.id, name: t.name })));
      })
      .catch((e) => {
        console.error('读取数据表列表失败', e);
        if (!cancelled) Toast.error('读取数据表列表失败，可能没有其他数据表的访问权限');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 加载来源表的全部字段（按 tableId 缓存） */
  const loadSourceFields = async (sourceTableId: string) => {
    if (!sourceTableId || sourceFieldMap[sourceTableId]) return;
    setSourceFieldLoading(sourceTableId);
    try {
      const t = await bitable.base.getTable(sourceTableId);
      const metas = (await t.getFieldMetaList()) ?? [];
      setSourceFieldMap((m) => ({ ...m, [sourceTableId]: metas }));
    } catch (e) {
      console.error('读取来源表字段失败', e);
      Toast.error(describeError(e, '读取来源表字段失败，请确认你对来源表有访问权限'));
    } finally {
      setSourceFieldLoading(null);
    }
  };

  /** 配置中已引用到的来源表，进入页面时预加载其字段 */
  useEffect(() => {
    const ids = new Set<string>();
    local.fields.forEach((fc) => {
      if (fc.peopleSource?.tableId) ids.add(fc.peopleSource.tableId);
      if (fc.optionSource?.tableId) ids.add(fc.optionSource.tableId);
    });
    ids.forEach((id) => {
      void loadSourceFields(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.fields]);

  const patchField = (fieldId: string, patch: Partial<FormFieldConfig>) => {
    setLocal((c) => ({
      ...c,
      fields: c.fields.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f)),
    }));
  };

  /** 把 fromId 字段移动到 toId 字段的位置 */
  const moveField = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setLocal((c) => {
      const from = c.fields.findIndex((f) => f.fieldId === fromId);
      const to = c.fields.findIndex((f) => f.fieldId === toId);
      if (from < 0 || to < 0) return c;
      const next = [...c.fields];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...c, fields: next };
    });
  };

  /**
   * 校验只读字段的固定值：单选/多选必须命中数据表现有选项。
   * 插件只允许「选择」选项，绝不新增/修改数据表的选项。
   */
  const validateFixedValues = (cfg: TableFormConfig): string[] => {
    const problems: string[] = [];
    cfg.fields.forEach((fc) => {
      const meta = fieldById.get(fc.fieldId);
      if (!meta) return;
      const type = meta.type as number;
      if (type !== 3 && type !== 4) return;
      const raw = fc.fixedValue;
      const empty =
        raw == null ||
        (typeof raw === 'string' && !raw.trim()) ||
        (Array.isArray(raw) && raw.length === 0);
      if (empty) return;
      const invalid = findInvalidOptions(raw, optionsFromMeta(meta), type === 4);
      if (invalid.length) {
        problems.push(
          `字段「${meta.name}」的固定值「${invalid.join('、')}」已不是数据表中的选项，请重新选择或清空`,
        );
      }
    });
    return problems;
  };

  const handleSave = async () => {
    if (!tableId) {
      Toast.error('未能获取当前数据表 ID，请重新打开插件');
      return;
    }
    const problems = validateFixedValues(local);
    /** 校验单个跨表来源：数据表/来源字段成对，且每条条件完整 */
    const checkSource = (meta: IFieldMeta, source: ValueSource | undefined, label: string) => {
      if (!source) return;
      if (!source.tableId || !source.fieldId) {
        problems.push(`字段「${meta.name}」已配置${label}，请同时指定来源数据表与来源字段`);
        return;
      }
      (source.conditions ?? []).forEach((c, i) => {
        if (!c.fieldId) {
          problems.push(`字段「${meta.name}」的${label}条件 ${i + 1} 未选择条件字段`);
        } else if (operatorNeedsValue(c.operator) && !String(c.value ?? '').trim()) {
          problems.push(`字段「${meta.name}」的${label}条件 ${i + 1} 缺少比较值`);
        }
      });
    };
    local.fields.forEach((fc) => {
      const meta = fieldById.get(fc.fieldId);
      if (!meta) return;
      checkSource(meta, fc.peopleSource, '候选人员来源');
      checkSource(meta, fc.optionSource, '候选选项来源');
    });
    if (problems.length) {
      Toast.error(problems.join('；'));
      return;
    }
    setSaving(true);
    try {
      await saveFormConfig(tableId, local);
      const next = { ...local, updatedAt: Date.now() };
      setLocal(next);
      onSaved(next);
      Toast.success('配置已保存，用户打开插件即可按此表单填写');
    } catch (e) {
      Toast.error(describeError(e, '保存配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const viewFields = visibleFieldIds
      .map((id) => fieldById.get(id))
      .filter((f): f is IFieldMeta => Boolean(f));
    setLocal(mergeConfigWithFields(buildDefaultConfig(viewFields), fields));
  };

  const visibleCount = shownFields.filter((f) => f.visible).length;

  // 配置体积：保存时整份配置会写入插件存储（单个 key 有体积上限）
  const configBytes = useMemo(
    () => new TextEncoder().encode(JSON.stringify(local)).length,
    [local],
  );
  const overLimit = configBytes > CONFIG_SIZE_LIMIT_KB * 1024;

  return (
    <div>
      <div className="hint-text" style={{ marginBottom: 12 }}>
        当前表：{tableName}　字段列表与顺序取自当前视图的可见字段；按住左侧 ⠿ 可拖拽调整顺序。配置仅对当前数据表生效，保存后该表的其他用户打开插件即可直接填写。
      </div>

      <div className="config-row">
        <div className="config-row-label">启用表单填写</div>
        <div className="config-row-control">
          <Switch
            checked={local.enabled}
            onChange={(v) => setLocal((c) => ({ ...c, enabled: v }))}
          />
          <span className="hint-text" style={{ marginLeft: 8 }}>
            关闭后用户看不到「表单填写」页
          </span>
        </div>
      </div>

      <div className="config-row">
        <div className="config-row-label">记录筛选修改</div>
        <div className="config-row-control">
          <Switch
            checked={local.recordUpdateEnabled}
            onChange={(v) => setLocal((c) => ({ ...c, recordUpdateEnabled: v }))}
          />
          <span className="hint-text" style={{ marginLeft: 8 }}>
            关闭后用户看不到「记录筛选修改」页
          </span>
        </div>
      </div>

      <div className="config-row">
        <div className="config-row-label">Excel 批量导入</div>
        <div className="config-row-control">
          <Switch
            checked={local.excelImportEnabled}
            onChange={(v) => setLocal((c) => ({ ...c, excelImportEnabled: v }))}
          />
          <span className="hint-text" style={{ marginLeft: 8 }}>
            关闭后用户看不到「Excel 批量导入」页
          </span>
        </div>
      </div>

      <div className="config-row">
        <div className="config-row-label">表单标题</div>
        <div className="config-row-control">
          <Input
            value={local.title}
            placeholder="例如：客户信息登记"
            maxLength={30}
            onChange={(v) => setLocal((c) => ({ ...c, title: v }))}
          />
        </div>
      </div>

      <div className="config-row">
        <div className="config-row-label">表单说明</div>
        <div className="config-row-control">
          <TextArea
            value={local.description}
            placeholder="选填，展示在表单标题下方"
            autosize={{ minRows: 2, maxRows: 4 }}
            maxCount={200}
            onChange={(v) => setLocal((c) => ({ ...c, description: v }))}
          />
        </div>
      </div>

      <div style={{ margin: '16px 0 8px', fontSize: 13, fontWeight: 600 }}>
        字段配置（当前视图共 {shownFields.length} 个，显示 {visibleCount} 个）
      </div>

      {shownFields.length === 0 && (
        <div className="empty-tip">当前视图没有可见字段，请切换到包含字段的视图后重试。</div>
      )}

      {shownFields.map((fc) => {
        const meta = fieldById.get(fc.fieldId);
        if (!meta) return null;
        const writable = isWritableField(meta);
        const readOnly = fc.readOnly || !writable;
        const isDragging = dragId === fc.fieldId;
        const isOver = overId === fc.fieldId && dragId !== null && dragId !== fc.fieldId;
        return (
          <div
            className={`config-field${fc.visible ? '' : ' config-field--off'}${
              isDragging ? ' config-field--dragging' : ''
            }${isOver ? ' config-field--drop' : ''}`}
            key={fc.fieldId}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverId(fc.fieldId);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) moveField(dragId, fc.fieldId);
              setDragId(null);
              setOverId(null);
            }}
          >
            <div className="config-field-head">
              <div className="config-field-name">
                <span
                  className="config-drag-handle"
                  draggable
                  title="按住拖拽调整顺序"
                  onDragStart={(e) => {
                    setDragId(fc.fieldId);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', fc.fieldId);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  ⠿
                </span>
                <span>{meta.name}</span>
                <Tag size="small" color="light-blue">
                  {FIELD_TYPE_LABEL[meta.type as number] ?? meta.type}
                </Tag>
                {!writable && (
                  <Tag size="small" color="grey">
                    不可填写
                  </Tag>
                )}
              </div>
            </div>

            <div className="config-field-switches">
              <Checkbox
                checked={fc.visible}
                onChange={(e) => patchField(fc.fieldId, { visible: Boolean(e.target.checked) })}
              >
                显示
              </Checkbox>
              <Checkbox
                checked={!writable ? false : fc.required}
                disabled={!writable || !fc.visible || readOnly}
                onChange={(e) => patchField(fc.fieldId, { required: Boolean(e.target.checked) })}
              >
                必填
              </Checkbox>
              <Checkbox
                checked={readOnly}
                disabled={!writable || !fc.visible}
                onChange={(e) => {
                  const next = Boolean(e.target.checked);
                  patchField(fc.fieldId, { readOnly: next, required: next ? false : fc.required });
                }}
              >
                只读
              </Checkbox>
            </div>

            {!writable && (
              <div className="hint-text" style={{ marginTop: 4 }}>
                该字段类型不支持在表单中填写，仅可选择是否显示，显示时为只读展示。
              </div>
            )}

            {writable && fc.visible && readOnly && (
              <div style={{ marginTop: 8 }}>
                <div className="hint-text" style={{ marginBottom: 4 }}>
                  只读字段的固定值（用户不可修改）：
                </div>
                <FieldEditor
                  field={meta}
                  value={fc.fixedValue}
                  onChange={(v) => patchField(fc.fieldId, { fixedValue: v })}
                  users={users}
                  currentUserId={currentUserId}
                  userById={userById}
                  multipleUser={(meta.property as { multiple?: boolean } | null)?.multiple !== false}
                />
              </div>
            )}

            {writable && fc.visible && (meta.type as number) === 11 && (
              <>
                <SourcePicker
                  hint="候选人员来源（可选）：引用其他数据表的某个人员类字段；单元格含多人时自动拆分为多个候选。"
                  tables={sourceTables}
                  currentTableId={tableId}
                  fieldsByTable={sourceFieldMap}
                  loadingTableId={sourceFieldLoading}
                  onNeedFields={loadSourceFields}
                  sourceFieldFilter={(f) => USER_FIELD_TYPES.includes(f.type as number)}
                  sourceFieldPlaceholder="来源字段（人员类）"
                  source={fc.peopleSource}
                  onChange={(next) => patchField(fc.fieldId, { peopleSource: next })}
                />
                <div className="hint-text" style={{ marginTop: 4 }}>
                  {fc.peopleSource?.tableId
                    ? '已设置来源：候选人员仅取该来源字段中满足条件的人员（不合并本表人员）。'
                    : '未设置来源：候选人员为本表中已出现过的人员。'}
                </div>
              </>
            )}

            {writable && fc.visible && OPTION_FIELD_TYPES.includes(meta.type as number) && (
              <>
                <SourcePicker
                  hint="候选选项来源（可选）：引用其他数据表的某个单选/多选字段；候选选项 = 本字段已有选项与来源值的交集（不会新增或修改本字段选项）。"
                  tables={sourceTables}
                  currentTableId={tableId}
                  fieldsByTable={sourceFieldMap}
                  loadingTableId={sourceFieldLoading}
                  onNeedFields={loadSourceFields}
                  sourceFieldFilter={(f) => OPTION_FIELD_TYPES.includes(f.type as number)}
                  sourceFieldPlaceholder="来源字段（单选/多选）"
                  source={fc.optionSource}
                  onChange={(next) => patchField(fc.fieldId, { optionSource: next })}
                />
                <div className="hint-text" style={{ marginTop: 4 }}>
                  {fc.optionSource?.tableId
                    ? '已设置来源：候选选项仅展示「本字段已有选项」中出现在该来源里的值。'
                    : '未设置来源：候选选项为本字段在数据表中已有的全部选项。'}
                </div>
              </>
            )}
          </div>
        );
      })}

      <div className="hint-text" style={{ margin: '12px 0 8px' }}>
        当前配置体积：{formatBytes(configBytes)}（参考上限 {CONFIG_SIZE_LIMIT_KB} KB）
        {overLimit && (
          <span style={{ color: 'var(--semi-color-danger)' }}>
            {' '}
            已超出参考上限，保存可能失败，请减少只读字段的固定值或表单说明内容。
          </span>
        )}
      </div>

      <div className="footer-bar">
        <Button theme="solid" block onClick={handleSave} loading={saving} disabled={saving}>
          保存配置
        </Button>
        <Button
          theme="borderless"
          block
          style={{ marginTop: 6 }}
          disabled={saving}
          onClick={handleReset}
        >
          重置为默认（全部显示、非必填、可编辑）
        </Button>
      </div>
    </div>
  );
}
