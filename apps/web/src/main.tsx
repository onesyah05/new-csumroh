import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AuthProvider } from './app/auth';
import { queryClient } from './app/query';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import './styles/globals.css';
import { registerAppWorker } from './app/pwa';

registerAppWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></QueryClientProvider></AppErrorBoundary></React.StrictMode>);
