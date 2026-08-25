/**
 * ExcelImportWizard — drag-and-drop загрузка .xlsx (7-вкладочный или 3-вкладочный формат).
 *   Рабочие вкладки: 2-Заказы / 3-BOM / 5-Маршруты.
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import { importProductionOrders, explodeAndSaveBOM, runCPM } from '@/lib/api';
import type { ImportValidationError as ImportError, ExcelImportResult } from '@/lib/api';
import DebugBadge from './DebugBadge';

interface Props {
  projectId: string;
  onComplete?: (result: ExcelImportResult) => void;
  onClose: () => void;
  debug?: boolean;
}

type Step = 'upload' | 'importing' | 'result' | 'exploding' | 'done';

export default function ExcelImportWizard({ projectId, onComplete, onClose, debug = false }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explodeResult, setExplodeResult] = useState<any>(null);
  const [cpmResult, setCpmResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
      setFile(f);
      setError(null);
    } else {
      setError('Поддерживаются только файлы .xlsx / .xls');
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setError(null); }
  };

  const doImport = async () => {
    if (!file) return;
    setStep('importing');
    setError(null);
    try {
      const r = await importProductionOrders(file, projectId);
      setResult(r);
      if (r.orders_created === 0 && r.bom_nodes_created === 0) {
        setStep('result');
      } else {
        // Auto-explode BOM
        setStep('exploding');
        try {
          const exp = await explodeAndSaveBOM(projectId);
          setExplodeResult(exp);
          // Run CPM
          try {
            const cpm = await runCPM(projectId);
            setCpmResult(cpm);
          } catch { /* CPM optional */ }
        } catch { /* explode optional */ }
        setStep('done');
        onComplete?.(r);
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка импорта');
      setStep('upload');
    }
  };

  const style = {
    overlay: {
      position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    card: {
      background: 'var(--bg-2, #0F1E36)', border: '1px solid var(--border, #1E3252)',
      borderRadius: 12, width: 520, maxHeight: '80vh', overflow: 'hidden',
      display: 'flex', flexDirection: 'column' as const,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    },
    header: {
      padding: '16px 20px', borderBottom: '1px solid var(--border, #1E3252)',
      display: 'flex', alignItems: 'center', gap: 10,
    },
    body: {
      padding: '20px', flex: 1, overflowY: 'auto' as const,
      fontSize: 13, color: 'var(--fg-2, #B0C4DE)', lineHeight: 1.6,
    },
    dropzone: (active: boolean) => ({
      border: `2px dashed ${active ? 'var(--accent, #4FC3F7)' : 'var(--border, #1E3252)'}`,
      borderRadius: 10, padding: '40px 20px', textAlign: 'center' as const,
      cursor: 'pointer', background: active ? 'rgba(79,195,247,0.06)' : 'transparent',
      transition: 'all 0.2s',
    }),
    btn: (variant: 'primary' | 'secondary' | 'danger') => {
      const colors: Record<string, string[]> = {
        primary: ['#4FC3F7', '#0288D1', '#fff'],
        secondary: ['transparent', 'var(--border, #1E3252)', 'var(--fg-2, #B0C4DE)'],
        danger: ['#EF5350', '#C62828', '#fff'],
      };
      const [bg, bd, fg] = colors[variant] || colors.primary;
      return {
        padding: '8px 18px', borderRadius: 8, border: `1px solid ${bd}`,
        background: bg, color: fg, fontSize: 13, fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.15s',
      };
    },
    statBox: {
      background: 'var(--bg-1, #071426)', borderRadius: 8, padding: '12px 16px',
      border: '1px solid var(--border, #1E3252)',
    },
    tag: (color: string) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      background: `${color}20`, color, fontSize: 11, fontWeight: 600,
    }),
    errorRow: {
      padding: '6px 10px', background: 'rgba(239,83,80,0.1)', borderRadius: 6,
      marginBottom: 6, fontSize: 12,
    },
  };

  return (
    <div style={style.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={style.card}>
        {/* Header */}
        <div style={style.header}>
          <span style={{ fontSize: 22 }}>📊</span>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            Импорт заказов и BOM
          </h3>
          <DebugBadge debug={debug} text="[import:wizard]" copy="[import:wizard] «Импорт заказов и BOM»" />
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--fg-2, #B0C4DE)',
            fontSize: 18, cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={style.body}>
          {step === 'upload' && (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                Загрузите Excel-файл с вкладками <strong>2-Заказы</strong>, <strong>3-BOM</strong> и <strong>5-Маршруты</strong> (дополнительные вкладки «1-Настройки», «4-Ресурсы», «6-Этапы», «7-Подразделения» — справочные).
              </p>

              <div
                style={style.dropzone(dragOver)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1, #E0E8F0)' }}>{file.name}</div>
                    <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-3, #7A8FA8)' }}>
                      {(file.size / 1024).toFixed(1)} KB — нажмите, чтобы заменить
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>📁</div>
                    <div style={{ fontSize: 14, color: 'var(--fg-2, #B0C4DE)' }}>
                      Перетащите .xlsx сюда или нажмите для выбора
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>

              {error && (
                <div style={{ marginTop: 12, color: '#EF5350', fontSize: 12 }}>⚠ {error}</div>
              )}

              <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button style={style.btn('secondary')} onClick={onClose}>Отмена</button>
                <button
                  style={{ ...style.btn('primary'), opacity: file ? 1 : 0.5 }}
                  disabled={!file}
                  onClick={doImport}
                >
                  Импортировать
                </button>
              </div>
            </>
          )}

          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 14, color: 'var(--fg-1, #E0E8F0)' }}>Импорт данных...</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-3, #7A8FA8)' }}>{file?.name}</div>
            </div>
          )}

          {step === 'exploding' && (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔄</div>
              <div style={{ fontSize: 14, color: 'var(--fg-1, #E0E8F0)' }}>Развёртка BOM → CPM...</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-3, #7A8FA8)' }}>
                Создание операций и зависимостей
              </div>
            </div>
          )}

          {(step === 'done' || step === 'result') && result && (
            <>
              {/* Загружено */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)', marginBottom: 8 }}>Загружено</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.orders_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Заказов</div>
                </div>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.bom_nodes_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>BOM-узлов</div>
                </div>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.routings_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Маршрутов</div>
                </div>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.routing_ops_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Операций</div>
                </div>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.resources_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Ресурсов</div>
                </div>
              </div>

              {/* Сопоставлено со справочником */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)', marginBottom: 8 }}>Сопоставлено со справочником</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.nomenclature_created}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Позиций создано</div>
                </div>
                <div style={style.statBox}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1, #E0E8F0)' }}>{result.nomenclature_linked}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3, #7A8FA8)' }}>Позиций связано</div>
                </div>
              </div>

              {/* Explode result */}
              {explodeResult && (
                <div style={{...style.statBox, marginBottom: 10, borderColor: 'var(--accent, #4FC3F7)'}}>
                  <div style={{ display: 'flex', gap: 20 }}>
                    <span>🔧 <strong>{explodeResult.created_operations}</strong> CPM-операций</span>
                    <span>🔗 <strong>{explodeResult.created_dependencies}</strong> связей</span>
                    {cpmResult && (
                      <span>📐 <strong>{cpmResult.total_duration?.toFixed(1)}</strong>ч makespan</span>
                    )}
                  </div>
                </div>
              )}

              {/* Ошибки */}
              {result.errors.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#EF5350', marginBottom: 8 }}>
                    Ошибки ({result.errors.length})
                  </div>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <div key={i} style={style.errorRow}>
                      <span style={style.tag('#EF5350')}>{e.sheet}</span>
                      {' '}стр.{e.row} — {e.message}
                    </div>
                  ))}
                  {result.errors.length > 5 && (
                    <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      ...и ещё {result.errors.length - 5}
                    </div>
                  )}
                </div>
              )}

              {/* Предупреждения */}
              {result.warnings?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#FFB300', marginBottom: 8 }}>
                    Предупреждения ({result.warnings.length})
                  </div>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: 'rgba(255,179,0,0.1)', borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Success state */}
              {result.errors.length === 0 && result.orders_created > 0 && (
                <div style={{
                  marginTop: 12, padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)',
                  fontSize: 13, color: '#81C784',
                }}>
                  ✅ Импорт успешен! Данные готовы к расчёту.
                </div>
              )}

              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button style={style.btn('primary')} onClick={onClose}>Готово</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
