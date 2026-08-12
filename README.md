# Network Map Script

## What This Project Does
This project scans local network subnets and stores maps in a local API/database.

It includes:
- `network-scanner.ps1`: PowerShell scanner and uploader.
- Web UI at `http://localhost:9009`: view/edit topology maps.
- API at `http://localhost:9008`: authentication and map storage.

## Quick Start
1. Build scanner executable for download:
	`.\\prepare-scanner-download.ps1`
2. Start the local stack:
	`docker compose up --build`
3. Run the scanner:
	`.\\network-scanner.ps1`
4. Open the web UI:
	`http://localhost:9009`

The API creates the SQLite database file automatically if it does not exist.
The frontend build includes `view/download/network-scanner.exe` and exposes a header link to download it.
The downloaded EXE is a launcher that runs the scanner with `pwsh` (PowerShell 7) when available for better performance.
The scanner always prints throttled text progress updates (and also uses `Write-Progress` when available), so EXE runs show visible progress in all hosts.

## Authentication
- First access: create the initial admin user in the UI.
- After setup: sign in with username/password.
- Signed-in users can create additional users.

## Using The Scanner
Default run:
`.\network-scanner.ps1`

Useful options:
- Enable SNMP discovery:
	`.\network-scanner.ps1 -EnableSnmpDiscovery -SnmpCommunity public`
- Set one subnet prefix:
	`.\network-scanner.ps1 -SubnetRange 10.0.0.`
- Set multiple subnet prefixes:
	`.\network-scanner.ps1 -SubnetRanges 192.168.1.,10.0.0.`
- Provide API key directly:
	`.\network-scanner.ps1 -ApiKey <your_api_key>`
- Default API URL:
	`https://api-lan-map.portoinf-server.com/`


Notes:
- If no subnet is provided, the script asks whether to scan all local subnets (Enter defaults to Yes).
- Upload uses `x-api-key`.
- Local output JSON is removed after successful upload.

## Using The Web UI
1. Sign in.
2. Click `Refresh Saved Maps`.
3. Select and `Load Selected Map`.
4. Edit nodes, add dumb switches, and drag/drop to build topology.
5. Click `Upload To API` to create or update a map.
6. Use `Delete Selected Map` to remove a saved map.

## Developer Notes
- Main frontend files:
	- `view/index.html`
	- `view/app.js`
	- `view/styles.css`
- Header logo file:
	- `view/img/logo.jpg`
- Compose/config:
	- `compose.yaml`

Core API endpoints:
- `GET /api/auth/status`
- `POST /api/auth/setup-admin`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/users`
- `POST /api/maps`
- `GET /api/maps`
- `GET /api/maps/:id`
- `PUT /api/maps/:id`
- `DELETE /api/maps/:id`
