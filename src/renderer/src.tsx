import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { WebDevApp } from './app/api-web/WebDevApp'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {import.meta.env.MODE === 'api-web' ? <WebDevApp /> : <App />}
  </StrictMode>
)
