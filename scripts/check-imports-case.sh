#!/bin/sh
# Проверка соответствия импортов и имён файлов (по регистру).
#
# Зачем: 28.09.2026 выкладка дважды падала на сборке веб-части с ошибкой
# «Module not found: '@/lib/calcModes'». Причина — файл в репозитории лежал
# как calcmodes.ts (нижний регистр), а импорт просил calcModes. На Windows такое
# невидимо: файловая система не различает регистр, локальная сборка проходит.
# На Linux сборка падает. Эта проверка ловит класс ошибок целиком, до сборки.
#
# Устройство: находим все файлы .ts/.tsx, достаём из них импорты с префиксом @/
# и для каждого ищем файл с ТОЧНЫМ регистром. Если файла нет — печатаем список
# и выходим с кодом 1.
#
# ВАЖНО: если проверка не смогла найти ни одного импорта, это тоже ошибка —
# иначе она молча «проходит», ничего не проверив (так и случилось на первой
# версии: облегчённый grep в контейнере не понял ключ --include и отдал пустоту).

set -e

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root/apps/web"

files=$(find app components lib -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null || true)
if [ -z "$files" ]; then
  echo "Проверка не выполнила работу: не найдено ни одного файла .ts/.tsx"
  exit 1
fi

imports=$(
  echo "$files" | while read -r f; do
    sed -nE "s/.*from ['\"]@\/([^'\"]+).*/\1/p" "$f"
  done | sort -u
)

if [ -z "$imports" ]; then
  echo "Проверка не выполнила работу: не найдено ни одного импорта с префиксом @/"
  exit 1
fi

missing=''
for p in $imports; do
  found=''
  for cand in "$p" "$p.ts" "$p.tsx" "$p.js" "$p/index.ts" "$p/index.tsx" "$p/index.js"; do
    if [ -f "$cand" ]; then found="$cand"; break; fi
  done
  if [ -z "$found" ]; then
    missing="$missing
@/$p"
  fi
done

if [ -n "$missing" ]; then
  echo "Импорты без файла (проверить регистр и путь):$missing"
  exit 1
fi

count=$(echo "$imports" | wc -l | tr -d ' ')
echo "Импорты соответствуют именам файлов (проверено путей: $count)"
