/* Shared app context — avoids circular imports between components and app.js. */
export const App = {
  ipc: null, settings: null, vault: null, workspace: null,
  openFile: null, openGraph: null, runCommand: null, commands: null,
  palette: null, switcher: null, notice: null, searchPanel: null,
  refreshExplorer: null, refreshRightSidebar: null, openTagSearch: null,
  dailyNote: null, createNote: null, renameNote: null,
};
export function setApp(obj) { Object.assign(App, obj); }
