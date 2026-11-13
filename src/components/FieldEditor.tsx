import React, { useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  Select,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser } from '@lark-base-open/js-sdk';
import { findInvalidOptions, optionsFromMeta } from '../utils/options';

interface FieldEditorProps {
  field: IFieldMeta;
  /** 当前值：与编辑器状态对应（文本/数字为原始输入；人员为 IOpenUser[]；日期为 ms 时间戳或 ''） */
  value: unknown;
  onChange: (v: unknown) => void;
  /** 人员库（本表已出现过的人员） */
  users?: IOpenUser[];
  currentUserId?: string | null;
  userById?: Map<string, IOpenUser>;
  /** 是否允许人员多选（跟随字段属性） */
  multipleUser?: boolean;
  placeholder?: string;
}

/** 按字段类型渲染值编辑器：固定值、筛选、更新模块共用 */
export default function FieldEditor({
  field,
  value,
  onChange,
  users = [],
  currentUserId,
  userById,
  multipleUser = true,
  placeholder,
}: FieldEditorProps) {
  const options = optionsFromMeta(field);

  switch (field.type as number) {
    case 2: // Number
    case 99002: // Progress
    case 99003: // Currency
    case 99004: // Rating
      return (
        <InputNumber
          value={value as number | undefined}
          onChange={(v) => onChange(v ?? '')}
          style={{ width: '100%' }}
          hideButtons
          placeholder={placeholder || '请输入数字'}
        />
      );
    case 3: // SingleSelect：只能选择该字段在多维表格中已配置的选项
      if (!options.length) {
        return <div className="hint-text">该字段在多维表格中还没有选项，请先在数据表中添加选项。</div>;
      }
      return (
        <>
          <Select
            value={typeof value === 'string' && value ? value : undefined}
            optionList={options.map((o) => ({ label: o.name, value: o.name }))}
            placeholder={placeholder || '请选择选项'}
            style={{ width: '100%' }}
            filter
            onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          />
          <InvalidOptionHint value={value} options={options} multiple={false} />
        </>
      );
    case 4: {
      // MultiSelect：只能选择该字段在多维表格中已配置的选项
      if (!options.length) {
        return <div className="hint-text">该字段在多维表格中还没有选项，请先在数据表中添加选项。</div>;
      }
      const selected = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
      return (
        <>
          <Select
            multiple
            value={selected}
            optionList={options.map((o) => ({ label: o.name, value: o.name }))}
            placeholder={placeholder || '请选择选项（可多选）'}
            style={{ width: '100%' }}
            filter
            maxTagCount={3}
            onChange={(v) => onChange((Array.isArray(v) ? v : v ? [v] : []) as string[])}
          />
          <InvalidOptionHint value={value} options={options} multiple />
        </>
      );
    }
    case 5: // DateTime
      return (
        <DatePicker
          value={typeof value === 'number' ? value : undefined}
          format="yyyy-MM-dd HH:mm"
          placeholder={placeholder || '选择日期时间'}
          style={{ width: '100%' }}
          onChange={(v) => {
            const d = Array.isArray(v) ? v[0] : v;
            if (d instanceof Date && !Number.isNaN(d.getTime())) {
              onChange(d.getTime());
            } else if (typeof d === 'string' && d) {
              const t = Date.parse(d.replace(/-/g, '/'));
              onChange(Number.isNaN(t) ? '' : t);
            } else {
              onChange('');
            }
          }}
        />
      );
    case 1001: // CreatedTime（创建时间，只读字段，仅用于筛选）
    case 1002: // ModifiedTime（修改时间，只读字段，仅用于筛选）
      return (
        <DatePicker
          value={typeof value === 'number' ? value : undefined}
          format="yyyy-MM-dd"
          placeholder={placeholder || '选择日期'}
          style={{ width: '100%' }}
          onChange={(v) => {
            const d = Array.isArray(v) ? v[0] : v;
            if (d instanceof Date && !Number.isNaN(d.getTime())) {
              onChange(d.getTime());
            } else if (typeof d === 'string' && d) {
              const t = Date.parse(d.replace(/-/g, '/'));
              onChange(Number.isNaN(t) ? '' : t);
            } else {
              onChange('');
            }
          }}
        />
      );
    case 7: // Checkbox
      return (
        <Checkbox checked={Boolean(value)} onChange={(e) => onChange(e.target.checked ? '是' : '')}>
          勾选 = 是
        </Checkbox>
      );
    case 11: // User（人员）
      return (
        <PersonEditor
          value={value as IOpenUser[] | undefined}
          options={buildUserOptions(users, currentUserId)}
          userById={userById}
          multiple={multipleUser}
          onChange={onChange}
        />
      );
    default: // Text / Phone / Url / Email
      return (
        <Input
          value={value as string}
          onChange={(v) => onChange(v)}
          placeholder={placeholder || '请输入内容'}
        />
      );
  }
}

