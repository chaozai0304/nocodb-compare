import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './ui/App'
import 'antd/dist/reset.css'

// Open-source fonts (SIL OFL)
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/600.css'
import './ui/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
