import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Progress, Select, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { BATCH_SIZE, FIELD_TYPE_LABEL } from '../constants';
import { convertCellValue } from '../utils/convert';
import {
  collectUsersFromTable,
  getCurrentUserId,
  writeRecords,
} from '../utils/sdk';
import { isWritableField, type FormFieldConfig, type TableFormConfig } from '../utils/formConfig';
import FieldEditor from './FieldEditor';
import { describeError } from '../utils/errors';

interface FixedValueInputProps {
  table: ITable | null;
  tableName: string;
  /** 当前视图可见字段 */
  fields: IFieldMeta[];
  /** 管理员表单配置（未配置时为 null，此时按字段默认口径展示） */
  config: TableFormConfig | null;
}

/** 字段是否被锁定：字段类型不可填写，或管理员配置为只读（值由管理员固定） */
function isLockedField(fc: FormFieldConfig | null, meta: IFieldMeta): boolean {
  return !isWritableField(meta) || Boolean(fc && fc.readOnly);
}

/** 只读字段的展示文本 */
function readonlyText(meta: IFieldMeta, raw: unknown): string {
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
  return String(raw);
}

/** 固定值配置 */
interface FixedFieldConfig {
  fieldId: string;
  /** 固定值的原始输入（字符串/数字/布尔等） */
  rawValue: unknown;
}

/** 已添加的录入行（已转换） */
interface EnteredRow {
  key: number;
  /** fieldId -> SDK 可写值 */
  values: Record<string, unknown>;
  /** 展示文本 */
  display: string;
}

