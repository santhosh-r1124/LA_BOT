import { ArrowRightIcon } from '@/components/icons';
import { formatCount } from '@/lib/format';
import { pageWindow } from './page-window';

export function Pagination({
  page,
  pages,
  total,
  pageSize,
  disabled,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const items = pageWindow(page, pages);

  return (
    <nav aria-label="Pagination" className="pager mt-6">
      <p className="pager-info hidden min-[480px]:block" aria-hidden="true">
        {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </p>
      <div className="pager-nav">
        <button
          type="button"
          className="pager-btn border-line-strong h-10 min-w-10"
          disabled={page <= 1 || disabled}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ArrowRightIcon className="rotate-180" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {/* Narrow screens get "Page 3 of 50" between the arrows instead of numbers. */}
        <span className="pager-info px-2 min-[480px]:hidden">
          Page {page} of {pages}
        </span>
        <div className="hidden items-center gap-1 min-[480px]:flex">
          {items.map((item, i) =>
            typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                className="pager-btn h-10 min-w-10"
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}${item === page ? ', current page' : ''}`}
                disabled={disabled && item !== page}
                onClick={() => item !== page && onPage(item)}
              >
                {item}
              </button>
            ) : (
              <span key={`${item}-${i}`} className="subtle px-1 text-sm" aria-hidden="true">
                …
              </span>
            ),
          )}
        </div>
        <button
          type="button"
          className="pager-btn border-line-strong h-10 min-w-10"
          disabled={page >= pages || disabled}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ArrowRightIcon />
        </button>
      </div>
    </nav>
  );
}
