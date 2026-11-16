import type { DesktopAPI } from '../../shared/api';

declare global {
  interface Window {
    readonly wordkeep: DesktopAPI;
  }
}
