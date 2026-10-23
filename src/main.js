/** Jafra Z UI (mockup v4.3): top-bar picker (no sidebar), Incidents + Charts views, KUSMA chat over Laya + Jafra Z. */
import './styles/shell.css';
import './styles/dash4.css';
import './styles/picker.css';
import './styles/charts.css';
import './styles/app.css';
import { state } from './app/core.js';
import { applyTheme, loadWorkloads, renderAll, wireShell } from './app/shell.js';
import './views/dashboard.js';
import './views/charts.js';
import './views/evidence.js';
import { wireChat } from './chat/pane.js';
import { checkAll, getStatus, pushProxyConfig, startPolling } from './services/config.js';

applyTheme();
wireShell();
wireChat();
renderAll();
(async () => {
  await pushProxyConfig();
  await checkAll();
  startPolling(15000);
  if (getStatus('analyzer').state === 'healthy' && state.workloads == null) loadWorkloads();
  else renderAll();
})();