export default function FixedValueInput({ table, tableName, fields, config }: FixedValueInputProps) {
  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  /** 应用管理员配置后的字段清单：仅保留配置为「显示」的字段，顺序按配置顺序 */
  const configuredFields = useMemo<Array<{ meta: IFieldMeta; fc: FormFieldConfig | null }>>(() => {
    if (!config) return fields.map((f) => ({ meta: f, fc: null }));
    return config.fields
      .map((fc) => ({ fc, meta: fieldById.get(fc.fieldId) }))
      .filter((x): x is { fc: FormFieldConfig; meta: IFieldMeta } =>
        Boolean(x.fc.visible && x.meta),
      );
  }, [config, fields, fieldById]);

  /** 管理员锁定的字段：值由管理员配置固定，用户不可改（写入时自动带上） */
  const lockedFields = useMemo(
    () => configuredFields.filter((x) => isLockedField(x.fc, x.meta)),
    [configuredFields],
  );

  /** 用户可操作的字段（可填写且未被管理员锁定） */
  const supportedFields = useMemo(
    () =>
      configuredFields.filter((x) => !isLockedField(x.fc, x.meta)).map((x) => x.meta),
    [configuredFields],
  );

  /** 管理员配置为必填的字段 ID */
  const requiredIds = useMemo(
    () =>
      new Set(
        configuredFields
          .filter((x) => x.fc?.required && !isLockedField(x.fc, x.meta))
          .map((x) => x.meta.id),
      ),
    [configuredFields],
  );

  // 人员库：本表已出现过的人员 + 当前登录用户
  const [users, setUsers] = useState<IOpenUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [scanningUsers, setScanningUsers] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!table) return;
    setScanningUsers(true);
    try {
      const [list, uid] = await Promise.all([collectUsersFromTable(table), getCurrentUserId()]);
      setUsers(list);
      setCurrentUserId(uid);
    } catch (e) {
      console.error('读取人员字段失败', e);
      Toast.error(describeError(e, '读取人员字段失败，请刷新重试'));
    } finally {
      setScanningUsers(false);
    }
  }, [table]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const userOptions = useMemo(() => {
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
      opts.push({ label: '当前登录用户（' + currentUserId + '）', value: currentUserId });
    }
    return opts;
  }, [users, currentUserId]);

  const userById = useMemo(() => {
    const m = new Map<string, IOpenUser>();
    users.forEach((u) => u.id && m.set(u.id, u));
    if (currentUserId) m.set(currentUserId, { id: currentUserId });
    return m;
  }, [users, currentUserId]);

  const [fixedFields, setFixedFields] = useState<FixedFieldConfig[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<EnteredRow[]>([]);
  const [keySeq, setKeySeq] = useState(1);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ success: number; errors: Array<{ index: number; message: string }> } | null>(null);

  /** 供录入的字段 = 支持字段 - 已选固定字段 */
  const editableFields = useMemo(
    () => supportedFields.filter((f) => !fixedFields.some((x) => x.fieldId === f.id)),
    [supportedFields, fixedFields],
  );

  // 管理员修改配置后，丢弃已隐藏/已被锁定字段上残留的草稿与固定值设置
  useEffect(() => {
    const allowed = new Set(supportedFields.map((f) => f.id));
    setFixedFields((arr) => {
      const next = arr.filter((x) => allowed.has(x.fieldId));
      return next.length === arr.length ? arr : next;
    });
    setDraft((d) => {
      const next: Record<string, unknown> = {};
      Object.keys(d).forEach((k) => {
        if (allowed.has(k)) next[k] = d[k];
      });
      return next;
    });
  }, [supportedFields]);

  /** 添加一个固定值字段 */
  const addFixedField = (fieldId: string) => {
    if (!fieldId || fixedFields.some((x) => x.fieldId === fieldId)) return;
    setFixedFields((arr) => [...arr, { fieldId, rawValue: '' }]);
  };

  const removeFixedField = (fieldId: string) => {
    setFixedFields((arr) => arr.filter((x) => x.fieldId !== fieldId));
  };

  const updateFixedRaw = (fieldId: string, rawValue: unknown) => {
    setFixedFields((arr) => arr.map((x) => (x.fieldId === fieldId ? { ...x, rawValue } : x)));
  };

  /** 构建写入记录：固定值 + 录入行值 */
  const buildRecords = useCallback(() => {
    const records: Array<Record<string, unknown>> = [];
    const issues: Array<{ index: number; message: string }> = [];

    // 固定值先转换一次（缓存）
    const fixedConverted: Record<string, unknown> = {};
    for (const fc of fixedFields) {
      const meta = fieldById.get(fc.fieldId);
      if (!meta) continue;
      const res = convertCellValue(fc.rawValue, meta);
      if (!res.ok) {
        issues.push({ index: -1, message: `固定字段「${meta.name}」：${res.error}` });
      } else if (!res.skip) {
        fixedConverted[fc.fieldId] = res.value;
      }
    }

    // 管理员锁定的字段（只读固定值）：自动为每条记录带上
    for (const { meta, fc } of lockedFields) {
      if (!isWritableField(meta)) continue;
      const raw = fc?.fixedValue;
      if (raw === undefined || raw === null || raw === '') continue;
      const res = convertCellValue(raw, meta);
      if (!res.ok) {
        issues.push({ index: -1, message: `管理员固定字段「${meta.name}」：${res.error}` });
      } else if (!res.skip) {
        fixedConverted[meta.id] = res.value;
      }
    }

    rows.forEach((row, idx) => {
      records.push({ ...fixedConverted, ...row.values });
      void idx;
    });
    return { records, issues };
  }, [fixedFields, rows, fieldById, lockedFields]);

  /** 校验当前草稿行并加入列表 */
  const addRow = () => {
    if (!editableFields.length) {
      Toast.warning('当前表没有可录入的字段（或所有字段都设为固定值）');
      return;
    }
    const values: Record<string, unknown> = {};
    const errs: string[] = [];
    for (const f of editableFields) {
      const raw = draft[f.id];
      const isEmpty =
        raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (isEmpty) {
        // 管理员在「表单配置」中设为必填的字段，录入时必须填写
        if (requiredIds.has(f.id)) errs.push(`${f.name}：管理员已设为必填项`);
        continue;
      }
      const res = convertCellValue(raw, f);
      if (!res.ok) {
        errs.push(`${f.name}：${res.error}`);
      } else if (!res.skip) {
        values[f.id] = res.value;
      }
    }
    if (errs.length) {
      Toast.error(`存在格式问题：\n${errs.join('\n')}`);
      return;
    }
    if (!Object.keys(values).length) {
      Toast.warning('请至少填写一个字段');
      return;
    }
    // 展示文本
    const formatValue = (f: IFieldMeta, v: unknown) => {
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === 'object' && (v[0] as IOpenUser).id !== undefined) {
          return (v as IOpenUser[]).map((u) => u.name || u.email || u.id).join('、');
        }
        return (v as string[]).join('、');
      }
      return String(v);
    };
    const parts = editableFields
      .filter((f) => values[f.id] !== undefined)
      .map((f) => `${f.name}: ${formatValue(f, values[f.id])}`);
    setRows((arr) => [...arr, { key: keySeq, values, display: parts.join(' | ') }]);
    setKeySeq((k) => k + 1);
    setDraft({});
  };

  const removeRow = (key: number) => {
    setRows((arr) => arr.filter((r) => r.key !== key));
  };

  const clearRows = () => {
    setRows([]);
    setResult(null);
  };

  /** 执行批量写入 */
  const doWrite = async () => {
    if (!table) return;
    const { records, issues } = buildRecords();
    if (issues.length) {
      Toast.error(issues.map((i) => i.message).join('\n'));
      return;
    }
    if (!records.length) {
      Toast.warning('暂无记录可写入，请先添加录入行');
      return;
    }
    const fieldIds = Array.from(
      new Set([
        ...fixedFields.map((f) => f.fieldId),
        ...editableFields.map((f) => f.id),
        ...lockedFields.filter((x) => isWritableField(x.meta)).map((x) => x.meta.id),
      ]),
    );

    setImporting(true);
    setProgress({ done: 0, total: records.length });
    setResult(null);
    try {
      const res = await writeRecords(table, records, fieldIds, (done, total) =>
        setProgress({ done, total }),
      );
      setResult({ success: res.success, errors: res.errors });
      Toast.success(`写入完成：成功 ${res.success} 条${res.errors.length ? `，失败 ${res.errors.length} 条` : ''}`);
      if (res.errors.length === 0) {
        setRows([]);
        setDraft({});
      }
    } catch (err) {
      Toast.error(describeError(err, `写入失败：${(err as Error).message || err}`));
    } finally {
      setImporting(false);
    }
  };

  /** 按字段类型渲染值编辑器（统一使用 FieldEditor） */
  const renderEditor = (
    field: IFieldMeta,
    value: unknown,
    onChange: (v: unknown) => void,
  ) => {
    return (
      <FieldEditor
        field={field}
        value={value}
        onChange={onChange}
        users={users}
        currentUserId={currentUserId}
        userById={userById}
        multipleUser={(field.property as { multiple?: boolean } | null)?.multiple !== false}
      />
    );
  };

  const fixedSelectOptions = useMemo(
    () =>
      supportedFields.map((f) => ({
        label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}）${requiredIds.has(f.id) ? ' *必填' : ''}`,
        value: f.id,
      })),
    [supportedFields, requiredIds],
  );
  const availableFixedOptions = fixedSelectOptions.filter(
    (o) => !fixedFields.some((x) => x.fieldId === o.value),
  );

  return (
    <div>
      <div className="block-title">
        1. 配置固定值字段
        <Button
          size="small"
          style={{ marginLeft: 12 }}
          onClick={loadUsers}
          loading={scanningUsers}
          disabled={importing}
        >
          刷新人员
        </Button>
      </div>
      <div className="hint-text" style={{ marginBottom: 8 }}>
        字段的显示/隐藏、必填、只读均跟随管理员在「表单配置」中的设置：不可见字段不会出现在此处，
        管理员设为只读的字段会以固定值自动写入。
        <br />
        为固定字段填写一个值后，每条录入记录都会自动带上该值；支持多个固定字段。
        <br />
        人员字段：从本表已出现的人员中选择（含当前登录用户），也可按 open_id 手动添加。
      </div>

      {fixedFields.map((fc) => {
        const meta = fieldById.get(fc.fieldId);
        if (!meta) return null;
        return (
          <div key={fc.fieldId} className="fixed-field-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Tag color="blue">
                {meta.name}
                {requiredIds.has(meta.id) && (
                  <span style={{ color: 'var(--semi-color-danger)' }}> *</span>
                )}
              </Tag>
              <span className="hint-text">= 固定值</span>
              <Button
                size="small"
                theme="borderless"
                type="danger"
                onClick={() => removeFixedField(fc.fieldId)}
                disabled={importing}
              >
                移除
              </Button>
            </div>
            {renderEditor(meta, fc.rawValue, (v) => updateFixedRaw(fc.fieldId, v))}
          </div>
        );
      })}

      {lockedFields.map(({ meta, fc }) => (
        <div key={meta.id} className="fixed-field-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="blue">{meta.name}</Tag>
            <Tag size="small" color="grey">{isWritableField(meta) ? '只读' : '不可填写'}</Tag>
            <span className="hint-text" style={{ flex: 1, textAlign: 'right' }}>
              {isWritableField(meta)
                ? readonlyText(meta, fc?.fixedValue) || '（未设置固定值）'
                : '由多维表格自动生成'}
            </span>
          </div>
        </div>
      ))}

      {availableFixedOptions.length > 0 && (
        <Select
          optionList={availableFixedOptions}
          placeholder="+ 添加固定值字段…"
          style={{ width: '100%' }}
          onChange={(v) => {
            if (typeof v === 'string') addFixedField(v);
          }}
          value={undefined}
        />
      )}

      <div className="block-title" style={{ marginTop: 16 }}>2. 录入记录（填写其余字段）</div>
      {editableFields.length === 0 ? (
        <div className="empty-tip">
          没有可录入的字段。
          <br />
          <span className="hint-text">
            可能是全部字段已被设为固定值或只读，也可能是管理员在「表单配置」中隐藏了字段。
          </span>
        </div>
      ) : (
        <>
          {editableFields.map((f) => (
            <div key={f.id} className="row-item">
              <div className="label" title={f.name}>
                {f.name}
                {requiredIds.has(f.id) && (
                  <span style={{ color: 'var(--semi-color-danger)' }}> *</span>
                )}
              </div>
              <div className="control">{renderEditor(f, draft[f.id], (v) => setDraft((d) => ({ ...d, [f.id]: v })))}</div>
            </div>
          ))}
          <Button theme="solid" block onClick={addRow} disabled={importing}>
            添加此条记录（已添加 {rows.length} 条）
          </Button>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="block-title" style={{ marginTop: 16 }}>
            3. 待写入记录（{rows.length} 条）
            <Button size="small" theme="borderless" onClick={clearRows} disabled={importing}>
              清空
            </Button>
          </div>
          <div style={{ maxHeight: 220, overflow: 'auto', marginBottom: 8 }}>
            {rows.map((r) => (
              <div key={r.key} className="mapping-row">
                <span style={{ flex: 1, fontSize: 12 }}>{r.display}</span>
                <Button size="small" theme="borderless" type="danger" onClick={() => removeRow(r.key)} disabled={importing}>
                  删除
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="footer-bar">
        {importing && (
          <div style={{ marginBottom: 8 }}>
            <Progress
              percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
              showInfo
            />
          </div>
        )}
        <Button
          theme="solid"
          block
          onClick={doWrite}
          disabled={importing || rows.length === 0}
          loading={importing}
        >
          写入 {rows.length} 条记录到表「{tableName}」
        </Button>
        <div className="hint-text" style={{ marginTop: 4 }}>
          每批 {BATCH_SIZE} 条写入；固定字段值与录入字段值合并后生成记录。
        </div>
        {result && (
          <div className="result-box">
            <div style={{ color: '#2f9e44', fontWeight: 600 }}>✅ 写入完成：成功 {result.success} 条</div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
                <div style={{ color: '#c0392b', fontWeight: 600 }}>失败明细：</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.errors.slice(0, 30).map((it, idx) => (
                    <li key={idx}>第 {it.index + 1} 条：{it.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
