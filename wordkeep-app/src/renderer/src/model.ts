import type {
  BlogPost,
  CloudSettings,
  DateRange,
  MaskImage,
  Reply,
  Term,
} from '../../shared/api';

export async function unwrap<T>(reply: Promise<Reply<T>>): Promise<T> {
  const result = await reply;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export function selectedPosts(posts: BlogPost[], range: DateRange): BlogPost[] {
  return posts.filter(
    (post) => post.date >= range.from && post.date <= range.to,
  );
}
export function imageSignature(
  settings: CloudSettings,
  mask: MaskImage | null,
): string {
  return JSON.stringify([settings, mask?.base64 ?? null]);
}
export function settingsError(settings: CloudSettings): string | null {
  if (!settings.font_path) return '请选择系统字体或导入字体文件。';
  if (
    ![settings.width, settings.height, settings.max_words].every(
      (value) => Number.isSafeInteger(value) && value >= 1,
    )
  )
    return '宽、高和最多词数必须是大于 0 的整数。';
  if (!Number.isFinite(settings.scale) || settings.scale < 1)
    return '导出倍率不能小于 1。';
  return null;
}
export function sortTerms(
  terms: Term[],
  search: string,
  key: 'occurrences' | 'document_count' | 'text',
  ascending: boolean,
): Term[] {
  const query = search.trim().toLocaleLowerCase();
  return terms
    .filter((term) => term.text.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const primary =
        key === 'text'
          ? a.text.localeCompare(b.text, 'zh-CN')
          : a[key] - b[key];
      return (
        (ascending ? primary : -primary) ||
        a.text.localeCompare(b.text, 'zh-CN')
      );
    });
}
export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function wordSet(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((word) => word.trim())
      .filter(Boolean),
  );
}
