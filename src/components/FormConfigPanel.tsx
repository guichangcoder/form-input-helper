import React, { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Switch, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { FIELD_TYPE_LABEL } from '../constants';
import { describeError } from '../utils/errors';
import { collectUsersFromTable, getCurrentUserId } from '../utils/sdk';
import {
  buildDefaultConfig,
  saveFormConfig,
  type FormFieldConfig,
  type TableFormConfig,
} from '../utils/formConfig';
import FieldEditor from './FieldEditor';

interface FormConfigPanelProps {
  table: ITable | null;
  tableId: string;
  tableName: string;
  fields: IFieldMeta[];
  config: TableFormConfig;
  onSaved: (config: TableFormConfig) => void;
}

/** 管理员配置：设置哪些字段显示/隐藏、必填、只读（只读可设固定值）以及字段顺序 */
export default function FormConfigPanel({
  table,
  tableId,
  tableName,
  fields,
  config,
  onSaved,
}: FormConfigPanelProps) {
  const [local, setLocal] = useState<TableFormConfig>(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(config);
  }, [config]);

  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

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

  const patchField = (index: number, patch: Partial<FormFieldConfig>) => {
    setLocal((c) => ({
      ...c,
      fields: c.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  };

  const moveField = (index: number, offset: number) => {
    setLocal((c) => {
      const target = index + offset;
      if (target < 0 || target >= c.fields.length) return c;
      const next = [...c.fields];
      [next[index], next[target]] = [next[target], next[index]];
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

  const visibleCount = local.fields.filter((f) => f.visible).length;

  return (
    <div>
      <div className="hint-text" style={{ marginBottom: 12 }}>
        当前表：{tableName}　配置仅对当前数据表生效，保存后该表的其他用户打开插件即可直接填写。
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
        字段配置（共 {local.fields.length} 个，显示 {visibleCount} 个）
      </div>

      {local.fields.length === 0 && (
        <div className="empty-tip">当前数据表没有可填写的字段。</div>
      )}

      {local.fields.map((fc, idx) => {
        const meta = fieldById.get(fc.fieldId);
        if (!meta) return null;
        return (
          <div className={`config-field${fc.visible ? '' : ' config-field--off'}`} key={fc.fieldId}>
            <div className="config-field-head">
              <div className="config-field-name">
                <span>{meta.name}</span>
                <Tag size="small" color="light-blue">
                  {FIELD_TYPE_LABEL[meta.type as number] ?? meta.type}
                </Tag>
              </div>
              <div>
                <Button
                  size="small"
                  theme="borderless"
                  disabled={idx === 0}
                  onClick={() => moveField(idx, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  theme="borderless"
                  disabled={idx === local.fields.length - 1}
                  onClick={() => moveField(idx, 1)}
                >
                  ↓
                </Button>
              </div>
            </div>

            <div className="config-field-switches">
              <Checkbox
                checked={fc.visible}
                onChange={(e) => patchField(idx, { visible: Boolean(e.target.checked) })}
              >
                显示
              </Checkbox>
              <Checkbox
                checked={fc.required}
                disabled={!fc.visible || fc.readOnly}
                onChange={(e) => patchField(idx, { required: Boolean(e.target.checked) })}
              >
                必填
              </Checkbox>
              <Checkbox
                checked={fc.readOnly}
                disabled={!fc.visible}
                onChange={(e) => {
                  const readOnly = Boolean(e.target.checked);
                  patchField(idx, { readOnly, required: readOnly ? false : fc.required });
                }}
              >
                只读
              </Checkbox>
            </div>

            {fc.visible && fc.readOnly && (
              <div style={{ marginTop: 8 }}>
                <div className="hint-text" style={{ marginBottom: 4 }}>
                  只读字段的固定值（用户不可修改）：
                </div>
                <FieldEditor
                  field={meta}
                  value={fc.fixedValue}
                  onChange={(v) => patchField(idx, { fixedValue: v })}
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

      <div className="footer-bar">
        <Button theme="solid" block onClick={handleSave} loading={saving} disabled={saving}>
          保存配置
        </Button>
        <Button
          theme="borderless"
          block
          style={{ marginTop: 6 }}
          disabled={saving}
          onClick={() => setLocal(buildDefaultConfig(fields))}
        >
          重置为默认（全部显示、非必填、可编辑）
        </Button>
      </div>
    </div>
  );
}
