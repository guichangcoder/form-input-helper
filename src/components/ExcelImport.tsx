import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Select, Tag, Toast } from '@douyinfe/semi-ui';
import type { IFieldMeta, ITable } from '@lark-base-open/js-sdk';
import { BATCH_SIZE, IMPORTABLE_FIELD_TYPES, MAPPING_STORAGE_KEY, PREVIEW_ROWS } from '../constants';
import { parseExcel, type ParsedSheet, cellDisplayText } from '../utils/excel';
import { convertCellValue } from '../utils/convert';
import {
  collectSelectValues,
  ensureSelectOptions,
  getTableContext,
  writeRecords,
} from '../utils/sdk';
import { FIELD_TYPE_LABEL } from '../constants';
import PreviewTable from './PreviewTable';

const SKIP = '__skip__';

interface ExcelImportProps {
  table: ITable | null;
  tableId: string;
  tableName: string;
  fields: IFieldMeta[];
}

interface ValidationIssue {
  rowIndex: number; // 1-based（含表头）
  fieldName: string;
  message: string;
}

export default function ExcelImport({ table, tableId, tableName, fields }: ExcelImportProps) {
  const supportedFields = useMemo(
    () => fields.filter((f) => IMPORTABLE_FIELD_TYPES.includes(f.type as number)),
    [fields],
  );
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [validCount, setValidCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ success: number; errors: ValidationIssue[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fieldById = useMemo(() => {
    const m = new Map<string, IFieldMeta>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  const activeSheet = sheets[sheetIdx] ?? null;

  /** 读取本地映射记忆 */
  const loadSavedMapping = useCallback(
    (headers: string[]) => {
      try {
        const raw = localStorage.getItem(`${MAPPING_STORAGE_KEY}:${tableId}`);
        if (!raw) return null;
        const saved = JSON.parse(raw) as Record<string, string>;
        const next: Record<string, string> = {};
        headers.forEach((h) => {
          if (saved[h] && (saved[h] === SKIP || fieldById.has(saved[h]))) {
            next[h] = saved[h];
          }
        });
        return next;
      } catch {
        return null;
      }
    },
    [fieldById, tableId],
  );

  /** 选择文件并解析 */
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    setIssues([]);
    try {
      const parsed = await parseExcel(f);
      if (!parsed.length) {
        Toast.error('未解析到有效数据');
        return;
      }
      setFile(f);
      setSheets(parsed);
      setSheetIdx(0);
      applyMapping(parsed[0], supportedFields, loadSavedMapping(parsed[0].headers));
    } catch (err) {
      Toast.error(`文件解析失败：${(err as Error).message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 应用映射：保存记忆 > 同名自动匹配 > 不导入 */
  const applyMapping = (
    sheet: ParsedSheet,
    sFields: IFieldMeta[],
    saved: Record<string, string> | null,
  ) => {
    const next: Record<string, string> = {};
    sheet.headers.forEach((h) => {
      if (saved && saved[h] !== undefined) {
        next[h] = saved[h];
      } else {
        const hit = sFields.find((f) => f.name.trim() === h.trim());
        next[h] = hit ? hit.id : SKIP;
      }
    });
    setMapping(next);
  };

  const onSheetChange = (idx: number) => {
    setSheetIdx(idx);
    const sheet = sheets[idx];
    if (sheet) {
      applyMapping(sheet, supportedFields, loadSavedMapping(sheet.headers));
    }
  };

  /** 转换并校验全部行 */
  const buildRecords = useCallback(() => {
    if (!activeSheet) return { records: [] as Array<Record<string, unknown>>, issues: [] as ValidationIssue[] };
    const issues: ValidationIssue[] = [];
    const records: Array<Record<string, unknown>> = [];
    const colIdxOf: Record<string, number> = {};
    activeSheet.headers.forEach((h, i) => (colIdxOf[h] = i));

    activeSheet.rows.forEach((row, ri) => {
      const rec: Record<string, unknown> = {};
      for (const [header, fieldId] of Object.entries(mapping)) {
        if (fieldId === SKIP) continue;
        const meta = fieldById.get(fieldId);
        if (!meta) continue;
        const colIdx = colIdxOf[header];
        const raw = colIdx === undefined ? '' : row[colIdx];
        const res = convertCellValue(raw, meta);
        if (!res.ok) {
          issues.push({
            rowIndex: ri + 2, // 1-based 且含表头行
            fieldName: meta.name,
            message: res.error || '转换失败',
          });
        } else if (!res.skip) {
          rec[fieldId] = res.value;
        }
      }
      records.push(rec);
    });
    return { records, issues };
  }, [activeSheet, mapping, fieldById]);

  /** 刷新预览与校验 */
  const refreshPreview = useCallback(() => {
    if (!activeSheet) {
      setPreviewRows([]);
      setValidCount(0);
      setIssues([]);
      return;
    }
    const { records, issues } = buildRecords();
    setIssues(issues);
    setValidCount(records.length);

    // 预览前 N 行（映射字段）
    const mappedFields = Object.entries(mapping)
      .filter(([, fid]) => fid !== SKIP)
      .map(([header, fid]) => ({ header, meta: fieldById.get(fid)! }));
    const headers = mappedFields.map((m) => m.meta.name);
    const rows = records.slice(0, PREVIEW_ROWS).map((rec) =>
      mappedFields.map(({ header, meta }) => {
        const v = rec[meta.id];
        if (v === undefined) return '';
        if (Array.isArray(v)) return v.join('、');
        if (meta.type === 5 && typeof v === 'number') {
          return new Date(v).toLocaleString('zh-CN', { hour12: false });
        }
        return String(v);
      }),
    );
    setPreviewRows([headers, ...rows]);
  }, [activeSheet, mapping, fieldById, buildRecords]);

  useEffect(() => {
    refreshPreview();
  }, [refreshPreview]);

  /** 保存映射记忆 */
  const saveMapping = () => {
    try {
      localStorage.setItem(`${MAPPING_STORAGE_KEY}:${tableId}`, JSON.stringify(mapping));
      Toast.success('已记住本次字段映射，下次导入自动复用');
    } catch {
      Toast.error('映射记忆保存失败');
    }
  };

  /** 执行导入 */
  const doImport = async () => {
    if (!table || !activeSheet) return;
    const { records, issues } = buildRecords();
    if (issues.length) {
      Toast.error(`有 ${issues.length} 行存在格式问题，请先修正`);
      return;
    }
    const nonEmpty = records.filter((r) => Object.keys(r).length > 0);
    if (!nonEmpty.length) {
      Toast.warning('没有可写入的数据');
      return;
    }
    const fieldIds = Array.from(
      new Set(Object.values(mapping).filter((v) => v !== SKIP && fieldById.has(v))),
    );
    const selectFields = fieldIds.filter(
      (fid) => (fieldById.get(fid)!.type as number) === 3 || (fieldById.get(fid)!.type as number) === 4,
    );

    setImporting(true);
    setProgress({ done: 0, total: nonEmpty.length });
    setResult(null);
    try {
      // 1) 同步单选/多选选项
      for (const fid of selectFields) {
        const field = await table.getField(fid);
        const values = collectSelectValues(nonEmpty, fid);
        await ensureSelectOptions(field as never, values);
      }
      // 2) 批量写入
      const res = await writeRecords(table, nonEmpty, fieldIds, (done, total) =>
        setProgress({ done, total }),
      );
      const errIssues: ValidationIssue[] = res.errors.map((e) => ({
        rowIndex: e.index + 2,
        fieldName: '—',
        message: e.message,
      }));
      setResult({ success: res.success, errors: errIssues });
      Toast.success(`导入完成：成功 ${res.success} 条${errIssues.length ? `，失败 ${errIssues.length} 条` : ''}`);
    } catch (err) {
      Toast.error(`导入失败：${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const selectOptions = useMemo(() => {
    const opts = [{ label: '— 不导入此列 —', value: SKIP }];
    supportedFields.forEach((f) =>
      opts.push({
        label: `${f.name}（${FIELD_TYPE_LABEL[f.type as number] ?? f.type}${f.isPrimary ? '·主' : ''}）`,
        value: f.id,
      }),
    );
    return opts;
  }, [supportedFields]);

  return (
    <div>
      <div className="block-title">1. 选择 Excel 文件</div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      <Button theme="solid" onClick={() => fileInputRef.current?.click()} disabled={importing}>
        {file ? `已选择：${file.name}（点击可更换）` : '选择 Excel 文件'}
      </Button>
      <div className="hint-text" style={{ marginTop: 6 }}>
        支持 .xlsx / .xls / .csv，数据在本地浏览器解析，不会上传到任何服务器。
      </div>

      {sheets.length > 1 && (
        <div className="row-item" style={{ marginTop: 12 }}>
          <div className="label">工作表</div>
          <div className="control">
            <Select
              value={String(sheetIdx)}
              onChange={(v) => {
                if (typeof v === 'string') onSheetChange(Number(v));
              }}
              optionList={sheets.map((s, i) => ({
                label: `${s.name}（${s.total} 行）`,
                value: String(i),
              }))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}

      {activeSheet && (
        <>
          <div className="block-title" style={{ marginTop: 16 }}>
            2. 字段映射（Excel 列 → 数据表字段）
            <Button
              size="small"
              style={{ marginLeft: 12 }}
              onClick={saveMapping}
              disabled={importing}
            >
              记住映射
            </Button>
          </div>
          <div className="hint-text" style={{ marginBottom: 8 }}>
            已自动按同名匹配；灰色字段类型不支持导入（人员/附件/关联/公式等）。
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto', paddingRight: 4 }}>
            {activeSheet.headers.map((h, i) => {
              const fid = mapping[h];
              const meta = fid && fid !== SKIP ? fieldById.get(fid) : null;
              const unsupported = meta ? !isSupportedType(meta.type as number) : false;
              return (
                <div key={i} className="mapping-row">
                  <div className="excel-col" title={h}>
                    <Tag size="small" color="light-blue">
                      {h || `列${i + 1}`}
                    </Tag>
                  </div>
                  <div className="arrow">→</div>
                  <div style={{ flex: 1 }}>
                    <Select
                      value={fid}
                      onChange={(v) => setMapping((m) => ({ ...m, [h]: v as string }))}
                      optionList={selectOptions}
                      style={{ width: '100%' }}
                      size="small"
                      disabled={importing}
                    />
                  </div>
                  {unsupported && (
                    <Tag size="small" color="red">
                      不支持
                    </Tag>
                  )}
                </div>
              );
            })}
          </div>

          <div className="block-title" style={{ marginTop: 16 }}>3. 数据预览与校验</div>
          <div className="hint-text" style={{ marginBottom: 6 }}>
            共 {activeSheet.total} 行，以下预览前 {PREVIEW_ROWS} 行；格式问题：{issues.length} 处
          </div>
          <PreviewTable headers={previewRows[0] ?? []} rows={previewRows.slice(1)} />

          {issues.length > 0 && (
            <div className="result-box" style={{ marginTop: 8 }}>
              <div style={{ color: '#c0392b', fontWeight: 600, marginBottom: 4 }}>
                以下行存在格式问题，需修正后重新导入：
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>
                {issues.slice(0, 50).map((it, idx) => (
                  <li key={idx}>
                    第 {it.rowIndex} 行 · {it.fieldName}：{it.message}
                  </li>
                ))}
                {issues.length > 50 && <li>… 等共 {issues.length} 处</li>}
              </ul>
            </div>
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
              onClick={doImport}
              disabled={importing || !activeSheet.total}
              loading={importing}
            >
              导入 {activeSheet.total} 条记录到表「{tableName}」
            </Button>
            <div className="hint-text" style={{ marginTop: 4 }}>
              每批 {BATCH_SIZE} 条写入，执行前请确认映射正确。
            </div>
            {result && (
              <div className="result-box">
                <div style={{ color: '#2f9e44', fontWeight: 600 }}>
                  ✅ 导入完成：成功 {result.success} 条
                </div>
                {result.errors.length > 0 && (
                  <div style={{ marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
                    <div style={{ color: '#c0392b', fontWeight: 600 }}>失败明细：</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {result.errors.slice(0, 30).map((it, idx) => (
                        <li key={idx}>第 {it.rowIndex} 行：{it.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const isSupportedType = (t: number) => IMPORTABLE_FIELD_TYPES.includes(t as never);
