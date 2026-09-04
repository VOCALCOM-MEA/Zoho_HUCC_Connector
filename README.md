# Vocalcom HUCC Connector for Zoho CRM

Zoho Sigma extension that embeds the Vocalcom Hermes HUCC softphone in Zoho CRM and bridges screen-pop / click-to-call to Contacts and Leads — equivalent to the [Odoo HUCC Connector](https://github.com/VOCALCOM-MEA/Odoo_HUCC_Connector) POC.

## What is Sigma vs CRM vs Sandbox?

| Term | Meaning |
|------|---------|
| **Zoho Sigma** | Developer portal to build, pack, and publish Zoho extensions (widgets, connectors). You upload a zip of this repo's `extension/` folder. |
| **Zoho CRM** | The CRM product where agents work. After installing the extension, a **Web Tab** widget appears in CRM. |
| **CRM Sandbox** | A copy of your CRM org for testing extensions before production. Create one under **Setup → Data Administration → Sandbox** (Enterprise/Ultimate). Install the extension in sandbox first. |

## Prerequisites

- Zoho CRM **Professional, Enterprise, or Ultimate**
- **Developer Permissions** enabled on your profile: **Setup → Users and Control → Security Control → [Profile] → Developer Permissions**
- Access to [Zoho Sigma](https://sigma.zoho.com) (same Zoho account)
- Vocalcom HUCC demo or production environment

## Demo credentials (POC only)

| Setting | Value |
|---------|-------|
| Login (`userId`) | `1013` |
| Password | `123456` |
| Station (`agentStation`) | `86659` |
| Customer ID | `10` |
| Config code (demo) | `HUCCPluginConfiguration360` |

Agents confirm/edit **station** in the widget toolbar, then click **Log in** inside the Vocalcom panel. Login and password are pre-filled (not typed by the agent).

## Config code from Vocalcom

The demo uses `HUCCPluginConfiguration360` (Dynamics-style POC config).

For production Zoho CRM, **ask Vocalcom** for a Zoho-specific plugin configuration. Use placeholder:

```
HUCCPluginConfigurationZoho
```

Set this in Sigma extension org variables (`hucc_config_code`) after Vocalcom provisions it.

## Repository layout

```
Zoho_HUCC_Connector/
├── extension/              # Zip contents for Sigma upload
│   ├── plugin-manifest.json
│   ├── app/                # Widget UI + bridge scripts
│   └── config/settings.json
├── docs/ARCHITECTURE.md    # Odoo ↔ Zoho mapping
├── scripts/pack-extension.ps1
└── dist/                   # Generated zip (gitignored)
```

## Build extension zip

```powershell
cd C:\codes\VOCALCOM\Zoho_HUCC_Connector
.\scripts\pack-extension.ps1
```

Output: `dist/vocalcom_hucc.zip`

## Step-by-step: Sigma → Sandbox CRM

### 1. Create extension in Sigma

1. Go to [Sigma](https://sigma.zoho.com) → **Extensions** → **Create Extension**
2. Name: **Vocalcom HUCC**
3. Service: **CRM**
4. Choose **Upload** / import zip when prompted

### 2. Upload zip

1. Run `.\scripts\pack-extension.ps1`
2. Upload `dist/vocalcom_hucc.zip` in Sigma
3. Fix any manifest validation errors Sigma reports

### 3. Configure org variables

In Sigma extension settings, set (or keep defaults):

| Variable | Demo default |
|----------|--------------|
| `hucc_front_url` | `https://cdn01.demo.hermes.vocalcom.com/hermes360/HUCC/ProxyHermesFront` |
| `hucc_loader_url` | `…/StandAlone/login2.js` |
| `hucc_proxy_config` | `…/ProxyHermesConfig` |
| `hucc_config_code` | `HUCCPluginConfiguration360` (replace with Zoho code from Vocalcom) |
| `hucc_customer_id` | `10` |

### 4. Install in CRM sandbox

1. Open your **CRM sandbox** org
2. **Setup → Developer Hub → Widgets** (or Marketplace / Extensions, depending on edition)
3. Install the published extension
4. Add widget to a **Web Tab**: **Setup → Customization → Web Tabs** → create tab linked to **Vocalcom HUCC** widget

### 5. Per-user credentials

Default demo credentials load from `extension/config/settings.json` on first run.

Per-user values are stored in browser `localStorage` keyed by Zoho user ID:

```javascript
// Key: vocalcom_hucc_user_{zohoUserId}
{ "login": "1013", "password": "123456", "station": "86659" }
```

**Production:** map to Zoho user custom fields and update `widget.js` to read them via `ZOHO.CRM.API.getUser({ID})` instead of demo defaults.

## Test plan

1. Open CRM sandbox → **Web Tab: Vocalcom HUCC**
2. Widget loads; status shows station hint
3. Confirm station **86659** (or your assigned station) → **Save station** → **Reload phone**
4. Inside iframe, click **Log in** (manual — do not expect auto-login)
5. Place or receive a test call on a number that exists as a Contact/Lead
6. **Expected:** CRM opens matching Contact or Lead (screen-pop)
7. Optional: click a `tel:` link → outbound dial via HUCC

### Softphone popups

If Vocalcom opens an extra softphone/CTI window, you may close it. Only one CTI session should stay active. The iframe sandbox allows popups for WebRTC.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Blank iframe | Browser console; whitelist `cdn01.demo.hermes.vocalcom.com` in manifest |
| Login fields empty | URL params / `setHUCCSettings` — verify user creds in localStorage |
| No screen-pop | Bridge injected? Look for `bridge_ready` status; verify phone exists in CRM |
| Wrong HUCC behavior | Confirm **configCode** with Vocalcom (Zoho-specific vs `360`) |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for Odoo ↔ Zoho component mapping.

## License

Internal VOCALCOM MEA project — see organization policy.
