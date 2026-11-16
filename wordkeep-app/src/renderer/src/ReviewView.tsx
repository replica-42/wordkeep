import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiSearchLine,
} from '@remixicon/react';
import { useMemo, useState } from 'react';
import type {
  AnalysisResult,
  BlogPost,
  Term,
  WordListKind,
  WordLists,
} from '../../shared/api';
import { sortTerms, wordSet } from './model';
import { SplitPane } from './SplitPane';

interface Props {
  result: AnalysisResult;
  posts: BlogPost[];
  wordLists: WordLists;
  disabled: boolean;
  stale: boolean;
  onEdit(kind: WordListKind, word: string): void;
}
function Highlight({ text, word }: { text: string; word: string }) {
  const pieces = text.split(word);
  let offset = 0;
  return (
    <>
      {pieces.map((piece, index) => {
        const key = offset;
        offset += piece.length + word.length;
        return (
          <span key={key}>
            {index > 0 && <mark>{word}</mark>}
            {piece}
          </span>
        );
      })}
    </>
  );
}
export function ReviewView({
  result,
  posts,
  wordLists,
  disabled,
  stale,
  onEdit,
}: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{
    key: 'text' | 'occurrences' | 'document_count';
    ascending: boolean;
  }>({ key: 'occurrences', ascending: false });
  const [selected, setSelected] = useState(result.terms[0]?.text ?? '');
  const [page, setPage] = useState(0);
  const terms = useMemo(
    () => sortTerms(result.terms, query, sort.key, sort.ascending),
    [result, query, sort],
  );
  const current = terms.find((term) => term.text === selected) ?? terms[0];
  const stopwords = wordSet(wordLists.stopwords);
  const dictionary = wordSet(wordLists.dictionary);
  const pageSize = 50;
  const rows = terms.slice(page * pageSize, (page + 1) * pageSize);
  const chooseSort = (key: typeof sort.key) => {
    setSort({
      key,
      ascending: sort.key === key ? !sort.ascending : key === 'text',
    });
    setPage(0);
  };
  const header = (key: typeof sort.key, label: string) => (
    <th
      scope="col"
      className={key === 'text' ? '' : 'number-cell'}
      aria-sort={
        sort.key === key
          ? sort.ascending
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <button type="button" onClick={() => chooseSort(key)}>
        {label}
        {sort.key === key &&
          (sort.ascending ? (
            <RiArrowUpSLine size={17} aria-hidden="true" />
          ) : (
            <RiArrowDownSLine size={17} aria-hidden="true" />
          ))}
      </button>
    </th>
  );
  const selectNext = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    term: Term,
  ) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const index = rows.indexOf(term) + (event.key === 'ArrowDown' ? 1 : -1);
    const next = rows[index];
    if (next) {
      event.preventDefault();
      setSelected(next.text);
      document.getElementById(`word-${index}`)?.focus();
    }
  };
  return (
    <section className="review-view" aria-label="检查词频和原文">
      <SplitPane
        name="review"
        defaultSecondSize={180}
        direction="rows"
        label="词频与原文分隔线"
        defaultRatio={0.65}
        minimumFirst={145}
        minimumSecond={130}
        first={
          <div className="word-table-pane">
            <label className="search-field">
              <RiSearchLine size={20} aria-hidden="true" />
              <span className="sr-only">搜索词语</span>
              <input
                type="search"
                placeholder="搜索词语"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="table-scroll word-table-scroll">
              <table className="word-table">
                <thead>
                  <tr>
                    {header('text', '词语')}
                    {header('occurrences', '出现次数')}
                    {header('document_count', '博文数')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((term, index) => (
                    <tr
                      key={term.text}
                      data-selected={current?.text === term.text}
                    >
                      <td>
                        <button
                          className="word-select"
                          type="button"
                          id={`word-${index}`}
                          aria-pressed={current?.text === term.text}
                          onClick={() => setSelected(term.text)}
                          onKeyDown={(event) => selectNext(event, term)}
                        >
                          {term.text}
                        </button>
                      </td>
                      <td className="number-cell">
                        {term.occurrences.toLocaleString()}
                      </td>
                      <td className="number-cell">
                        {term.document_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {terms.length === 0 && (
                <p className="empty-inline">
                  {result.terms.length
                    ? '没有匹配的词语。'
                    : '没有保留下来的词语。请扩大时间范围，或检查停用词和个人词典。'}
                </p>
              )}
            </div>
            <div className="table-footer">
              <span>
                {query
                  ? `找到 ${terms.length} 个词`
                  : `共 ${terms.length.toLocaleString()} 个词`}
              </span>
              {terms.length > pageSize && (
                <div className="pagination">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {page + 1} / {Math.ceil(terms.length / pageSize)}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * pageSize >= terms.length}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        }
        second={
          <aside className="term-detail" aria-label="所选词语的原文例句">
            {current ? (
              <>
                <div className="term-detail-heading">
                  <h1>{current.text}</h1>
                  <span>原文例句</span>
                </div>
                <p className="term-count">
                  {current.occurrences.toLocaleString()} 次 ·{' '}
                  {current.document_count.toLocaleString()} 篇博文
                </p>
                <div className="excerpts">
                  {current.examples.map((example) => {
                    const post = posts.find((item) =>
                      item.text.includes(example),
                    );
                    return (
                      <article className="excerpt" key={example}>
                        {post && (
                          <time dateTime={post.createdAt}>{post.date}</time>
                        )}
                        <p>
                          <Highlight text={example} word={current.text} />
                        </p>
                      </article>
                    );
                  })}
                </div>
                <div className="term-actions">
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        disabled || stale || stopwords.has(current.text)
                      }
                      onClick={() => onEdit('stopwords', current.text)}
                    >
                      {stopwords.has(current.text)
                        ? '已在停用词表'
                        : '加入停用词…'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        disabled || stale || dictionary.has(current.text)
                      }
                      onClick={() => onEdit('dictionary', current.text)}
                    >
                      {dictionary.has(current.text)
                        ? '已在个人词典'
                        : '加入个人词典…'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="empty-inline">选择上方词语查看原文例句。</p>
            )}
          </aside>
        }
      />
    </section>
  );
}
