import { join, resolve } from 'node:path';

export function backendPaths(
  appDirectory: string,
  resources: string,
  packaged: boolean,
  platform: NodeJS.Platform = process.platform,
) {
  const root = packaged
    ? join(resources, 'wordkeep-backend')
    : resolve(appDirectory, '../wordkeep-backend');
  return {
    root,
    python: packaged
      ? join(
          root,
          platform === 'win32' ? 'wordkeep-backend.exe' : 'wordkeep-backend',
        )
      : join(
          root,
          '.venv',
          platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        ),
    args: packaged ? [] : ['-u', '-m', 'wordkeep_backend.interfaces.http'],
  };
}
