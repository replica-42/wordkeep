import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../src/main/application';

it.runIf(process.env.WORDKEEP_INTEGRATION === '1')(
  '真实 Python 后端完成导入、分析、生成、词表持久化和取消后重试',
  async () => {
    const root = resolve(import.meta.dirname, '../../wordkeep-backend');
    const profile = await mkdtemp(join(tmpdir(), 'wordkeep-integration-'));
    const application = new Application(
      root,
      profile,
      join(
        root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    );
    try {
      const options = await application.bootstrap();
      const font = options.fonts.find((item) =>
        /PingFang|Songti|NotoSansCJK|SourceHan/i.test(item.path),
      );
      expect(font).toBeDefined();
      const path = join(profile, 'posts.jsonl');
      await writeFile(
        path,
        [1, 2, 3]
          .map((id) =>
            JSON.stringify({
              id,
              content: '喜欢初音未来的演唱会。海边的夕阳令人幸福。',
              create_at: `2026-11-0${id}`,
            }),
          )
          .join('\n'),
      );
      await application.open(path);
      const range = { from: '2026-11-01', to: '2026-11-03' };
      const result = await application.analyze(range);
      expect(result.post_count).toBe(3);
      expect(Object.keys(result.frequencies).length).toBeGreaterThan(0);
      const image = await application.generate(
        {
          ...options.settings,
          font_path: font?.path ?? '',
          width: 640,
          height: 360,
          scale: 1.5,
        },
        null,
      );
      expect([image.width, image.height]).toEqual([960, 540]);
      expect(application.exportImage().data.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const beforeSettings = await application.readSettings();
      await expect(
        application.saveSettings({ ...beforeSettings, batch_size: 0 }),
      ).rejects.toThrow('整数');
      expect(application.exportImage().data.length).toBeGreaterThan(0);
      expect(options.wordLists).toEqual({ stopwords: '', dictionary: '' });
      await application.saveWordList(
        'stopwords',
        `${options.wordLists.stopwords}\n海边\n`,
      );
      expect(() => application.exportImage()).toThrow('预览');
      const pending = application.analyze(range);
      const cancellation = expect(pending).rejects.toThrow('取消');
      application.cancel();
      await cancellation;
      const updated = await application.analyze(range);
      expect(updated.frequencies).not.toHaveProperty('海边');
      const dictionary = join(profile, 'selected-dict.txt');
      const models = join(profile, 'selected models');
      await writeFile(dictionary, '海边\n');
      await symlink(
        beforeSettings.hanlp_home,
        models,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await application.saveSettings({
        ...beforeSettings,
        hanlp_home: models,
        dictionary_path: dictionary,
        batch_size: 1,
      });
      expect(() => application.exportImage()).toThrow('预览');
      await expect(
        application.generate(
          { ...options.settings, font_path: font?.path ?? '' },
          null,
        ),
      ).rejects.toThrow('分析');
      const withDictionary = await application.analyze(range);
      expect(withDictionary.frequencies).toHaveProperty('海边');
      await application.saveWordList('dictionary', '海边\n演唱会\n');
      expect(await readFile(dictionary, 'utf8')).toBe('海边\n演唱会\n');
    } finally {
      await application.shutdown();
      await rm(profile, { recursive: true, force: true });
    }
  },
  90000,
);
