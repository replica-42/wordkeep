import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, MenuCommand } from '../shared/api';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  openPosts: () => ipcRenderer.invoke('posts:open'),
  analyze: (range) => ipcRenderer.invoke('posts:analyze', range),
  generate: (settings, mask) =>
    ipcRenderer.invoke('cloud:generate', settings, mask),
  chooseFont: () => ipcRenderer.invoke('font:choose'),
  chooseMask: () => ipcRenderer.invoke('mask:choose'),
  saveImage: () => ipcRenderer.invoke('cloud:save'),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  readRuntimeSettings: () => ipcRenderer.invoke('runtime:read'),
  saveRuntimeSettings: (settings) =>
    ipcRenderer.invoke('runtime:save', settings),
  clearCache: () => ipcRenderer.invoke('runtime:clear-cache'),
  chooseResource: (setting) =>
    ipcRenderer.invoke('settings:choose-resource', setting),
  readWordList: (kind) => ipcRenderer.invoke('words:read', kind),
  saveWordList: (kind, text) => ipcRenderer.invoke('words:save', kind, text),
  cancel: () => ipcRenderer.invoke('app:cancel'),
  updateMenu: (state) => ipcRenderer.invoke('app:menu-state', state),
  onMenuCommand: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: MenuCommand,
    ) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => {
      ipcRenderer.removeListener('menu:command', listener);
    };
  },
};
contextBridge.exposeInMainWorld('wordkeep', api);
