import io, sys, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
for p in glob.glob('.next/static/chunks/app/workspace/*.js'):
    data = open(p, encoding='utf-8', errors='replace').read()
    print(p)
    for needle in ['Подразделение: ', 'Этап ', 'stage']:
        print('   ', repr(needle), '->', needle in data)
