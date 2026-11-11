import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Progress, Radio, RadioGroup, Select, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, IRecord, ITable } from '@lark-base-open/js-sdk';
import { BATCH_SIZE, FIELD_TYPE_LABEL, WRITABLE_FIELD_TYPES } from '../constants';
import { convertCellValue } from '../utils/convert';
import { collectUsersFromTable, ensureSelectOptions, getCurrentUserId } from '../utils/sdk';
import {
  cellText,
  cellToRawValue,
  matchCell,
  operatorsForField,
  recordDisplayText,
  type MatchOperator,
} from '../utils/match';
import FieldEditor from './FieldEditor';
import { describeError } from '../utils/errors';

interface RecordUpdaterProps {
  table: ITable | null;
  tableName: string;
  fields: IFieldMeta[];
}

/** 筛选条件草稿 */
interface CondDraft {
  key: number;
  fieldId: string;
  operator: MatchOperator;
  rawValue: unknown;
}

/** 字段修改草稿：rawValue 为 '' 且未勾选清空时保持原样 */
interface FieldDraft {
  rawValue: unknown;
  clear: boolean;
}

/** 修改模式：row=逐条修改，bulk=统一修改 */
type UpdateMode = 'row' | 'bulk';

/** 全表扫描记录上限 */
const MAX_SCAN = 10000;
/** 逐条修改最多渲染的记录数（超出部分仍会被更新，但仅提示） */
const MAX_ROW_EDIT = 100;

