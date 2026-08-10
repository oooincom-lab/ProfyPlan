import subprocess, sys
ssh_cmd = ['ssh', '-i', r'C:\Users\user\.ssh\id_ed25519', '-o', 'StrictHostKeyChecking=no', 'root@31.184.198.113']

# Remove old .next in container and copy new one
cmds = """
rm -rf /opt/profyplan/web-tmp && mkdir -p /opt/profyplan/web-tmp
cd /opt/profyplan/web-tmp && tar xzf /tmp/web.tar.gz
docker cp /opt/profyplan/web-tmp/. profyplan-web:/app/.next/
rm -rf /opt/profyplan/web-tmp /tmp/web.tar.gz
docker compose -f /opt/profyplan/docker-compose.yml restart web
echo "DONE"
"""

r = subprocess.run(ssh_cmd + [cmds], capture_output=True, text=True, timeout=30)
print('STDOUT:', r.stdout)
print('STDERR:', r.stderr)
print('RC:', r.returncode)
