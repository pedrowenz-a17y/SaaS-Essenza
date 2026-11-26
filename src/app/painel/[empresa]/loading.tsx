export default function Loading() {
  return <div className="page-stack" aria-busy="true" aria-label="Carregando painel">
    <div className="skeleton" /><div className="kpi-grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
    <div className="skeleton" />
  </div>;
}
