import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DesktopState, type DeskfallBridge, type OverlayCommand, type OverlayInit, type Settings } from '../shared/types';

function listen<TPayload>(channel: string, cb: (payload: TPayload) => void): void {
  ipcRenderer.on(channel, (_event, payload: TPayload) => cb(payload));
}

const bridge: DeskfallBridge = {
  onInit: (cb) => listen<OverlayInit>(IPC.init, cb),
  onDesktop: (cb) => listen<DesktopState>(IPC.desktop, cb),
  onSettings: (cb) => listen<Settings>(IPC.settings, cb),
  onCommand: (cb) => listen<OverlayCommand>(IPC.command, cb),
  onRunning: (cb) => listen<boolean>(IPC.running, cb),
  setInteractive: (interactive) => ipcRenderer.send(IPC.interactive, interactive),
  ready: () => ipcRenderer.send(IPC.ready),
  reportError: (message) => ipcRenderer.send(IPC.error, message),
};

contextBridge.exposeInMainWorld('deskfall', bridge);
