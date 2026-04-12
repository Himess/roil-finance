# Backend Deployment

## Systemd Service (Linux)

```bash
# Install service
sudo cp roil-backend.service /etc/systemd/system/
sudo cp logrotate.conf /etc/logrotate.d/roil-backend
sudo systemctl daemon-reload
sudo systemctl enable roil-backend.service
sudo systemctl start roil-backend.service

# Status / logs
sudo systemctl status roil-backend.service
sudo journalctl -u roil-backend.service -f
tail -f /var/log/roil-backend.log
```

## Environment

The service reads `/root/roil-backend/.env`. Required vars:

```
CANTON_NETWORK=testnet|mainnet
PORT=3001
JSON_API_URL=http://<participant-ip>:7575
PLATFORM_PARTY=roil::1220...
LEDGER_USER_ID=ledger-api-user
JWT_MODE=hmac256
JWT_SECRET=<strong-secret>
```

## Auto-restart

`Restart=on-failure` + `RestartSec=10` — systemd restarts the service
10 seconds after any non-clean exit. Verified working 2026-04-12.

## Logs

Logs go to both:
- `journalctl -u roil-backend.service`
- `/var/log/roil-backend.log` (rotated daily, 14 days retention, 100M cap)
