import subprocess
cmds = "cd /opt/profyplan && docker compose restart web && sleep 3 && curl -s -o /dev/null -w '%{http_code}' http://localhost:8002/"
r = subprocess.run(['ssh', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no', 'root@31.184.198.113', cmds], capture_output=True, text=True, timeout=20)
print('STDOUT:', r.stdout)
print('STDERR:', r.stderr)
