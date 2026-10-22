import React, { useEffect, useRef, useState } from 'react';
import { Spin, Tabs } from '@douyinfe/semi-ui';
import { bitable, type IFieldMeta, type ITable } from '@lark-base-open/js-sdk';
import ExcelImport from './components/ExcelImport';
import FixedValueInput from './components/FixedValueInput';
import RecordUpdater from './components/RecordUpdater';
import { getTableContext } from './utils/sdk';

const { TabPane } = Tabs;

interface ContextState {
  table: ITable | null;
  tableId: string;
  tableName: string;
  fields: IFieldMeta[];
}

export default function App() {
  const [ctx, setCtx] = useState<ContextState>({
    table: null,
    tableId: '',
    tableName: '',
    fields: [],
  });
  const [loading, setLoading] = useState(true);
  const tableIdRef = useRef('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    // 8 秒未就绪则提示需在多维表格插件面板中运行
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setLoading(false), 8000);
    try {
      const { table, tableName, tableId, fields } = await getTableContext();
      tableIdRef.current = tableId;
      setCtx({ table, tableName, tableId, fields });
    } catch (e) {
      console.error('获取表信息失败', e);
    } finally {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // 监听选中变化：切换数据表时自动刷新上下文
    const off = bitable.base.onSelectionChange((ev) => {
      const tid = ev.data?.tableId;
      if (tid && tid !== tableIdRef.current) {
        load();
      }
    });
    return () => off();
  }, []);

  return (
    <div className="app-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>表单录入助手</div>
        {ctx.tableName && (
          <span className="hint-text">
            当前表：<TagText text={ctx.tableName} />
          </span>
        )}
      </div>

      {loading ? (
        <div className="empty-tip">
          <Spin />
          <div style={{ marginTop: 8 }}>正在读取数据表…</div>
        </div>
      ) : !ctx.table ? (
        <div className="empty-tip">
          未能获取当前数据表。<br />
          请确认已在「飞书多维表格 → 插件 → 自定义插件」面板中打开本插件，并停留在某个数据表视图。
        </div>
      ) : (
        <Tabs type="line" defaultActiveKey="fixed" className="module-tabs">
          <TabPane tab="📝 固定值批量录入" itemKey="fixed">
            <FixedValueInput table={ctx.table} tableName={ctx.tableName} fields={ctx.fields} />
          </TabPane>
          <TabPane tab="🎯 记录筛选修改" itemKey="update">
            <RecordUpdater table={ctx.table} tableName={ctx.tableName} fields={ctx.fields} />
          </TabPane>
          <TabPane tab="📥 Excel 批量导入" itemKey="excel">
            <ExcelImport table={ctx.table} tableId={ctx.tableId} tableName={ctx.tableName} fields={ctx.fields} />
          </TabPane>
        </Tabs>
      )}
    </div>
  );
}

function TagText({ text }: { text: string }) {
  return <span style={{ fontWeight: 600 }}>{text}</span>;
}
