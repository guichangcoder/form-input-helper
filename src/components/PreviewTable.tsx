import React from 'react';

interface PreviewTableProps {
  /** 列头 */
  headers: string[];
  /** 二维数据（已转显示文本） */
  rows: string[][];
  /** 最大高度 */
  maxHeight?: number;
}

/** 只读预览表格：用于导入数据预览与错误明细展示 */
export default function PreviewTable({ headers, rows, maxHeight = 260 }: PreviewTableProps) {
  if (!rows.length) {
    return <div className="empty-tip">暂无数据</div>;
  }
  return (
    <div style={{ overflow: 'auto', maxHeight, border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
      <table className="preview-table">
        <thead>
          <tr>
            <th style={{ width: 44 }}>#</th>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td style={{ color: 'var(--semi-color-text-2)' }}>{ri + 1}</td>
              {headers.map((_, ci) => (
                <td key={ci} title={row[ci] ?? ''}>
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
