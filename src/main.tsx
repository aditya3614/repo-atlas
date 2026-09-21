import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts: nothing is fetched from a CDN at runtime.
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/600.css';
// Story sentences only: an editorial voice for the prose, Instrument Sans for the UI.
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/400-italic.css';

import './styles/global.css';
import App from './App';
import { useUi } from './store/ui';

document.documentElement.dataset.theme = useUi.getState().theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
