import Link from "next/link";
import { Button } from "./ui/primitives";

export function pageNumber(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

export function Pagination({ page, size, total, path, filters = {} }: {
  page: number; size: number; total: number; path: string; filters?: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1 && page === 1) return null;
  function href(target: number) {
    return path + "?" + new URLSearchParams({ ...filters, pagina: String(target) }).toString();
  }
  return <nav aria-label="Paginação" className="pagination">
    {page > 1 && <Button asChild variant="secondary" size="small"><Link href={href(page - 1)}>Anterior</Link></Button>}
    <span className="subtle">Página {page} de {pages}</span>
    {page < pages && <Button asChild variant="secondary" size="small"><Link href={href(page + 1)}>Próxima</Link></Button>}
  </nav>;
}
