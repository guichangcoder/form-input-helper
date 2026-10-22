import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme.css';

// 插件宿主环境注入 SDK 后即可直接渲染；若环境异常，App 内会给出错误提示
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);
