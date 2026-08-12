import subprocess
cmds = "cd /opt/profyplan && docker compose restart web && sleep 3 && echo OK"
r = subprocess.run(['ssh', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no', 'root@31.184.198.113', cmds], capture_output=True, text=True, timeout=30)
print('STDOUT:', r.stdout)
print('STDERR:', r.stderr)
print('RC:', r.returncode)
