import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { runConsoleDemo } from './game/demo/runConsoleDemo';
import { registerSW } from 'virtual:pwa-register';

runConsoleDemo();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
