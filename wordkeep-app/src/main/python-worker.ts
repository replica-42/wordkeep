import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { LogLevel } from '../shared/api';

export interface WorkerOptions {
  executable: string;
  args: string[];
  cwd: string;
  userData: string;
}
interface Run {
  token: string;
  abort: AbortController;
  ready: Promise<string>;
  child?: ChildProcess;
  closed?: Promise<void>;
  timer?: NodeJS.Timeout;
  directory?: string;
  cleaning?: boolean;
}
class RpcError extends Error {}

export class PythonWorker {
  private run: Run | null = null;
  private nextId = 0;
  private level: LogLevel = 'WARNING';
  private closing = new Set<Promise<void>>();
  constructor(private readonly options: WorkerOptions) {}

  get isRunning(): boolean {
    return this.run !== null;
  }

  setLogLevel(level: LogLevel): void {
    this.level = level;
  }

  private start(): Run {
    if (this.run) return this.run;
    const run: Run = {
      token: randomBytes(32).toString('hex'),
      abort: new AbortController(),
      ready: Promise.resolve(''),
    };
    this.run = run;
    run.ready = this.launch(run).catch((error: unknown) => {
      if (this.run === run)
        this.stop(error instanceof Error ? error.message : '后端启动失败。');
      throw error;
    });
    return run;
  }
  private async launch(run: Run): Promise<string> {
    const runtime = join(this.options.userData, 'runtime');
    await mkdir(runtime, { recursive: true });
    run.directory = await mkdtemp(join(runtime, 'worker-'));
    const readyPath = join(run.directory, 'ready.json');
    const cache = join(this.options.userData, 'cache', 'python');
    const runtimeEnvironment: Record<string, string> = {};
    for (const [name, folder] of Object.entries({
      MPLCONFIGDIR: 'matplotlib',
      HF_HOME: 'huggingface',
      TORCH_HOME: 'torch',
      XDG_CACHE_HOME: 'xdg',
      TMPDIR: 'tmp',
      TEMP: 'tmp',
      TMP: 'tmp',
    })) {
      const directory = join(cache, folder);
      await mkdir(directory, { recursive: true });
      runtimeEnvironment[name] = directory;
    }

    run.abort.signal.throwIfAborted();
    const child = spawn(this.options.executable, this.options.args, {
      cwd: this.options.cwd,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ...runtimeEnvironment,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPYCACHEPREFIX: undefined,
        PYTHONNOUSERSITE: '1',
        WORDKEEP_USER_DATA: this.options.userData,
        WORDKEEP_LOG_LEVEL: this.level,
        WORDKEEP_READY_FILE: readyPath,
        WORDKEEP_WORKER_TOKEN: run.token,
      },
    });
    run.child = child;
    run.closed = new Promise<void>((resolve) => {
      child.once('error', (error) =>
        run.abort.abort(new Error(`无法启动后端：${error.message}`)),
      );
      child.once('close', (code, signal) => {
        if (run.timer) clearInterval(run.timer);
        run.abort.abort(
          new Error(`后端已退出（${signal ?? code}），请查看日志或重试。`),
        );
        if (this.run === run) this.run = null;
        resolve();
        this.cleanUp(run);
      });
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      run.abort.signal.throwIfAborted();
      let metadata: { port?: number; pid?: number } | null = null;
      try {
        metadata = JSON.parse(
          await readFile(readyPath, 'utf8'),
        ) as typeof metadata;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (metadata) {
        const { port, pid } = metadata;
        if (
          !Number.isInteger(port) ||
          !port ||
          port < 1 ||
          port > 65535 ||
          pid !== child.pid
        )
          throw new Error('后端启动信息无效。');
        const url = `http://127.0.0.1:${port}`;
        await this.health(run, url);
        run.timer = setInterval(() => {
          void this.health(run, url).catch(() => {
            if (this.run === run) this.stop('后端连接中断，请重试。');
          });
        }, 5000);
        run.timer.unref();
        return url;
      }
      await delay(50, undefined, { signal: run.abort.signal });
    }
    throw new Error('后端启动超时，请查看日志。');
  }
  private async health(run: Run, url: string): Promise<void> {
    const response = await fetch(`${url}/health`, {
      headers: { Authorization: `Bearer ${run.token}` },
      signal: AbortSignal.any([run.abort.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok || !((await response.json()) as { ready?: boolean }).ready)
      throw new Error('后端未就绪。');
  }
  async request<T>(method: string, params?: unknown): Promise<T> {
    const run = this.start();
    try {
      const url = await run.ready;
      const id = ++this.nextId;
      const response = await fetch(`${url}/rpc`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${run.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: params ?? {},
        }),
        signal: run.abort.signal,
      });
      if (!response.ok)
        throw new Error(`后端请求失败（HTTP ${response.status}）。`);
      const message = (await response.json()) as {
        jsonrpc?: string;
        id?: number;
        result?: T;
        error?: { message: string; data?: unknown };
      };
      if (
        message.jsonrpc !== '2.0' ||
        message.id !== id ||
        (!('result' in message) && !message.error)
      ) {
        this.stop('后端返回了无法读取的数据，请重试。');
        throw new Error('后端返回了无法读取的数据，请重试。');
      }
      if (message.error) {
        const data = message.error.data;
        throw new RpcError(
          typeof data === 'string'
            ? data
            : data && typeof data === 'object' && 'message' in data
              ? String(data.message)
              : message.error.message,
        );
      }
      return message.result as T;
    } catch (error) {
      if (run.abort.signal.aborted) throw run.abort.signal.reason;
      if (!(error instanceof RpcError) && this.run === run)
        this.stop('后端连接中断，请重试。');
      throw error;
    }
  }
  stop(message = '操作已取消。'): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.abort.abort(new Error(message));
    if (run.timer) clearInterval(run.timer);
    const child = run.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL');
      }, 2000);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    }
    this.cleanUp(run);
  }
  private cleanUp(run: Run): void {
    if (run.cleaning) return;
    run.cleaning = true;
    const closing = (async () => {
      await run.ready.catch(() => {});
      await run.closed;
      if (run.directory)
        await rm(run.directory, { recursive: true, force: true });
    })();
    this.closing.add(closing);
    void closing.finally(() => this.closing.delete(closing)).catch(() => {});
  }
  async shutdown(): Promise<void> {
    this.stop();
    await Promise.all(this.closing);
  }
}
