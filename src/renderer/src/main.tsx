import React from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={{ token: {
    colorPrimary: '#38664f', colorText: '#263a33', colorTextSecondary: '#7a8981',
    fontFamily: 'Inter, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    borderRadius: 8, colorBorder: '#dfe5df', controlHeight: 36, fontSize: 13,
    motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } }}><AntApp><App /></AntApp></ConfigProvider></React.StrictMode>
)
