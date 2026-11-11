import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary, { ErrorScreen } from './components/ErrorBoundary';
import { getErrorMessage, isPermissionError, PERMISSION_HINT } from './utils/errors';
import './theme.css';

const ERROR_NODE_ID = 'base-form-importer-fatal-error';

/** 渲染全局可见错误提示；避免同一错误重复插入多个节点 */
function showFatalError(reason: unknown) {
  console.error('[base-form-importer] 未捕获错误', reason);
  if (document.getElementById(ERROR_NODE_ID)) return;

  const message = isPermissionError(reason)
    ? PERMISSION_HINT
    : getErrorMessage(reason) || '发生未知错误，请重新加载后重试';
  const detail = [getErrorMessage(reason), reason instanceof Error ? reason.stack : '']
    .filter(Boolean)
    .join('\n\n');

  const container = document.createElement('div');
  container.id = ERROR_NODE_ID;
  container.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--semi-color-bg-0,#fff);';

  const rootEl = document.getElementById('root');
  if (rootEl && rootEl.childElementCount === 0) {
    // React 树已被卸载（白屏）：直接插入 #root，保证错误可见
    rootEl.appendChild(container);
  } else {
    // React 仍在渲染：以浮层形式提示，避免覆盖当前界面
    document.body.appendChild(container);
  }

  ReactDOM.createRoot(container).render(<ErrorScreen message={message} detail={detail} />);
}

// 全局兜底：未捕获的同步错误 / 未处理的 Promise 异常
window.onerror = (message, _source, _lineno, _colno, error) => {
  showFatalError(error ?? message);
  return false;
};
window.addEventListener('unhandledrejection', (event) => {
  showFatalError(event.reason);
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