/** 已选值不在数据表现有选项中时的提示（提示重选或清空，插件不会自动创建选项） */
function InvalidOptionHint({
  value,
  options,
  multiple,
}: {
  value: unknown;
  options: Array<{ id: string; name: string }>;
  multiple: boolean;
}) {
  const invalid = findInvalidOptions(value, options, multiple);
  if (!invalid.length) return null;
  return (
    <div className="hint-text" style={{ color: 'var(--semi-color-danger)', marginTop: 4 }}>
      选项「{invalid.join('、')}」已不在数据表中，请重新选择或清空。
    </div>
  );
}

function buildUserOptions(
  users: IOpenUser[],
  currentUserId?: string | null,
): Array<{ label: string; value: string }> {
  const opts: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  users.forEach((u) => {
    if (u.id && !seen.has(u.id)) {
      seen.add(u.id);
      opts.push({
        label: `${u.name || '未命名'}${u.email ? `（${u.email}）` : ''}${u.id === currentUserId ? ' ·当前用户' : ''}`,
        value: u.id,
      });
    }
  });
  if (currentUserId && !seen.has(currentUserId)) {
    opts.push({ label: `当前登录用户（${currentUserId}）`, value: currentUserId });
  }
  return opts;
}

interface PersonEditorProps {
  value?: IOpenUser[];
  options: Array<{ label: string; value: string }>;
  userById?: Map<string, IOpenUser>;
  multiple: boolean;
  onChange: (v: IOpenUser[]) => void;
}

/** 人员字段编辑器：从人员库选择（可多选）+ 按 open_id 手动添加兜底 */
function PersonEditor({ value, options, userById, multiple, onChange }: PersonEditorProps) {
  const [oidText, setOidText] = useState('');
  const current = Array.isArray(value) ? value.filter((u) => u && u.id) : [];
  const ids = current.map((u) => u.id!);

  const addByOid = () => {
    const newIds = oidText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^ou_[0-9a-zA-Z]+$/.test(s));
    if (!newIds.length) {
      Toast.warning('请输入以 ou_ 开头的 open_id（多个用逗号分隔）');
      return;
    }
    const merged = [...current];
    const seen = new Set(merged.map((u) => u.id));
    newIds.forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push({ id });
      }
    });
    onChange(merged);
    setOidText('');
    Toast.success(`已添加 ${newIds.length} 个人员`);
  };

  const removeUser = (id: string) => {
    onChange(current.filter((u) => u.id !== id));
  };

  return (
    <div>
      <Select
        multiple={multiple}
        value={multiple ? ids : ids[0]}
        optionList={options}
        filter
        onChange={(v) => {
          const arr = (Array.isArray(v) ? v : v ? [v] : []) as string[];
          const users = arr
            .map((id) => userById?.get(id))
            .filter((u): u is IOpenUser => Boolean(u));
          onChange(users);
        }}
        placeholder={multiple ? '选择人员（可多选）' : '选择人员'}
        style={{ width: '100%' }}
        maxTagCount={3}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <Input
          size="small"
          value={oidText}
          onChange={setOidText}
          placeholder="目标人员不在列表？输入 open_id（ou_开头，可逗号分隔多个）"
        />
        <Button size="small" onClick={addByOid}>
          添加
        </Button>
      </div>
      {current.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {current.map((u) => (
            <Tag
              key={u.id}
              closable
              size="small"
              onClose={() => removeUser(u.id!)}
              style={{ marginRight: 4, marginBottom: 4 }}
            >
              {u.name || u.email || u.id}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
