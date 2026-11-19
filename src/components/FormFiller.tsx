import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, IOpenUser, ITable } from '@lark-base-open/js-sdk';
import { convertCellValue } from '../utils/convert';
import { describeError } from '../utils/errors';
import {
  buildDynamicValues,
  dynamicValuesKey,
  getCurrentUserId,
  loadLinkCandidates,
  loadOptionCandidates,
  loadPeopleCandidates,
  sourceDynamicFieldIds,
  writeRecords,
  type LinkOption,
} from '../utils/sdk';
import type { TableFormConfig, ValueSource } from '../utils/formConfig';
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

  // 人员候选 / 选项候选 / 关联记录候选：按字段分别解析（支持管理员配置的跨表来源 + 筛选条件）
  const [usersByField, setUsersByField] = useState<Map<string, IOpenUser[]>>(new Map());
  const [optionNamesByField, setOptionNamesByField] = useState<Map<string, string[]>>(new Map());
  const [linkOptionsByField, setLinkOptionsByField] = useState<Map<string, LinkOption[]>>(
    new Map(),
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  /** 需要解析候选人员的字段（仅「人员」类型） */
  const peopleEntries = useMemo(
    () =>
      config.fields
        .filter((fc) => (fieldById.get(fc.fieldId)?.type as number) === 11)
        .map((fc) => ({ fieldId: fc.fieldId, source: fc.peopleSource })),
    [config.fields, fieldById],
  );

  /** 需要解析候选选项的字段（单选/多选，且配置了跨表来源） */
  const optionEntries = useMemo(
    () =>
      config.fields.flatMap((fc) => {
        const meta = fieldById.get(fc.fieldId);
        if (!meta || ![3, 4].includes(meta.type as number)) return [];
        if (!fc.optionSource?.tableId || !fc.optionSource?.fieldId) return [];
        return [{ fieldId: fc.fieldId, field: meta, source: fc.optionSource }];
      }),
    [config.fields, fieldById],
  );

  /** 需要解析候选记录的字段（关联字段，候选取关联表的记录） */
  const linkEntries = useMemo(
    () =>
      config.fields.flatMap((fc) => {
        const meta = fieldById.get(fc.fieldId);
        if (!meta || ![18, 21].includes(meta.type as number)) return [];
        return [{ fieldId: fc.fieldId, field: meta }];
      }),
    [config.fields, fieldById],
  );

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(0);

  /** 条件中被引用的「当前表单字段」：这些字段的值变化时需要重算候选 */
  const dynamicFieldIds = useMemo(() => {
    const ids = new Set<string>();
    config.fields.forEach((fc) => {
      sourceDynamicFieldIds(fc.peopleSource).forEach((id) => ids.add(id));
      sourceDynamicFieldIds(fc.optionSource).forEach((id) => ids.add(id));
    });
    return [...ids];
  }, [config.fields]);

  /** 动态比较值快照（仅在取值变化时更新，避免无关输入触发重算） */
  const dynamicKey = useMemo(
    () => dynamicValuesKey(buildDynamicValues(draft, dynamicFieldIds), dynamicFieldIds),
    [draft, dynamicFieldIds],
  );
  const dynamic = useMemo(
    () => buildDynamicValues(draft, dynamicFieldIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dynamicKey],
  );

  useEffect(() => {
    if (!table) return;
    let cancelled = false;
    // 动态条件依赖表单输入，做轻量防抖避免每次输入都全表扫描
    const timer = setTimeout(() => {
      Promise.all([
        loadPeopleCandidates(table, peopleEntries, dynamic),
        loadOptionCandidates(optionEntries, dynamic),
        getCurrentUserId(),
      ])
        .then(([users, options, uid]) => {
          if (cancelled) return;
          setUsersByField(users);
          setOptionNamesByField(options);
          setCurrentUserId(uid);
        })
        .catch((e) => console.error('读取人员/选项来源失败', e));
    }, dynamicFieldIds.length ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [table, peopleEntries, optionEntries, dynamic, dynamicFieldIds.length]);

  // 关联表的记录不随表单输入变化，单独读取一次
  useEffect(() => {
    let cancelled = false;
    loadLinkCandidates(linkEntries)
      .then((links) => {
        if (!cancelled) setLinkOptionsByField(links);
      })
      .catch((e) => console.error('读取关联表记录失败', e));
    return () => {
      cancelled = true;
    };
  }, [linkEntries]);

  /** 动态条件引用的表单字段尚未填写时的提示（此时候选为空） */
  const pendingDynamicHint = useCallback(
    (source?: ValueSource | null): string | null => {
      const ids = sourceDynamicFieldIds(source);
      if (!ids.length) return null;
      const missing = ids.filter((id) => !(dynamic[id] ?? []).length);
      if (!missing.length) return null;
      const names = missing.map((id) => fieldById.get(id)?.name || '引用字段').join('、');
      return `请先填写「${names}」后再选择。`;
    },
    [dynamic, fieldById],
  );

  const userById = useMemo(() => {
    const m = new Map<string, IOpenUser>();
    usersByField.forEach((list) => list.forEach((u) => u.id && m.set(u.id, u)));
    if (currentUserId) m.set(currentUserId, { id: currentUserId });
    return m;
  }, [usersByField, currentUserId]);

  // 管理员更新配置后清空未提交的内容
  useEffect(() => {
    setDraft({});
  }, [config]);

  /** 管理员配置的默认值：选项字段 = 默认选项；人员字段 = 当前登录用户 */
  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    config.fields.forEach((fc) => {
      const meta = fieldById.get(fc.fieldId);
      if (!meta || !fc.visible || fc.readOnly) return;
      const type = meta.type as number;
      if (type === 11) {
        if (fc.defaultCurrentUser === false || !currentUserId) return;
        // 姓名来自候选人员库（本表或来源表中出现过）；拿不到时只带 open_id，界面显示为「当前用户」
        out[fc.fieldId] = [userById.get(currentUserId) ?? { id: currentUserId }];
        return;
      }
      if (type === 3 && typeof fc.defaultValue === 'string' && fc.defaultValue) {
        out[fc.fieldId] = fc.defaultValue;
        return;
      }
      if (type === 4 && Array.isArray(fc.defaultValue) && fc.defaultValue.length) {
        out[fc.fieldId] = fc.defaultValue;
      }
    });
    return out;
  }, [config.fields, fieldById, currentUserId, userById]);

  /** 默认值只预填一次，避免覆盖用户已经填写/修改的内容 */
  const prefilledRef = useRef(false);
  useEffect(() => {
    prefilledRef.current = false;
  }, [config, table]);

  /** 配置中是否存在「默认预填当前用户」的人员字段（其默认值需等当前用户就绪） */
  const hasUserDefault = useMemo(
    () =>
      config.fields.some((fc) => {
        const meta = fieldById.get(fc.fieldId);
        return Boolean(
          meta &&
            (meta.type as number) === 11 &&
            fc.visible &&
            !fc.readOnly &&
            fc.defaultCurrentUser !== false,
        );
      }),
    [config.fields, fieldById],
  );

  useEffect(() => {
    if (prefilledRef.current) return;
    const entries = Object.entries(defaultValues);
    if (!entries.length) return;
    setDraft((d) => {
      let changed = false;
      const next = { ...d };
      entries.forEach(([id, v]) => {
        const cur = next[id];
        const empty =
          cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length);
        if (empty) {
          next[id] = v;
          changed = true;
        }
      });
      return changed ? next : d;
    });
    // 人员默认值尚未就绪时先填其它默认值，等当前用户到达后再补一次
    if (currentUserId || !hasUserDefault) prefilledRef.current = true;
  }, [defaultValues, currentUserId, hasUserDefault, fieldById, draft]);

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
        // 清空后重新应用管理员配置的默认值，方便连续录入
        prefilledRef.current = false;
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
        const pending = readOnly
          ? null
          : pendingDynamicHint(
              (meta.type as number) === 11 ? fc.peopleSource : fc.optionSource,
            );
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
              {pending && (
                <div className="hint-text" style={{ marginBottom: 4 }}>
                  {pending}
                </div>
              )}
              {readOnly ? (
                <div className="form-readonly-value">
                  {writable
                    ? displayText(meta, fc.fixedValue, linkOptionsByField.get(meta.id)) || '（未设置）'
                    : '（该字段不支持在此表单中填写）'}
                </div>
              ) : (
                <FieldEditor
                  field={meta}
                  value={draft[meta.id]}
                  onChange={(v) => setValue(meta.id, v)}
                  users={usersByField.get(meta.id) ?? []}
                  optionNames={optionNamesByField.get(meta.id)}
                  linkOptions={linkOptionsByField.get(meta.id)}
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
function displayText(meta: IFieldMeta, raw: unknown, links?: LinkOption[]): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (Array.isArray(raw)) {
    const byId = links ? new Map(links.map((l) => [l.id, l.label])) : null;
    return raw
      .map((x) => {
        if (x && typeof x === 'object') {
          const o = x as IOpenUser & { recordIds?: string[]; text?: string };
          if (Array.isArray(o.recordIds)) {
            return o.text || `${o.recordIds.length} 条关联记录`;
          }
          return o.name || o.email || o.id || '';
        }
        const id = String(x);
        return byId?.get(id) ?? id;
      })
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
