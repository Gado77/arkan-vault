import paramiko
import sys

host = '192.168.1.19'
user = 'vitor'
password = 'Vitor123!'

print(f"Connecting to {user}@{host}...")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(host, username=user, password=password)
    print("Connected successfully!")
    
    commands = [
        "bash -c 'cd /opt/arkan-vault && git init && git remote add origin https://github.com/Gado77/arkan-vault.git || true && git fetch origin && git reset --hard origin/main'",
        "chown -R vitor:vitor /opt/arkan-vault",
        "systemctl daemon-reload",
        "systemctl restart arkan-vault.service"
    ]
    
    for cmd in commands:
        print(f"Running: {cmd}")
        # sudo requires pty=True usually, but it might prompt for password.
        # We can pass password via stdin for sudo.
        stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' {cmd[5:] if cmd.startswith('sudo ') else cmd}", get_pty=True)
        stdin.write(password + '\n')
        stdin.flush()
        
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8')
        err = stderr.read().decode('utf-8')
        
        print("Output:", out)
        if err:
            print("Error:", err)
        print(f"Exit status: {exit_status}\n")

except Exception as e:
    print(f"Failed: {e}")
finally:
    ssh.close()
