"""Create only this project's isolated acceptance database/service. Never touches live sites."""
from pathlib import Path
import json, os, secrets, subprocess, sys, tarfile

artifact = Path(sys.argv[1]).resolve()
release_id = sys.argv[2]
assert release_id.replace('-', '').isalnum() and len(release_id) < 70
base = Path('/opt/iot-city-acceptance')
release = base / 'releases' / release_id
assert release.resolve().is_relative_to(base)
assert not release.exists(), 'Release already exists'
release.mkdir(parents=True)
with tarfile.open(artifact) as archive:
    for member in archive.getmembers():
        assert (release / member.name).resolve().is_relative_to(release)
    archive.extractall(release, filter='data')
subprocess.run(['npm', 'ci', '--omit=dev', '--workspaces=false', '--no-audit', '--no-fund'], cwd=release, check=True)
config = Path('/etc/iot-city-acceptance.env')
if not config.exists():
    password = secrets.token_urlsafe(32)
    admin_password = 'Qa7_' + secrets.token_urlsafe(26)
    sql = f"CREATE DATABASE IF NOT EXISTS iot_city_acceptance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'iot_city_acceptance'@'127.0.0.1' IDENTIFIED BY '{password}'; GRANT ALL PRIVILEGES ON iot_city_acceptance.* TO 'iot_city_acceptance'@'127.0.0.1';"
    subprocess.run(['mysql'], input=sql, text=True, check=True, capture_output=True)
    content = '\n'.join(['NODE_ENV=test', 'HOST=127.0.0.1', 'PORT=3221', 'PUBLIC_ORIGIN=http://127.0.0.1:3221', 'DB_HOST=127.0.0.1', 'DB_PORT=3306', 'DB_NAME=iot_city_acceptance', 'DB_USER=iot_city_acceptance', 'DB_PASSWORD=' + password, 'ADMIN_USERNAME=acceptance_admin', 'ADMIN_PASSWORD=' + admin_password]) + '\n'
    fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
user = subprocess.run(['id', 'iotcityqa'], capture_output=True)
if user.returncode:
    subprocess.run(['useradd', '--system', '--home-dir', '/var/lib/iot-city-acceptance', '--create-home', '--shell', '/usr/sbin/nologin', 'iotcityqa'], check=True)
subprocess.run(['chown', '-R', 'root:root', str(release)], check=True)
unit = f'''[Unit]
Description=IoT City isolated acceptance service
After=network.target mysql.service
[Service]
Type=simple
User=iotcityqa
Group=iotcityqa
WorkingDirectory={release}
EnvironmentFile=/etc/iot-city-acceptance.env
ExecStart=/usr/bin/node {release}/dist/server.mjs
Restart=on-failure
RestartSec=5
MemoryMax=512M
CPUQuota=150%
TasksMax=96
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/iot-city-acceptance
[Install]
WantedBy=multi-user.target
'''
Path('/etc/systemd/system/iot-city-acceptance.service').write_text(unit)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'restart', 'iot-city-acceptance.service'], check=True)
print(json.dumps({'service': 'iot-city-acceptance.service', 'release': str(release), 'port': 3221, 'scope': 'isolated acceptance only', 'secrets': 'stored in root-only env file, not printed'}))
