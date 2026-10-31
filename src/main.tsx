import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startBackup } from './backup';
import './styles.css';

// Runs in the background: nothing on screen waits for the network (AC1).
startBackup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
