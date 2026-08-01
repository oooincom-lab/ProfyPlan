/**
 * ProfyPlan Dashboard — главная страница.
 */
'use client';

import Link from 'next/link';

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
      gap: '32px',
      padding: '0 24px',
    }}>
      {/* Logo */}
      <div style={{
        width: 56, height: 56,
        background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
        borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(59,130,246,0.35)',
      }}>
        <svg viewBox="0 0 28 28" fill="none" width="28" height="28">
          <circle cx="7" cy="7" r="3.5" fill="white"/>
          <circle cx="21" cy="7" r="3.5" fill="white"/>
          <circle cx="7" cy="21" r="3.5" fill="white"/>
          <circle cx="21" cy="21" r="3.5" fill="white"/>
          <line x1="10.5" y1="7" x2="17.5" y2="7" stroke="white" strokeWidth="1.5"/>
          <line x1="7" y1="10.5" x2="7" y2="17.5" stroke="white" strokeWidth="1.5"/>
          <line x1="21" y1="10.5" x2="21" y2="17.5" stroke="white" strokeWidth="1.5"/>
          <line x1="10.5" y1="21" x2="17.5" y2="21" stroke="white" strokeWidth="1.5"/>
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
          ProfyPlan
        </h1>
        <p style={{ color: 'var(--fg-3)', fontSize: 16, marginTop: 8 }}>
          CPM, PERT и CCM в одном сервисе. Точный план производства за 5 минут.
        </p>
      </div>

      {/* Инструменты */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 16, maxWidth: 900, width: '100%',
      }}>
        {/* CPM */}
        <Link
          href="/cpm"
          style={{
            padding: '20px 24px',
            borderRadius: 12,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            textDecoration: 'none',
            color: 'var(--fg)',
            transition: 'border-color 0.2s',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>CPM</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Критический путь · Сетевой график · Резервы
          </div>
          <div style={{
            marginTop: 12, fontSize: 10,
            fontFamily: 'IBM Plex Mono, monospace',
            color: 'var(--accent-3)',
            background: 'rgba(59,130,246,0.1)',
            borderRadius: 100, padding: '2px 10px', display: 'inline-block',
          }}>
            Старт
          </div>
        </Link>

        {/* CCM */}
        <Link
          href="/ccm"
          style={{
            padding: '20px 24px',
            borderRadius: 12,
            background: 'var(--bg-2)',
            border: '1px solid var(--accent)',
            textDecoration: 'none',
            color: 'var(--fg)',
            transition: 'border-color 0.2s',
            boxShadow: '0 0 20px rgba(59,130,246,0.08)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>CCM</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Multi-Project · Resource Leveling · Гант
          </div>
          <div style={{
            marginTop: 12, fontSize: 10,
            fontFamily: 'IBM Plex Mono, monospace',
            color: 'var(--success)',
            background: 'rgba(16,185,129,0.1)',
            borderRadius: 100, padding: '2px 10px', display: 'inline-block',
          }}>
            Про
          </div>
        </Link>

        {/* PERT */}
        <div style={{
          padding: '20px 24px',
          borderRadius: 12,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          opacity: 0.5,
          cursor: 'not-allowed',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>PERT</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Вероятностная оценка · Риски · Monte-Carlo
          </div>
          <div style={{
            marginTop: 12, fontSize: 10,
            fontFamily: 'IBM Plex Mono, monospace',
            color: 'var(--fg-4)',
            background: 'rgba(90,112,144,0.1)',
            borderRadius: 100, padding: '2px 10px', display: 'inline-block',
          }}>
            Скоро
          </div>
        </div>
      </div>
    </main>
  );
}
