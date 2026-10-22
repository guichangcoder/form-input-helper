import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Progress, Select, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { BATCH_SIZE, FIELD_TYPE_LABEL, WRITABLE_FIELD_TYPES } from '../constants';
import { convertCellValue } from '../utils/convert';
import {
  collectSelectValues,
  collectUsersFromTable,
  ensureSelectOptions,
  getCurrentUserId,
  writeRecords,
} from '../utils/sdk';
import FieldEditor from './FieldEditor';

interface FixedValueInputProps {
  table: ITable | null;
  tableName: string;
  fields: IFieldMeta[];
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

export default function FixedValueInput({ table, tableName, fields }: FixedValueInputProps) {
  const supportedFields = useMemo(
    () => fields.filter((f) => WRITABLE_FIELD_TYPES.includes(f.type as number)),
    [fields],
  );
  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

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
      Toast.error('读取人员字段失败，请刷新重试');
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

    rows.forEach((row, idx) => {
      records.push({ ...fixedConverted, ...row.values });
      void idx;
    });
    return { records, issues };
  }, [fixedFields, rows, fieldById]);

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
      // 空值允许跳过
      if (raw === undefined || raw === null || raw === '') continue;
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
      ]),
    );
    const selectFieldIds = fieldIds.filter(
      (fid) => (fieldById.get(fid)!.type as number) === 3 || (fieldById.get(fid)!.type as number) === 4,
    );

    setImporting(true);
    setProgress({ done: 0, total: records.length });
    setResult(null);
    try {
      for (const fid of selectFieldIds) {
        const field = await table.getField(fid);
        const values = collectSelectValues(records, fid);
        await ensureSelectOptions(field as never, values);
      }
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
      Toast.error(`写入失败：${(err as Error).message}`);
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
    () => supportedFields.map((f) => ({ label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}）`, value: f.id })),
    [supportedFields],
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
              <Tag color="blue">{meta.name}</Tag>
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
        <div className="empty-tip">所有字段已设为固定值，无法录入其他内容</div>
      ) : (
        <>
          {editableFields.map((f) => (
            <div key={f.id} className="row-item">
              <div className="label" title={f.name}>
                {f.name}
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
