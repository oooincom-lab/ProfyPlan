import io, sys, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
for p in glob.glob('.next/static/chunks/app/workspace/*.js'):
    data = open(p, encoding='utf-8', errors='replace').read()
    print(p)
    # markers: reserved collapse slot width 22 + bigger font
    print('   width:22 slot ->', 'width:22' in data)
    print('   fontSize:16  ->', 'fontSize:16' in data)
    print('   size bytes   ->', len(data))
