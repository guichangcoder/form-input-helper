import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { convertCellValue } from '../utils/convert';
import { describeError } from '../utils/errors';
import {
  collectUsersFromTable,
  getCurrentUserId,
  writeRecords,
} from '../utils/sdk';
import type { TableFormConfig } from '../utils/formConfig';
import { isWritableField } from '../utils/formConfig';
import FieldEditor from './FieldEditor';

interface FormFillerProps {
  table: ITable | null;
  tableName: string;
  fields: IFieldMeta[];
  config: TableFormConfig;
}

/** 用户填写视图：仅展示管理员配置为「显示」的字段，按配置顺序渲染 */
export default function FormFiller({ table, tableName, fields, config }: FormFillerProps) {
  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  /** 需要展示的字段（配置为显示且当前表中存在） */
  const visibleFields = useMemo(
    () =>
      config.fields
        .map((fc) => ({ fc, meta: fieldById.get(fc.fieldId) }))
        .filter((x): x is { fc: (typeof config.fields)[number]; meta: IFieldMeta } =>
          Boolean(x.fc.visible && x.meta),
        ),
    [config.fields, fieldById],
  );

  // 人员库（人员字段选择用）
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

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(0);

  // 管理员更新配置后清空未提交的内容
  useEffect(() => {
    setDraft({});
  }, [config]);

  const setValue = useCallback((fieldId: string, v: unknown) => {
    setDraft((d) => ({ ...d, [fieldId]: v }));
  }, []);

  /** 提交：只读字段取管理员固定值，其余取用户填写值，合并后新增一条记录 */
  const doSubmit = async () => {
    if (!table) return;
    const values: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const { fc, meta } of visibleFields) {
      // 不可填写字段（公式、查找引用、创建时间等）不参与写入
      if (!isWritableField(meta)) continue;

      if (fc.readOnly) {
        const raw = fc.fixedValue;
        if (raw === undefined || raw === null || raw === '') continue;
        const res = convertCellValue(raw, meta);
        if (!res.ok) errors.push(`「${meta.name}」的固定值配置有误：${res.error}`);
        else if (!res.skip) values[meta.id] = res.value;
        continue;
      }

      const raw = draft[fc.fieldId];
      const isEmpty =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        (Array.isArray(raw) && raw.length === 0);
      if (isEmpty) {
        if (fc.required) errors.push(`「${meta.name}」为必填项`);
        continue;
      }
      const res = convertCellValue(raw, meta);
      if (!res.ok) errors.push(`「${meta.name}」：${res.error}`);
      else if (!res.skip) values[meta.id] = res.value;
    }

    if (errors.length) {
      Toast.error(errors.join('\n'));
      return;
    }
    const fieldIds = Object.keys(values);
    if (!fieldIds.length) {
      Toast.warning('请至少填写一个字段');
      return;
    }

    setSubmitting(true);
    try {
      const res = await writeRecords(table, [values], fieldIds);
      if (res.success > 0) {
        setSubmitted((n) => n + 1);
        setDraft({});
        Toast.success(`已提交 1 条记录到「${tableName}」`);
      } else {
        const msg = res.errors[0]?.message || '写入失败';
        Toast.error(describeError(new Error(msg), msg));
      }
    } catch (e) {
      Toast.error(describeError(e, `提交失败：${(e as Error).message || e}`));
    } finally {
      setSubmitting(false);
    }
  };

  if (!visibleFields.length) {
    return (
      <div className="empty-tip">
        管理员尚未在该数据表中配置可填写的字段。
        <br />
        <span className="hint-text">请管理员在「表单配置」中设置字段后重试。</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{config.title || '表单填写'}</div>
        {config.description && (
          <div className="hint-text" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
            {config.description}
          </div>
        )}
      </div>

      {visibleFields.map(({ fc, meta }) => {
        const writable = isWritableField(meta);
        const readOnly = !writable || fc.readOnly;
        return (
          <div key={meta.id} className="form-field">
            <div className="form-field-label" title={meta.name}>
              {meta.name}
              {writable && fc.required && !fc.readOnly && (
                <span className="form-field-required">*</span>
              )}
              {!writable ? (
                <Tag size="small" color="grey" style={{ marginLeft: 6 }}>
                  不可填写
                </Tag>
              ) : (
                fc.readOnly && (
                  <Tag size="small" color="grey" style={{ marginLeft: 6 }}>
                    只读
                  </Tag>
                )
              )}
            </div>
            <div className="form-field-control">
              {readOnly ? (
                <div className="form-readonly-value">
                  {writable
                    ? displayText(meta, fc.fixedValue) || '（未设置）'
                    : '（该字段不支持在此表单中填写）'}
                </div>
              ) : (
                <FieldEditor
                  field={meta}
                  value={draft[meta.id]}
                  onChange={(v) => setValue(meta.id, v)}
                  users={users}
                  currentUserId={currentUserId}
                  userById={userById}
                  multipleUser={(meta.property as { multiple?: boolean } | null)?.multiple !== false}
                />
              )}
            </div>
          </div>
        );
      })}

      <div className="footer-bar">
        <Button
          theme="solid"
          block
          onClick={doSubmit}
          loading={submitting}
          disabled={submitting}
        >
          提交到表「{tableName}」
        </Button>
        <div className="hint-text" style={{ marginTop: 4 }}>
          提交后表单会清空，可继续录入下一条。
          {submitted > 0 && `本次已提交 ${submitted} 条。`}
        </div>
      </div>
    </div>
  );
}

/** 只读字段的展示文本 */
function displayText(meta: IFieldMeta, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (Array.isArray(raw)) {
    return raw
      .map((x) =>
        x && typeof x === 'object'
          ? (x as IOpenUser).name || (x as IOpenUser).email || (x as IOpenUser).id || ''
          : String(x),
      )
      .filter(Boolean)
      .join('、');
  }
  if (meta.type === 7) return raw ? '是' : '否';
  if ((meta.type === 5 || meta.type === 1001 || meta.type === 1002) && typeof raw === 'number') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
        d.getMinutes(),
      )}`;
    }
  }
  return String(raw);
}
