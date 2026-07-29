import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProfyPlan — Производственное планирование',
  description: 'CPM, PERT и CCM в одном сервисе. Точный план производства за 5 минут.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
