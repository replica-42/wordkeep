import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { backendPaths } from '../src/main/backend-paths';

it.each(['darwin', 'win32'] as const)(
  'uses the sibling backend in development on %s',
  (platform) => {
    const backend = backendPaths(
      resolve('project/wordkeep-app'),
      resolve('resources'),
      false,
      platform,
    );
    expect(backend.root).toBe(resolve('project/wordkeep-backend'));
    expect(backend.python).toBe(
      join(
        backend.root,
        '.venv',
        platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    );
    expect(backend.args).toEqual([
      '-u',
      '-m',
      'wordkeep_backend.interfaces.http',
    ]);
  },
);

it.each(['darwin', 'win32'] as const)(
  'uses the bundled backend on %s',
  (platform) => {
    const backend = backendPaths(
      resolve('project/wordkeep-app'),
      resolve('resources'),
      true,
      platform,
    );
    expect(backend.root).toBe(resolve('resources/wordkeep-backend'));
    expect(backend.python).toBe(
      join(
        backend.root,
        platform === 'win32' ? 'wordkeep-backend.exe' : 'wordkeep-backend',
      ),
    );
    expect(backend.args).toEqual([]);
  },
);
