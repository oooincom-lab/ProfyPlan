import subprocess
# SCP
r = subprocess.run([
    'scp', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no',
    r'C:\Users\user\.openclaw-autoclaw\agents\auto-designer\workspace\profyplan\.openclaw\tmp\web2.tar.gz',
    'root@31.184.198.113:/tmp/web.tar.gz'
], capture_output=True, text=True, timeout=30)
print('SCP:', r.returncode)

# Deploy
cmds = "rm -rf /opt/profyplan/web-tmp && mkdir -p /opt/profyplan/web-tmp && cd /opt/profyplan/web-tmp && tar xzf /tmp/web.tar.gz && docker cp /opt/profyplan/web-tmp/. profyplan-web:/app/.next/ && rm -rf /opt/profyplan/web-tmp /tmp/web.tar.gz && cd /opt/profyplan && docker compose restart web && sleep 3 && echo DEPLOYED"
r2 = subprocess.run(['ssh', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no', 'root@31.184.198.113', cmds], capture_output=True, text=True, timeout=30)
print('SSH:', r2.stdout.strip())
if r2.stderr: print('ERR:', r2.stderr.strip())
