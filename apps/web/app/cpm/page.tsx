/**
 * CPM page — однопоточный сетевой график.
 */
import { redirect } from 'next/navigation';

export default function CPMPage() {
  // Пока редирект на HTML-прототип, позже — React Flow компонент
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--fg)', flexDirection: 'column', gap: 16,
    }}>
      <p style={{ color: 'var(--fg-3)', fontSize: 14 }}>
        Сетевой график CPM — выберите проект для визуализации
      </p>
      <iframe
        src="/network-graph.html"
        style={{ width: '100%', height: 'calc(100vh - 60px)', border: 'none' }}
      />
    </div>
  );
}
