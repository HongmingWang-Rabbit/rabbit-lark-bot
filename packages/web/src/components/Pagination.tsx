'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}

export default function Pagination({ page, totalPages, total, pageSize, onPageChange }: PaginationProps) {
  const pages: (number | '...')[] = [];
  const addPage = (n: number) => {
    if (n < 1 || n > totalPages) return;
    if (pages[pages.length - 1] === n) return;
    pages.push(n);
  };
  const addEllipsis = () => {
    if (pages[pages.length - 1] !== '...') pages.push('...');
  };

  addPage(1);
  if (page - 3 > 2) addEllipsis();
  for (let i = Math.max(2, page - 2); i <= Math.min(totalPages - 1, page + 2); i++) addPage(i);
  if (page + 3 < totalPages - 1) addEllipsis();
  if (totalPages > 1) addPage(totalPages);

  const base     = 'px-3 py-1.5 text-sm rounded-md border transition-colors';
  const active   = `${base} bg-blue-500 text-white border-blue-500`;
  const normal   = `${base} border-gray-300 text-gray-700 hover:bg-gray-50`;
  const disabled = `${base} border-gray-200 text-gray-300 cursor-not-allowed`;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between mt-4 px-1">
      <span className="text-sm text-gray-500">
        第 {from}–{to} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className={page <= 1 ? disabled : normal}>
          ‹ 上一页
        </button>
        {pages.map((p, idx) =>
          p === '...'
            ? <span key={`e${idx}`} className="px-1 text-gray-400">…</span>
            : <button key={p} onClick={() => onPageChange(p)}
                className={p === page ? active : normal}>{p}</button>
        )}
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className={page >= totalPages ? disabled : normal}>
          下一页 ›
        </button>
      </div>
    </div>
  );
}
