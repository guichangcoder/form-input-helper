import React from 'react';
import { getErrorMessage, isPermissionError, PERMISSION_HINT } from '../utils/errors';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

/** 可见的错误界面（ErrorBoundary 与 main.tsx 的全局兜底共用） */
export function ErrorScreen({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="app-container" style={{ padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>插件运行出错</div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.7,
          color: '#c0392b',
          wordBreak: 'break-word',
          marginBottom: 8,
        }}
      >
        {message}
      </div>
      <div className="hint-text" style={{ marginBottom: 12 }}>
        若该数据表开启了高级权限，请确认你对当前数据表/字段有访问权限。
      </div>
      {detail && (
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{ fontSize: 12, color: 'var(--semi-color-text-2)', cursor: 'pointer' }}
          >
            查看错误详情
          </summary>
          <pre
            style={{
              marginTop: 6,
              padding: 8,
              maxHeight: 200,
              overflow: 'auto',
              background: 'var(--semi-color-fill-0)',
              borderRadius: 4,
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {detail}
          </pre>
        </details>
      )}
      <button
        type="button"
        onClick={() => location.reload()}
        style={{
          padding: '6px 16px',
          fontSize: 13,
          color: '#fff',
          background: 'var(--semi-color-primary)',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        重新加载
      </button>
    </div>
  );
}

/** 捕获渲染期异常，避免 React 18 卸载整棵树后出现纯白页面 */
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? '' });
    console.error('插件渲染出错', error, errorInfo);
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const raw = getErrorMessage(error) || String(error);
    const message = isPermissionError(error) ? PERMISSION_HINT : raw;
    const detail = [raw, error.stack, componentStack].filter(Boolean).join('\n\n');
    return <ErrorScreen message={message} detail={detail} />;
  }
}
