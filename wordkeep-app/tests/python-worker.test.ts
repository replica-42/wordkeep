import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PythonWorker } from '../src/main/python-worker';

let directory: string;
let worker: PythonWorker;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wordkeep-http-'));
  const script = join(directory, 'worker.cjs');
  await writeFile(
    script,
    `const http=require('node:http');const fs=require('node:fs');
const server=http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer '+process.env.WORDKEEP_WORKER_TOKEN){res.writeHead(401);res.end();return;}
 if(req.url==='/health'){res.end(JSON.stringify({ready:true}));return;}
 let body='';for await(const chunk of req)body+=chunk;
 const m=JSON.parse(body);if(m.method==='hang')return;
 if(m.method==='exit'){process.exit(7);return;}
 if(m.method==='invalid'){res.end('bad');return;}
 const result=m.method==='environment'?{level:process.env.WORDKEEP_LOG_LEVEL,cache:process.env.MPLCONFIGDIR,pid:process.pid,pycache:process.env.PYTHONPYCACHEPREFIX??null}:m.params;
 const response={jsonrpc:'2.0',id:m.id,...(m.method==='error'?{error:{message:'failure',data:{message:'具体错误'}}}:{result})};
 const bytes=Buffer.from(JSON.stringify(response));
 if(m.method==='fragment'){for(const byte of bytes)res.write(Buffer.from([byte]));res.end();}
 else res.end(bytes);
});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.WORDKEEP_READY_FILE,JSON.stringify({port:server.address().port,pid:process.pid})));`,
  );
  worker = new PythonWorker({
    executable: process.execPath,
    args: [script],
    cwd: directory,
    userData: directory,
  });
});
afterEach(async () => {
  await worker.shutdown();
  await rm(directory, { recursive: true, force: true });
});
it('通过 HTTP 读取分块中文响应，并匹配并发请求', async () => {
  expect(
    await Promise.all([
      worker.request('fragment', { word: '喜欢' }),
      worker.request('echo', { word: '海边' }),
    ]),
  ).toEqual([{ word: '喜欢' }, { word: '海边' }]);
});
it('业务错误保留具体信息，后续请求仍然可用', async () => {
  await expect(worker.request('error')).rejects.toThrow('具体错误');
  expect(await worker.request('echo', { ok: true })).toEqual({ ok: true });
});
it.each(['exit', 'invalid'])('后端 %s 后可重新启动', async (method) => {
  const before = await worker.request<{ pid: number }>('environment');
  await expect(worker.request(method)).rejects.toThrow();
  expect(await worker.request('echo', { restarted: true })).toEqual({
    restarted: true,
  });
  const after = await worker.request<{ pid: number }>('environment');
  expect(after.pid).not.toBe(before.pid);
  await worker.shutdown();
  expect(await readdir(join(directory, 'runtime'))).toEqual([]);
});
it('启动期间取消，拒绝旧请求并允许新任务', async () => {
  const pending = worker.request('hang');
  const rejection = expect(pending).rejects.toThrow('已取消');
  worker.stop();
  await rejection;
  expect(await worker.request('echo', { restarted: true })).toEqual({
    restarted: true,
  });
});
it('通过启动环境传递日志级别和应用私有缓存目录', async () => {
  worker.setLogLevel('DEBUG');
  expect(await worker.request('environment')).toEqual({
    level: 'DEBUG',
    cache: join(directory, 'cache/python/matplotlib'),
    pid: expect.any(Number),
    pycache: null,
  });
});