export default function RecordUpdater({ table, tableName, fields }: RecordUpdaterProps) {
  const writableFields = useMemo(
    () => fields.filter((f) => WRITABLE_FIELD_TYPES.includes(f.type as number)),
    [fields],
  );
  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);
  const primaryField = useMemo(() => fields.find((f) => f.isPrimary), [fields]);

  // 人员库
  const [users, setUsers] = useState<IOpenUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [scanningUsers, setScanningUsers] = useState(false);
  const userById = useMemo(() => {
    const m = new Map<string, IOpenUser>();
    users.forEach((u) => u.id && m.set(u.id, u));
    if (currentUserId) m.set(currentUserId, { id: currentUserId });
    return m;
  }, [users, currentUserId]);

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

  // 筛选
  const [conds, setConds] = useState<CondDraft[]>([]);
  const [condSeq, setCondSeq] = useState(1);
  const [querying, setQuerying] = useState(false);
  const [matched, setMatched] = useState<IRecord[]>([]);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);

  // 修改设置
  const [mode, setMode] = useState<UpdateMode>('row');
  const [updateFieldIds, setUpdateFieldIds] = useState<string[]>([]);
  /** 统一修改：fieldId -> 草稿 */
  const [bulkUpdates, setBulkUpdates] = useState<Record<string, FieldDraft>>({});
  /** 逐条修改：recordId -> (fieldId -> 草稿) */
  const [rowDrafts, setRowDrafts] = useState<Record<string, Record<string, FieldDraft>>>({});

  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ success: number; errors: Array<{ index: number; message: string }> } | null>(null);

  const addCond = (fieldId: string) => {
    if (!fieldId || conds.some((c) => c.fieldId === fieldId)) return;
    const meta = fieldById.get(fieldId);
    if (!meta) return;
    setConds((arr) => [
      ...arr,
      { key: condSeq, fieldId, operator: operatorsForField(meta)[0].value, rawValue: '' },
    ]);
    setCondSeq((k) => k + 1);
  };

  const removeCond = (key: number) => setConds((arr) => arr.filter((c) => c.key !== key));

  const updateCond = (key: number, patch: Partial<CondDraft>) => {
    setConds((arr) => arr.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  /** 按条件查询匹配记录（本地拉取全表后匹配） */
  const runFilter = async () => {
    if (!table) return;
    if (!conds.length) {
      Toast.warning('请先添加至少一个筛选条件');
      return;
    }
    setQuerying(true);
    setMatched([]);
    setResult(null);
    setRowDrafts({});
    try {
      const conditions: Array<{
        fieldId: string;
        fieldMeta: IFieldMeta;
        operator: MatchOperator;
        rawValue: unknown;
      }> = [];
      conds.forEach((c) => {
        if (c.rawValue === '' || c.rawValue == null) return;
        const fieldMeta = fieldById.get(c.fieldId);
        if (!fieldMeta) return; // 字段缺失/无权限：跳过该条件
        conditions.push({
          fieldId: c.fieldId,
          fieldMeta,
          operator: c.operator,
          rawValue: c.rawValue,
        });
      });
      if (!conditions.length) {
        Toast.warning('筛选条件值不能为空');
        setQuerying(false);
        return;
      }
      const hits: IRecord[] = [];
      let pageToken: string | undefined;
      let scannedCount = 0;
      let totalCount = 0;
      for (;;) {
        const res = await table.getRecords({ pageSize: 500, pageToken });
        totalCount = res.total;
        for (const rec of res.records) {
          const ok = conditions.every((cond) => matchCell(rec.fields[cond.fieldId], cond));
          if (ok) hits.push(rec);
        }
        scannedCount += res.records.length;
        if (!res.hasMore || !res.pageToken || scannedCount >= MAX_SCAN) break;
        pageToken = res.pageToken;
      }
      setMatched(hits);
      setScanned(Math.min(scannedCount, MAX_SCAN));
      setTotal(totalCount);
      Toast.success(`匹配到 ${hits.length} 条记录（已扫描 ${Math.min(scannedCount, MAX_SCAN)} / ${totalCount} 条）`);
    } catch (e) {
      Toast.error(describeError(e, `查询失败：${(e as Error).message}`));
    } finally {
      setQuerying(false);
    }
  };

  /** 已选修改字段变化时同步统一修改草稿 */
  const updateFieldOptions = useMemo(
    () => writableFields.map((f) => ({ label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}）`, value: f.id })),
    [writableFields],
  );

  const handleFieldIdsChange = (v: unknown) => {
    const arr = (Array.isArray(v) ? v : v ? [v] : []) as string[];
    setUpdateFieldIds(arr);
    setBulkUpdates((prev) => {
      const next: Record<string, FieldDraft> = {};
      arr.forEach((fid) => {
        next[fid] = prev[fid] ?? { rawValue: '', clear: false };
      });
      return next;
    });
  };

  const updateBulk = (fieldId: string, patch: Partial<FieldDraft>) => {
    setBulkUpdates((prev) => ({
      ...prev,
      [fieldId]: { ...(prev[fieldId] ?? { rawValue: '', clear: false }), ...patch },
    }));
  };

  const updateRow = (recordId: string, fieldId: string, patch: Partial<FieldDraft>) => {
    setRowDrafts((prev) => {
      const rec = { ...(prev[recordId] ?? {}) };
      rec[fieldId] = { ...(rec[fieldId] ?? { rawValue: '', clear: false }), ...patch };
      return { ...prev, [recordId]: rec };
    });
  };

  /** 命中记录变化或修改字段变化时，预填逐条修改草稿（现值） */
  useEffect(() => {
    if (mode !== 'row') return;
    const drafts: Record<string, Record<string, FieldDraft>> = {};
    matched.forEach((rec) => {
      const recDraft: Record<string, FieldDraft> = {};
      updateFieldIds.forEach((fid) => {
        const meta = fieldById.get(fid);
        if (!meta) return;
        recDraft[fid] = { rawValue: cellToRawValue(rec.fields[fid], meta), clear: false };
      });
      drafts[rec.recordId] = recDraft;
    });
    setRowDrafts(drafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, updateFieldIds, mode]);

  /** 收集单选/多选字段将出现的新选项并创建 */
  const ensureAllSelectOptions = async () => {
    if (!table) return;
    const selectIds = updateFieldIds.filter((fid) => {
      const t = fieldById.get(fid)?.type;
      return t === 3 || t === 4;
    });
    for (const fid of selectIds) {
      const meta = fieldById.get(fid);
      if (!meta) continue; // 字段缺失/无权限：跳过
      const field = await table.getField(fid);
      const values = new Set<string>();
      if (mode === 'bulk') {
        const d = bulkUpdates[fid];
        if (d && !d.clear) {
          const v = convertCellValue(d.rawValue, meta).value;
          if (Array.isArray(v)) (v as string[]).forEach((x) => values.add(x));
          else if (v != null) values.add(String(v));
        }
      } else {
        Object.values(rowDrafts).forEach((rec) => {
          const d = rec[fid];
          if (!d || d.clear) return;
          const v = convertCellValue(d.rawValue, meta).value;
          if (Array.isArray(v)) (v as string[]).forEach((x) => values.add(x));
          else if (v != null) values.add(String(v));
        });
      }
      if (values.size) await ensureSelectOptions(field as never, Array.from(values));
    }
  };

  /** 构建单条记录的新字段值（row 模式） */
  const buildRowFields = (rec: IRecord): { fields: Record<string, unknown>; errors: string[] } => {
    const fieldsOut: Record<string, unknown> = {};
    const errors: string[] = [];
    const recDraft = rowDrafts[rec.recordId];
    updateFieldIds.forEach((fid) => {
      const meta = fieldById.get(fid);
      if (!meta) return;
      const d = recDraft?.[fid];
      if (!d) return; // 未初始化：保持原样
      if (d.clear) {
        fieldsOut[fid] = null;
        return;
      }
      const res = convertCellValue(d.rawValue, meta);
      if (res.ok && !res.skip) fieldsOut[fid] = res.value;
      else if (!res.ok) errors.push(`${meta.name}：${res.error}`);
    });
    return { fields: fieldsOut, errors };
  };

  /** 构建统一修改的单条记录新字段值 */
  const buildBulkFields = (): { fields: Record<string, unknown>; errors: string[] } => {
    const fieldsOut: Record<string, unknown> = {};
    const errors: string[] = [];
    updateFieldIds.forEach((fid) => {
      const meta = fieldById.get(fid);
      if (!meta) return;
      const d = bulkUpdates[fid];
      if (!d) return;
      if (d.clear) {
        fieldsOut[fid] = null;
        return;
      }
      const res = convertCellValue(d.rawValue, meta);
      if (res.ok && !res.skip) fieldsOut[fid] = res.value;
      else if (!res.ok) errors.push(`${meta.name}：${res.error}`);
    });
    return { fields: fieldsOut, errors };
  };

  /** 执行更新 */
  const doUpdate = async () => {
    if (!table) return;
    if (!updateFieldIds.length) {
      Toast.warning('请先选择要修改的字段');
      return;
    }
    if (!matched.length) {
      Toast.warning('请先查询匹配记录');
      return;
    }
    if (mode === 'row') {
      // 逐条模式校验：至少一条记录有实际修改
      const hasEdits = matched.some((rec) => {
        const recDraft = rowDrafts[rec.recordId];
        if (!recDraft) return false;
        return updateFieldIds.some((fid) => {
          const d = recDraft[fid];
          return d && (d.clear || (d.rawValue !== '' && d.rawValue != null));
        });
      });
      if (!hasEdits) {
        Toast.warning('尚未编辑任何记录（或修改内容为空），请先在各记录中填写新值');
        return;
      }
    }

    setUpdating(true);
    setProgress({ done: 0, total: matched.length });
    setResult(null);
    try {
      await ensureAllSelectOptions();

      const allErrors: Array<{ index: number; message: string }> = [];
      const payloads: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
      if (mode === 'row') {
        matched.forEach((rec, idx) => {
          const { fields: f, errors } = buildRowFields(rec);
          errors.forEach((m) => allErrors.push({ index: idx, message: m }));
          payloads.push({ recordId: rec.recordId, fields: f });
        });
      } else {
        const { fields: f, errors } = buildBulkFields();
        errors.forEach((m) => allErrors.push({ index: -1, message: m }));
        if (!Object.keys(f).length) {
          Toast.warning('没有可更新的字段（请填写新值或勾选清空）');
          setUpdating(false);
          return;
        }
        matched.forEach((rec) => payloads.push({ recordId: rec.recordId, fields: { ...f } }));
      }

      const errors2: Array<{ index: number; message: string }> = [];
      let success = 0;
      for (let start = 0; start < payloads.length; start += BATCH_SIZE) {
        const chunk = payloads.slice(start, start + BATCH_SIZE);
        try {
          await table.setRecords(chunk as never);
          success += chunk.length;
        } catch (e) {
          for (let i = 0; i < chunk.length; i++) {
            try {
              await table.setRecords([chunk[i]] as never);
              success++;
            } catch (e2) {
              errors2.push({ index: start + i, message: `写入失败：${(e2 as Error).message || e2}` });
            }
          }
        }
        setProgress({ done: Math.min(start + BATCH_SIZE, payloads.length), total: payloads.length });
      }
      const all = [...allErrors, ...errors2];
      setResult({ success, errors: all });
      Toast.success(`更新完成：成功 ${success} 条${all.length ? `，失败 ${all.length} 条` : ''}`);
    } catch (e) {
      Toast.error(describeError(e, `更新失败：${(e as Error).message}`));
    } finally {
      setUpdating(false);
    }
  };

  const condFieldOptions = useMemo(
    () => writableFields.map((f) => ({ label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}）`, value: f.id })),
    [writableFields],
  );
  const availableCondOptions = condFieldOptions.filter((o) => !conds.some((c) => c.fieldId === o.value));

  const renderEditor = (
    field: IFieldMeta,
    value: unknown,
    onChange: (v: unknown) => void,
  ) => (
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

  const editableCount = Math.min(matched.length, MAX_ROW_EDIT);

  return (
    <div>
      <div className="block-title">
        1. 筛选条件（全部满足才命中）
        <Button size="small" style={{ marginLeft: 12 }} onClick={loadUsers} loading={scanningUsers} disabled={querying || updating}>
          刷新人员
        </Button>
      </div>
      <div className="hint-text" style={{ marginBottom: 8 }}>
        基于字段值筛选已有记录，条件之间为「并且」关系；文本支持等于/包含，数字与日期支持比较。
      </div>

      {conds.map((c) => {
        const meta = fieldById.get(c.fieldId);
        if (!meta) return null;
        return (
          <div key={c.key} className="fixed-field-card" style={{ background: 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Tag color="light-blue">{meta.name}</Tag>
              <Select
                size="small"
                value={c.operator}
                optionList={operatorsForField(meta)}
                style={{ width: 110 }}
                onChange={(v) => {
                  if (typeof v === 'string') updateCond(c.key, { operator: v as MatchOperator });
                }}
              />
              <Button size="small" theme="borderless" type="danger" onClick={() => removeCond(c.key)} disabled={querying || updating}>
                移除
              </Button>
            </div>
            {renderEditor(meta, c.rawValue, (v) => updateCond(c.key, { rawValue: v }))}
          </div>
        );
      })}
      {availableCondOptions.length > 0 && (
        <Select
          optionList={availableCondOptions}
          placeholder="+ 添加筛选条件…"
          style={{ width: '100%' }}
          onChange={(v) => {
            if (typeof v === 'string') addCond(v);
          }}
          value={undefined}
        />
      )}

      <div style={{ marginTop: 10 }}>
        <Button theme="solid" block onClick={runFilter} loading={querying} disabled={querying || updating}>
          查询匹配记录
        </Button>
        {total > 0 && (
          <div className="hint-text" style={{ marginTop: 4 }}>
            表内共 {total} 条记录，已扫描 {scanned} 条，命中 <b style={{ color: 'var(--semi-color-primary)' }}>{matched.length}</b> 条
            {scanned < total && '（超出扫描上限，仅扫描部分记录）'}
          </div>
        )}
      </div>

      <div className="block-title" style={{ marginTop: 16 }}>
        2. 修改设置
      </div>
      <RadioGroup type="button" value={mode} onChange={(e) => setMode(e.target.value as UpdateMode)} aria-label="修改模式">
        <Radio value="row">逐条修改</Radio>
        <Radio value="bulk">统一修改</Radio>
      </RadioGroup>
      <div className="hint-text" style={{ margin: '6px 0 10px' }}>
        {mode === 'row'
          ? '逐条修改：每条命中记录单独填写字段值（预填当前值，留空=保持原样）。'
          : '统一修改：所有命中记录统一写入相同的字段值。'}
      </div>

      {matched.length > 0 && (
        <Select
          multiple
          value={updateFieldIds}
          optionList={updateFieldOptions}
          placeholder="+ 选择要修改的字段（可多选）…"
          style={{ width: '100%', marginBottom: 10 }}
          maxTagCount={4}
          onChange={handleFieldIdsChange}
        />
      )}

      {mode === 'bulk' && matched.length > 0 && (
        <>
          <div className="hint-text" style={{ marginBottom: 6 }}>
            统一写入以下值到全部 {matched.length} 条命中记录：
          </div>
          {updateFieldIds.map((fid) => {
            const meta = fieldById.get(fid);
            if (!meta) return null;
            const d = bulkUpdates[fid] ?? { rawValue: '', clear: false };
            return (
              <div key={fid} className="fixed-field-card" style={{ background: 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Tag color="light-green">{meta.name}</Tag>
                  <span className="hint-text">= 更新为</span>
                  <Checkbox checked={d.clear} onChange={(e) => updateBulk(fid, { clear: e.target.checked })}>
                    清空该字段
                  </Checkbox>
                </div>
                {d.clear ? (
                  <div className="hint-text">执行更新时该字段将被清空（设为空值）</div>
                ) : (
                  renderEditor(meta, d.rawValue, (v) => updateBulk(fid, { rawValue: v }))
                )}
              </div>
            );
          })}
        </>
      )}

      {mode === 'row' && matched.length > 0 && (
        <>
          <div className="block-title" style={{ marginTop: 12 }}>
            3. 逐条修改明细（共 {matched.length} 条
            {matched.length > MAX_ROW_EDIT && `，逐条编辑前 ${MAX_ROW_EDIT} 条，其余保持原样`}
            ）
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto', marginBottom: 8 }}>
            {matched.slice(0, MAX_ROW_EDIT).map((rec, idx) => (
              <div key={rec.recordId} className="fixed-field-card" style={{ background: 'transparent' }}>
                <div className="label" style={{ marginBottom: 6 }}>
                  #{idx + 1} {recordDisplayText(rec.fields, primaryField, conds.map((c) => fieldById.get(c.fieldId)!).filter(Boolean))}
                </div>
                {updateFieldIds.length === 0 && (
                  <div className="hint-text">（尚未选择要修改的字段，请在上方选择）</div>
                )}
                {updateFieldIds.map((fid) => {
                  const meta = fieldById.get(fid);
                  if (!meta) return null;
                  const d = rowDrafts[rec.recordId]?.[fid] ?? { rawValue: '', clear: false };
                  return (
                    <div key={fid} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '6px 0' }}>
                      <span className="hint-text" style={{ width: 92, flexShrink: 0, paddingTop: 4 }} title={meta.name}>
                        {meta.name}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {d.clear ? (
                          <div className="hint-text" style={{ paddingTop: 4 }}>将清空该字段</div>
                        ) : (
                          renderEditor(meta, d.rawValue, (v) => updateRow(rec.recordId, fid, { rawValue: v }))
                        )}
                      </div>
                      <Checkbox
                        checked={d.clear}
                        onChange={(e) => updateRow(rec.recordId, fid, { clear: e.target.checked })}
                        style={{ flexShrink: 0, paddingTop: 4 }}
                      >
                        清空
                      </Checkbox>
                    </div>
                  );
                })}
              </div>
            ))}
            {matched.length > MAX_ROW_EDIT && (
              <div className="hint-text" style={{ padding: '4px 8px' }}>
                … 其余 {matched.length - MAX_ROW_EDIT} 条将保持原样（如需修改请使用「统一修改」或缩小筛选范围）
              </div>
            )}
          </div>
        </>
      )}

      <div className="footer-bar">
        {updating && (
          <div style={{ marginBottom: 8 }}>
            <Progress
              percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
              showInfo
            />
          </div>
        )}
        <Button
          theme="solid"
          type="primary"
          block
          onClick={doUpdate}
          loading={updating}
          disabled={querying || updating || !matched.length}
        >
          {mode === 'row' ? `更新 ${matched.length} 条记录（逐条，表「${tableName}」）` : `更新 ${matched.length} 条记录（统一值，表「${tableName}」）`}
        </Button>
        <div className="hint-text" style={{ marginTop: 4 }}>
          留空且未勾选「清空」的字段保持原样不动；单选/多选出现新选项时自动创建。
        </div>
        {result && (
          <div className="result-box">
            <div style={{ color: '#2f9e44', fontWeight: 600 }}>✅ 更新完成：成功 {result.success} 条</div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
                <div style={{ color: '#c0392b', fontWeight: 600 }}>失败明细：</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.errors.slice(0, 30).map((it, idx) => (
                    <li key={idx}>
                      {it.index >= 0 ? `第 ${it.index + 1} 条：` : ''}
                      {it.message}
                    </li>
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
