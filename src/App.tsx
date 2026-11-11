import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin, Tabs, Tag } from '@douyinfe/semi-ui';
import { bitable, type IFieldMeta, type ITable } from '@lark-base-open/js-sdk';
import ExcelImport from './components/ExcelImport';
import FixedValueInput from './components/FixedValueInput';
import FormConfigPanel from './components/FormConfigPanel';
import FormFiller from './components/FormFiller';
import RecordUpdater from './components/RecordUpdater';
import { getTableContext } from './utils/sdk';
import { describeError } from './utils/errors';
import {
  buildDefaultConfig,
  isBaseManager,
  loadFormConfig,
  mergeConfigWithFields,
  type TableFormConfig,
} from './utils/formConfig';

const { TabPane } = Tabs;

interface ContextState {
  table: ITable | null;
  tableId: string;
  viewId: string;
  tableName: string;
  /** 数据表全部字段 */
  fields: IFieldMeta[];
  /** 当前视图可见字段（按视图顺序） */
  visibleFields: IFieldMeta[];
}

export default function App() {
  const [ctx, setCtx] = useState<ContextState>({
    table: null,
    tableId: '',
    viewId: '',
    tableName: '',
    fields: [],
    visibleFields: [],
  });
  const [loading, setLoading] = useState(true);
  /** 读取上下文失败时的可读原因（权限不足 / 数据表缺失等） */
  const [errorMsg, setErrorMsg] = useState('');
  /** 当前用户是否为该多维表格的管理员（可管理权限） */
  const [isManager, setIsManager] = useState(false);
  /** 当前数据表的表单配置（未配置为 null） */
  const [formConfig, setFormConfig] = useState<TableFormConfig | null>(null);
  const tableIdRef = useRef('');
  const viewIdRef = useRef('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    // 8 秒未就绪则提示需在多维表格插件面板中运行
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setLoading(false), 8000);
    try {
      const { table, tableName, tableId, viewId, fields, visibleFields } = await getTableContext();
      tableIdRef.current = tableId;
      viewIdRef.current = viewId;
      setErrorMsg('');
      setCtx({ table, tableName, tableId, viewId, fields, visibleFields });

      // 管理权限 + 该表的表单配置（配置按数据表维度存储，表内用户共享）
      const [manager, saved] = await Promise.all([isBaseManager(), loadFormConfig(tableId)]);
      setIsManager(manager);
      // 配置按数据表维度存全量字段，保存顺序以配置为准（首次为视图顺序）
      setFormConfig(saved ? mergeConfigWithFields(saved, fields) : null);
    } catch (e) {
      console.error('获取表信息失败', e);
      setErrorMsg(describeError(e, '未能获取当前数据表'));
    } finally {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // 监听选中变化：切换数据表或视图时自动刷新上下文（字段列表随视图变化）
    let off: (() => void) | undefined;
    try {
      off = bitable.base.onSelectionChange((ev) => {
        const tid = ev.data?.tableId;
        const vid = ev.data?.viewId;
        if ((tid && tid !== tableIdRef.current) || (vid && vid !== viewIdRef.current)) {
          load();
        }
      });
    } catch (e) {
      console.error('监听数据表切换失败', e);
    }
    return () => {
      try {
        off?.();
      } catch (e) {
        console.error('取消数据表切换监听失败', e);
      }
    };
  }, []);

  /** 当前视图可见字段的 ID（按视图顺序） */
  const viewFieldIds = useMemo(() => ctx.visibleFields.map((f) => f.id), [ctx.visibleFields]);

  // 管理员配置面板始终有可编辑的配置对象（未配置时使用默认值，保存后才生效）
  const adminConfig = useMemo(
    () =>
      formConfig ??
      mergeConfigWithFields(buildDefaultConfig(ctx.visibleFields), ctx.fields),
    [formConfig, ctx.fields, ctx.visibleFields],
  );

  return (
    <div className="app-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          表单录入助手
          {isManager && (
            <Tag size="small" color="green" style={{ marginLeft: 6 }}>
              管理员
            </Tag>
          )}
        </div>
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
          {errorMsg || '未能获取当前数据表'}<br />
          <span className="hint-text">
            请确认已在「飞书多维表格 → 插件 → 自定义插件」面板中打开本插件，并停留在某个数据表视图；
            若该数据表开启了高级权限，请确认你对当前数据表/字段有访问权限。
          </span>
        </div>
      ) : (
        <>
          {ctx.visibleFields.length === 0 && (
            <div className="hint-text" style={{ marginBottom: 10 }}>
              当前视图未读取到可见字段。若有部分字段不可见或不可用，通常是当前账号对相关字段没有权限，请联系多维表格管理员开通后重试。
            </div>
          )}
          <Tabs
            key={ctx.tableId}
            type="line"
            defaultActiveKey={formConfig?.enabled ? 'form' : 'fixed'}
            className="module-tabs"
          >
            {formConfig?.enabled && (
              <TabPane tab="📋 表单填写" itemKey="form">
                <FormFiller
                  table={ctx.table}
                  tableName={ctx.tableName}
                  fields={ctx.visibleFields}
                  config={formConfig}
                />
              </TabPane>
            )}
            <TabPane tab="📝 固定值批量录入" itemKey="fixed">
              <FixedValueInput table={ctx.table} tableName={ctx.tableName} fields={ctx.fields} />
            </TabPane>
            <TabPane tab="🎯 记录筛选修改" itemKey="update">
              <RecordUpdater table={ctx.table} tableName={ctx.tableName} fields={ctx.fields} />
            </TabPane>
            <TabPane tab="📥 Excel 批量导入" itemKey="excel">
              <ExcelImport table={ctx.table} tableId={ctx.tableId} tableName={ctx.tableName} fields={ctx.fields} />
            </TabPane>
            {isManager && (
              <TabPane tab="⚙️ 表单配置" itemKey="config">
                <FormConfigPanel
                  table={ctx.table}
                  tableId={ctx.tableId}
                  tableName={ctx.tableName}
                  fields={ctx.fields}
                  visibleFieldIds={viewFieldIds}
                  config={adminConfig}
                  onSaved={(cfg) => setFormConfig(mergeConfigWithFields(cfg, ctx.fields))}
                />
              </TabPane>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}

function TagText({ text }: { text: string }) {
  return <span style={{ fontWeight: 600 }}>{text}</span>;
}
