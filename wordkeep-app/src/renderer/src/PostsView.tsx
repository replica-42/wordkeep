import { useState } from 'react';
import type { BlogPost } from '../../shared/api';

export function PostsView({
  posts,
  imported,
}: {
  posts: BlogPost[];
  imported: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  if (!imported)
    return (
      <div className="empty-details">
        <h2>尚未导入博文</h2>
        <p>点击「导入博文」，选择本地 JSONL 文件。</p>
        <p className="help">每行一篇博文，支持 JSONL 格式。</p>
      </div>
    );
  return (
    <section className="posts-view" aria-label="所选范围内的博文">
      <div className="table-scroll">
        <table className="post-table">
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">正文</th>
            </tr>
          </thead>
          <tbody>
            {posts.slice(page * pageSize, (page + 1) * pageSize).map((post) => (
              <tr key={post.id}>
                <td className="date-cell">
                  <time dateTime={post.createdAt} title={post.createdAt}>
                    {post.date}
                  </time>
                </td>
                <td className="post-text">{post.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!posts.length && (
          <p className="empty-inline">这个时间范围内没有博文，请调整日期。</p>
        )}
      </div>
      <div className="table-footer">
        <span>
          {posts.length ? page * pageSize + 1 : 0}–
          {Math.min((page + 1) * pageSize, posts.length)} /{' '}
          {posts.length.toLocaleString()} 篇
        </span>
        {posts.length > pageSize && (
          <div className="pagination">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>
              {page + 1} / {Math.ceil(posts.length / pageSize)}
            </span>
            <button
              type="button"
              disabled={(page + 1) * pageSize >= posts.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
