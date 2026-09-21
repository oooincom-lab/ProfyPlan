import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
p = '.next/static/chunks/app/workspace/page-8f5a251818f16736.js'
data = open(p, encoding='utf-8', errors='replace').read()
for needle in ['черновик ·', 'по данным', 'timelineDraft', 'buildDraftTimeline', 'черновик — без расчёта']:
    print(repr(needle), '->', needle in data)
