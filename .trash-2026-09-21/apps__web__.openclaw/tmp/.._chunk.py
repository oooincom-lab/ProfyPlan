import io, sys, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
for p in glob.glob('.next/static/chunks/*.js'):
    try:
        data = open(p, encoding='utf-8', errors='replace').read()
    except Exception as e:
        continue
    for needle in ['черновик', 'buildDraftTimeline', 'по данным']:
        if needle in data:
            print(p, '->', needle)
