export const app = {
  getVersion: () => "1.0.0",
  getPath: (name: string) => name,
  on: () => {},
  whenReady: () => Promise.resolve(),
};

export const Notification = class {
  show() {}
};

export const shell = {
  openPath: () => Promise.resolve(),
};

export const ipcMain = {
  on: () => {},
  handle: () => {},
};

export const BrowserWindow = class {
  loadURL() {}
  on() {}
  webContents = {
    on: () => {},
    send: () => {},
  };
};

export const Menu = {
  buildFromTemplate: () => ({
    popup: () => {},
  }),
};

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
};
