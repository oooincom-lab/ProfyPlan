export default function NotFound() {
  return (
    <main style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0B1526', color: '#E8EEF5', fontFamily: 'Segoe UI, Roboto, Arial, sans-serif', padding: 24,
    }}>
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🧭</div>
        <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>Эта страница переехала</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#8FA3BD', margin: '0 0 18px' }}>
          Отдельных страниц для расчётов и графиков больше нет: сетевой график, критическая цепь,
          панели ресурсов, отчёты и инструменты открываются внутри рабочего стола — в контексте
          выбранного проекта, куста или заказа. Единая шкала времени и общие настройки работают
          одинаково во всех видах.
        </p>
        <a href="/workspace" style={{
          display: 'inline-block', background: '#12304F', border: '1px solid #2B5B92', color: '#DBEAFE',
          borderRadius: 10, padding: '9px 18px', fontSize: 14, textDecoration: 'none',
        }}>Открыть рабочий стол</a>
        <div style={{ fontSize: 12, color: '#5A7090', marginTop: 14 }}>
          Если вы пришли по старой ссылке — сохраните адрес рабочего стола: /workspace
        </div>
      </div>
    </main>
  );
}
