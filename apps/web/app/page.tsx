export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      color: 'var(--fg)',
      fontFamily: 'Inter, system-ui, sans-serif',
      gap: '24px',
    }}>
      <div style={{
        width: 48, height: 48,
        background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
        borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
      }}>
        <svg viewBox="0 0 26 26" fill="none" width="26" height="26">
          <circle cx="6" cy="6" r="3" fill="white"/>
          <circle cx="20" cy="6" r="3" fill="white"/>
          <circle cx="6" cy="20" r="3" fill="white"/>
          <circle cx="20" cy="20" r="3" fill="white"/>
          <line x1="9" y1="6" x2="17" y2="6" stroke="white" strokeWidth="1.5"/>
          <line x1="6" y1="9" x2="6" y2="17" stroke="white" strokeWidth="1.5"/>
          <line x1="20" y1="9" x2="20" y2="17" stroke="white" strokeWidth="1.5"/>
          <line x1="9" y1="20" x2="17" y2="20" stroke="white" strokeWidth="1.5"/>
        </svg>
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>ProfyPlan</h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 16 }}>
        Скоро запуск. Точный план производства — CPM, PERT, CCM в одном сервисе.
      </p>
    </main>
  );
}
