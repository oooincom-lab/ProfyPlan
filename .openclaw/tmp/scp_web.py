import subprocess, sys
r = subprocess.run([
    'scp', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no',
    r'C:\Users\user\.openclaw-autoclaw\agents\auto-designer\workspace\profyplan\.openclaw\tmp\web.tar.gz',
    'root@31.184.198.113:/tmp/web.tar.gz'
], capture_output=True, text=True, timeout=30)
print('STDOUT:', r.stdout)
print('STDERR:', r.stderr)
print('RC:', r.returncode)
