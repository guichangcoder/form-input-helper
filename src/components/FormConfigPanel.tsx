import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Switch, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { FIELD_TYPE_LABEL } from '../constants';
import { describeError } from '../utils/errors';
import { collectUsersFromTable, getCurrentUserId } from '../utils/sdk';
import {
  buildDefaultConfig,
  isWritableField,
  mergeConfigWithFields,
  saveFormConfig,
  type FormFieldConfig,
  type TableFormConfig,
} from '../utils/formConfig';
import FieldEditor from './FieldEditor';

/** 配置体积参考上限（KB）：插件存储单 key 携带的数据量有限，超出可能导致保存失败 */
const CONFIG_SIZE_LIMIT_KB = 100;

/** 字节数格式化 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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

  const handleSave = async () => {
    if (!tableId) {
      Toast.error('未能获取当前数据表 ID，请重新打开插件');
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
