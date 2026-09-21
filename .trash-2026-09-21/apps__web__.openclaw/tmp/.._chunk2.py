import io, sys, glob, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
found = []
for p in glob.glob('.next/**/*.js', recursive=True):
    try:
        data = open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    if 'черновик' in data:
        found.append(p)
for f in found[:20]:
    print(f)
print('total', len(found))
