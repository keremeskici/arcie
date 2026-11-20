import { Hono } from "hono";
import { onrampClientBundle } from "./client-assets.js";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arcie Wireframe</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.45;
      color: #111;
      background: #f5f5f5;
    }
    code, pre, .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }
    /* Top Bar */
    .topbar {
      background: #fff;
      border-bottom: 1px solid #d4d4d4;
      padding: 12px 20px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid #bbb;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: #eee;
    }
    .badge.ok { border-color: #666; background: #e5e5e5; }
    .topbar-right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    /* Status Banner */
    .status-bar {
      background: #fafafa;
      border-bottom: 1px solid #e0e0e0;
      padding: 8px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
    }
    .status-bar pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      flex: 1;
    }

    /* Main 2-column Workspace */
    .workspace {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 440px;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 960px) {
      .workspace { grid-template-columns: 1fr; }
    }

    /* Subscreen Navigation Tabs */
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      border-bottom: 1px solid #ccc;
      padding-bottom: 10px;
      margin-bottom: 16px;
    }
    .tab-btn {
      padding: 8px 14px;
      border: 1px solid #ccc;
      background: #eaeaea;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: #222;
    }
    .tab-btn:hover { background: #dfdfdf; }
    .tab-btn.active {
      background: #111;
      color: #fff;
      border-color: #111;
    }
    .subscreen { display: none; }
    .subscreen.active { display: block; }

    /* Cards & Panels */
    .card {
      background: #fff;
      border: 1px solid #d4d4d4;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
    .card-title {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .card-subtitle {
      font-size: 12px;
      color: #555;
      margin-top: 2px;
    }

    /* Grid Helpers */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    @media (max-width: 600px) {
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
    }
    .stat-box {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 12px;
      background: #fafafa;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #555;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 700;
    }
    .stat-sub {
      font-size: 12px;
      color: #444;
      margin-top: 4px;
      word-break: break-all;
    }

    /* Forms & Buttons */
    .form-row {
      margin-bottom: 12px;
    }
    .form-row label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
      color: #222;
    }
    input[type="text"], input[type="number"], select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #bbb;
      border-radius: 6px;
      font-size: 13px;
      background: #fff;
      color: #111;
    }
    input[type="text"]:focus, select:focus {
      outline: 2px solid #111;
      border-color: #111;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid #999;
      border-radius: 6px;
      background: #fff;
      color: #111;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #f0f0f0; }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary {
      background: #111;
      color: #fff;
      border-color: #111;
    }
    .btn-primary:hover { background: #333; }
    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
    }

    /* Tables / Lists */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid #eee;
    }
    th {
      font-size: 11px;
      text-transform: uppercase;
      color: #555;
      border-bottom: 1px solid #ccc;
    }
    .kv-list {
      margin: 8px 0;
      padding: 0;
      list-style: none;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      background: #fafafa;
    }
    .kv-list li {
      display: flex;
      justify-content: space-between;
      padding: 7px 10px;
      border-bottom: 1px solid #eaeaea;
      font-size: 13px;
      gap: 8px;
    }
    .kv-list li:last-child { border-bottom: none; }

    /* Islands Dock */
    .island-box {
      border: 2px solid #222;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
      margin-bottom: 12px;
    }
    .island-box h4 {
      margin: 0 0 8px 0;
      font-size: 15px;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .chip {
      font-size: 11px;
      padding: 2px 7px;
      border: 1px solid #aaa;
      border-radius: 4px;
      background: #f0f0f0;
      font-weight: 600;
    }
    .notice-list {
      margin: 8px 0;
      padding-left: 18px;
      font-size: 12px;
      color: #333;
    }

    /* Chat History */
    .chat-box {
      border: 1px solid #ddd;
      border-radius: 6px;
      background: #fafafa;
      padding: 10px;
      height: 220px;
      overflow-y: auto;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-msg {
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #ddd;
      background: #fff;
      font-size: 13px;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: #eaeaea;
      border-color: #ccc;
    }
    .chat-msg.assistant {
      align-self: flex-start;
    }
    .chat-role {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 2px;
    }
    .empty-state {
      color: #666;
      font-size: 13px;
      font-style: italic;
      padding: 8px 0;
    }
    /* Checkout stays in the app, including when launched by voice. */
    #onramp-dialog {
      width: min(580px, calc(100vw - 24px));
      max-width: none;
      max-height: calc(100dvh - 24px);
      box-sizing: border-box;
      padding: 18px;
      border: 1px solid #d4d4d4;
      border-radius: 14px;
      box-shadow: 0 24px 80px #0004;
      overflow-y: auto;
    }
    #onramp-dialog::backdrop { background: #0008; }
    #onramp-dialog .card-header { align-items: flex-start; }
    #onramp-guidance { font-size: 12px; line-height: 1.5; color: #555; }
    #onramp-status { font-size: 13px; line-height: 1.5; margin: 12px 0; }
    #onramp-root { width: 100%; height: min(720px, 65dvh); min-height: 320px; }
    #onramp-root:empty { height: 80px; min-height: 80px; }
    #onramp-root iframe { border: 0; border-radius: 8px; }
    #onramp-destination { font-size: 11px; overflow-wrap: anywhere; }
    #btn-onramp-retry[hidden] { display: none; }
  </style>
</head>
<body>

  <!-- Top Navigation & Auth Bar -->
  <header class="topbar">
    <div class="brand">
      <h1>Arcie</h1>
      <span class="badge">Wireframe Test Harness</span>
      <span id="badge-auth" class="badge">Auth: loading</span>
      <span id="badge-sse" class="badge">SSE: Disconnected</span>
    </div>
    <div class="topbar-right">
      <span id="privy-mount"><span class="badge">Loading Privy...</span></span>
      <button id="btn-onboard" class="btn-sm" type="button">Onboard / Provision Wallet</button>
      <button id="btn-refresh-all" class="btn-sm btn-primary" type="button">Refresh All</button>
    </div>
  </header>

  <!-- Live Status / Error Feedback Bar -->
  <div class="status-bar">
    <div><strong>Last Event / API Status:</strong></div>
    <pre id="status-log">Ready.</pre>
  </div>

  <!-- Main Workspace -->
  <main class="workspace">

    <!-- LEFT COLUMN: Subscreen Divisions -->
    <section>
      <nav class="tabs" id="subscreen-tabs">
        <button type="button" class="tab-btn active" data-tab="overview">1. Overview &amp; Balances</button>
        <button type="button" class="tab-btn" data-tab="send">2. Send &amp; Receive</button>
        <button type="button" class="tab-btn" data-tab="swap">3. Swap</button>
        <button type="button" class="tab-btn" data-tab="earn">4. Earn Vaults</button>
        <button type="button" class="tab-btn" data-tab="onramp">5. Add Money (Onramp)</button>
        <button type="button" class="tab-btn" data-tab="contacts">6. Contacts</button>
        <button type="button" class="tab-btn" data-tab="activity">7. Activity &amp; Session</button>
      </nav>

      <!-- SUBSCREEN 1: OVERVIEW -->
      <div class="subscreen active" id="tab-overview">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Wallet &amp; Balances</h2>
              <div class="card-subtitle">Live onchain balances on Arc Testnet (<code>GET /balances</code> &amp; <code>GET /me</code>)</div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn-sm" id="btn-overview-receive">Show Receive Card</button>
              <button type="button" class="btn-sm" id="btn-overview-refresh">Refresh</button>
            </div>
          </div>

          <div class="grid-3" style="margin-bottom: 14px;">
            <div class="stat-box">
              <div class="stat-label">Total Portfolio (USD)</div>
              <div class="stat-value" id="stat-total-usd">—</div>
              <div class="stat-sub" id="stat-user-name">User: —</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Arc Wallet Address</div>
              <div class="stat-value mono" style="font-size: 13px;" id="stat-wallet-addr">—</div>
              <div class="stat-sub" id="stat-wallet-chain">Chain: Arc_Testnet</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Policy Limits</div>
              <div class="stat-value" id="stat-limits-cap">—</div>
              <div class="stat-sub" id="stat-limits-sub">—</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Balance</th>
                <th>USD Value</th>
                <th>Quick Action</th>
              </tr>
            </thead>
            <tbody id="tbl-balances">
              <tr><td colspan="4" class="empty-state">Loading balances...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Quick Actions</h2>
              <div class="card-subtitle">Jump directly to a subscreen or trigger a common test action</div>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" onclick="window.switchTab('send')">Send Money →</button>
            <button type="button" onclick="window.switchTab('swap')">Swap Tokens →</button>
            <button type="button" onclick="window.switchTab('earn')">Invest in Vault →</button>
            <button type="button" onclick="window.switchTab('onramp')">Add Money (Onramp) →</button>
            <button type="button" onclick="window.switchTab('contacts')">Manage Contacts →</button>
          </div>
        </div>
      </div>

      <!-- SUBSCREEN 2: SEND & RECEIVE -->
      <div class="subscreen" id="tab-send">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Send Money</h2>
                <div class="card-subtitle">Proposes a <code>send</code> intent (<code>POST /intents</code>)</div>
              </div>
            </div>
            <div class="form-row">
              <label for="send-to">Recipient (Contact name, Contact ID, or checksummed 0x address)</label>
              <input id="send-to" type="text" value="Bob" placeholder="Bob, Alice, or 0x..." />
              <div class="btn-row" style="margin-top: 6px;" id="send-contact-pills"></div>
            </div>
            <div class="grid-2">
              <div class="form-row">
                <label for="send-amount">Amount (number or "all")</label>
                <input id="send-amount" type="text" value="1" />
              </div>
              <div class="form-row">
                <label for="send-token">Token</label>
                <select id="send-token">
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                  <option value="cirBTC">cirBTC</option>
                </select>
              </div>
            </div>
            <div class="btn-row">
              <button id="btn-propose-send" class="btn-primary" type="button">Propose Send (Open Confirm Card)</button>
              <button type="button" class="btn-sm" onclick="document.getElementById('send-amount').value='all'">Set "all"</button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Receive Money</h2>
                <div class="card-subtitle">Pushes your wallet address island (<code>POST /receive</code>)</div>
              </div>
              <button id="btn-receive" class="btn-sm btn-primary" type="button">Publish Receive Island</button>
            </div>
            <div id="receive-box">
              <p class="empty-state">Click "Publish Receive Island" to display your receive details here and in the live island dock.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- SUBSCREEN 3: SWAP -->
      <div class="subscreen" id="tab-swap">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Swap Tokens</h2>
              <div class="card-subtitle">Check a live price quote (<code>POST /quotes/swap</code>) or propose a swap (<code>POST /intents</code>)</div>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-row">
              <label for="swap-in">From Token (<code>tokenIn</code>)</label>
              <select id="swap-in">
                <option value="USDC" selected>USDC</option>
                <option value="EURC">EURC</option>
                <option value="cirBTC">cirBTC</option>
              </select>
            </div>
            <div class="form-row">
              <label for="swap-out">To Token (<code>tokenOut</code>)</label>
              <select id="swap-out">
                <option value="USDC">USDC</option>
                <option value="EURC" selected>EURC</option>
                <option value="cirBTC">cirBTC</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-row">
              <label for="swap-amount">Amount In</label>
              <input id="swap-amount" type="text" value="2" />
            </div>
            <div class="form-row">
              <label for="swap-slippage">Max Slippage (bps, optional — default 100 = 1%)</label>
              <input id="swap-slippage" type="text" placeholder="100" />
            </div>
          </div>
          <div class="btn-row">
            <button id="btn-quote-swap" type="button">Get Price Quote Only</button>
            <button id="btn-propose-swap" class="btn-primary" type="button">Propose Swap (Open Confirm Card)</button>
          </div>
          <div id="out-swap-quote" style="margin-top: 12px;"></div>
        </div>
      </div>

      <!-- SUBSCREEN 4: EARN VAULTS -->
      <div class="subscreen" id="tab-earn">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Available Earning Vaults &amp; Your Positions</h2>
              <div class="card-subtitle">Live Circle EarnKit vaults on Arc Testnet (<code>GET /vaults</code>)</div>
            </div>
            <button id="btn-refresh-vaults" class="btn-sm" type="button">Refresh Vaults</button>
          </div>

          <h3 style="font-size: 13px; margin: 8px 0;">Available Vaults</h3>
          <table>
            <thead>
              <tr>
                <th>Vault Name</th>
                <th>Asset</th>
                <th>APY</th>
                <th>Address</th>
                <th>Select</th>
              </tr>
            </thead>
            <tbody id="tbl-vaults">
              <tr><td colspan="5" class="empty-state">Loading vaults...</td></tr>
            </tbody>
          </table>

          <h3 style="font-size: 13px; margin: 16px 0 8px 0;">Your Active Vault Positions</h3>
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Balance</th>
                <th>APY</th>
                <th>Yield Earned</th>
                <th>Quick Withdraw</th>
              </tr>
            </thead>
            <tbody id="tbl-positions">
              <tr><td colspan="5" class="empty-state">Loading positions...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Deposit or Withdraw</h2>
              <div class="card-subtitle">Proposes <code>earn_deposit</code> or <code>earn_withdraw</code> (<code>POST /intents</code>)</div>
            </div>
          </div>
          <div class="grid-3">
            <div class="form-row">
              <label for="earn-vault">Vault ("best", name, or 0x address)</label>
              <input id="earn-vault" type="text" value="best" />
            </div>
            <div class="form-row">
              <label for="earn-amount">Amount (or "all" for withdraw)</label>
              <input id="earn-amount" type="text" value="1" />
            </div>
            <div class="form-row">
              <label for="earn-token">Token (for deposit)</label>
              <select id="earn-token">
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
              </select>
            </div>
          </div>
          <div class="btn-row">
            <button id="btn-propose-deposit" class="btn-primary" type="button">Propose Deposit</button>
            <button id="btn-propose-withdraw" type="button">Propose Withdraw</button>
            <button type="button" class="btn-sm" onclick="document.getElementById('earn-amount').value='all'">Set "all"</button>
          </div>
        </div>
      </div>

      <!-- SUBSCREEN 5: ONRAMP -->
      <div class="subscreen" id="tab-onramp">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Add Money (Circle Onramp)</h2>
              <div class="card-subtitle">Open secure checkout to add money. Complete identity and payment steps on screen.</div>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-row">
              <label for="onramp-amount">Amount to spend (optional, USD for USDC / EUR for EURC)</label>
              <input id="onramp-amount" type="text" value="20" />
            </div>
            <div class="form-row">
              <label for="onramp-token">Token</label>
              <select id="onramp-token">
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
              </select>
            </div>
          </div>
          <div class="btn-row" style="margin-bottom: 12px;">
            <button id="btn-onramp-start" class="btn-primary" type="button">Open checkout</button>
          </div>
          <div id="out-onramp"></div>
        </div>
      </div>

      <!-- SUBSCREEN 6: CONTACTS -->
      <div class="subscreen" id="tab-contacts">
        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Saved Contacts</h2>
                <div class="card-subtitle">Click "Send to..." on any contact to populate the Send subscreen</div>
              </div>
              <button type="button" class="btn-sm" id="btn-refresh-contacts">Refresh</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="tbl-contacts">
                <tr><td colspan="3" class="empty-state">Loading contacts...</td></tr>
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Add New Contact</h2>
                <div class="card-subtitle">Requires a checksummed 0x address (<code>POST /contacts</code>)</div>
              </div>
            </div>
            <div class="form-row">
              <label for="contact-name">Contact Name</label>
              <input id="contact-name" type="text" placeholder="e.g. Carol" />
            </div>
            <div class="form-row">
              <label for="contact-address">Checksummed Address (<code>0x...</code>)</label>
              <input id="contact-address" type="text" placeholder="0x5555555555555555555555555555555555555555" />
            </div>
            <button id="btn-add-contact" class="btn-primary" type="button">Save Contact</button>
          </div>
        </div>
      </div>

      <!-- SUBSCREEN 7: ACTIVITY & SESSION SETTINGS -->
      <div class="subscreen" id="tab-activity">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Recent Account Activity</h2>
              <div class="card-subtitle">Audit log history (<code>GET /activity</code>)</div>
            </div>
            <button id="btn-refresh-activity" class="btn-sm" type="button">Refresh Activity</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event Type</th>
                <th>Summary</th>
                <th>Intent ID</th>
              </tr>
            </thead>
            <tbody id="tbl-activity">
              <tr><td colspan="4" class="empty-state">Loading activity...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Inspect Intent by ID</h2>
                <div class="card-subtitle"><code>GET /intents/:id</code></div>
              </div>
            </div>
            <div class="form-row">
              <label for="inp-intent-id">Intent ID</label>
              <input id="inp-intent-id" type="text" placeholder="Paste or click an Intent ID from Activity" />
            </div>
            <div class="btn-row">
              <button id="btn-get-intent" class="btn-primary" type="button">Inspect Intent</button>
              <button id="btn-cancel-open" type="button">Cancel Intent</button>
            </div>
            <pre id="out-intent" style="margin-top: 10px; background: #fafafa; padding: 8px; border: 1px solid #eee;"></pre>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Session &amp; Auth Inspector</h2>
                <div class="card-subtitle">Headers sent with every request</div>
              </div>
            </div>
            <div class="form-row">
              <label for="inp-dev-user">Dev User Header (<code>x-arcie-user</code>, used when <code>AUTH_MODE=dev</code>)</label>
              <input id="inp-dev-user" type="text" value="demo" />
            </div>
            <div class="form-row">
              <label for="inp-session-id">Active Session ID (<code>x-arcie-session</code> &amp; <code>/events</code> SSE)</label>
              <input id="inp-session-id" type="text" />
            </div>
            <div class="form-row">
              <label for="inp-privy-token">Privy Bearer Token (auto-filled when you log in with Privy)</label>
              <input id="inp-privy-token" type="text" placeholder="Bearer token (none)" />
            </div>
            <div class="btn-row">
              <button id="btn-mint-voice" class="btn-sm" type="button">Mint Voice Session (<code>POST /voice/session</code>)</button>
              <button id="btn-reconnect-sse" class="btn-sm" type="button">Reconnect SSE</button>
              <button id="btn-clear-token" class="btn-sm" type="button">Clear Token</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- RIGHT COLUMN: Persistent Live Islands + Voice / Text Agent -->
    <aside>
      <!-- Live Islands Dock -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Live Islands Dock (<code>/events</code>)</h2>
            <div class="card-subtitle">Confirm cards, Choice prompts, Receipts &amp; Steps appear here in real time</div>
          </div>
        </div>

        <div id="island-steps-wrap" style="margin-bottom: 10px; display: none;">
          <div class="stat-label">Live Step Trace</div>
          <pre id="island-steps" style="margin: 0; padding: 8px; background: #fafafa; border: 1px solid #ddd; border-radius: 6px;"></pre>
        </div>

        <div id="island-active">
          <div class="empty-state">No pending confirmation or choice card. Propose an action on the left or ask Arcie below.</div>
        </div>

        <div id="island-receipt" style="margin-top: 12px;"></div>
      </div>

      <!-- ElevenLabs Voice & Text Agent -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Arcie Voice &amp; Chat Agent</h2>
            <div class="card-subtitle">Talk via ElevenLabs mic or type directly to the harness</div>
          </div>
          <span id="voice-status" class="badge">Voice: Idle</span>
        </div>

        <div class="btn-row" style="margin-bottom: 12px;">
          <button id="btn-voice-start" class="btn-primary" type="button">Start ElevenLabs Voice Call</button>
          <button id="btn-voice-stop" type="button" disabled>End Call</button>
          <button id="btn-chat-reset" class="btn-sm" type="button">Clear Chat</button>
        </div>

        <div class="chat-box" id="out-chat">
          <div class="empty-state">Ask Arcie e.g. "What's my balance?", "Send 1 dollar to Bob", or "Swap 2 USDC to EURC".</div>
        </div>

        <div class="btn-row" style="flex-wrap: nowrap;">
          <input id="inp-chat" type="text" placeholder="Type a message to Arcie and press Enter..." />
          <button id="btn-chat-send" class="btn-primary" type="button">Send</button>
        </div>
      </div>
    </aside>

  </main>

  <dialog id="onramp-dialog" aria-labelledby="onramp-title" aria-describedby="onramp-guidance">
    <div class="card-header">
      <div>
        <h2 id="onramp-title" class="card-title">Add money</h2>
        <span id="onramp-mode" class="badge">Secure checkout</span>
      </div>
      <button id="btn-onramp-close" type="button" aria-label="Close checkout" autofocus>Close</button>
    </div>
    <p id="onramp-guidance">Complete your deposit securely with Circle. Keep payment details inside checkout.</p>
    <div id="onramp-status" role="status" aria-live="polite"></div>
    <button id="btn-onramp-retry" type="button" hidden>Restart checkout</button>
    <div id="onramp-root"></div>
    <p class="card-subtitle">Destination wallet</p>
    <p id="onramp-destination" class="mono"></p>
  </dialog>

  <script type="module">
    import { setupOnramp } from "/assets/onramp.js";
    const $ = (id) => document.getElementById(id);

    // --- Tab Switching ---
    function switchTab(tabId) {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
      });
      document.querySelectorAll(".subscreen").forEach((s) => {
        s.classList.toggle("active", s.id === "tab-" + tabId);
      });
    }
    window.switchTab = switchTab;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.onclick = () => switchTab(btn.getAttribute("data-tab"));
    });

    const logStatus = (msg, detail) => {
      const text = detail !== undefined ? msg + " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : msg;
      $("status-log").textContent = "[" + new Date().toISOString().slice(11, 19) + "] " + text;
    };

    let runtimeConfig = { authMode: "dev", demoUserId: "demo", privyAppId: null, elevenLabsAgentId: null };
    let es = null;
    let chatMessages = [];
    let currentOpenIntentId = null;
    let activeVoiceConversation = null;

    $("inp-session-id").value = "ui-" + Math.random().toString(36).slice(2, 10);

    function escapeHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function headers(extra = {}) {
      const h = { "content-type": "application/json", ...extra };
      const sid = $("inp-session-id").value.trim();
      if (sid) h["x-arcie-session"] = sid;
      const tok = $("inp-privy-token").value.trim();
      if (tok) h["authorization"] = tok.startsWith("Bearer ") ? tok : "Bearer " + tok;
      const devUser = $("inp-dev-user").value.trim();
      if (devUser) h["x-arcie-user"] = devUser;
      return h;
    }

    async function api(method, path, body) {
      try {
        const res = await fetch(path, {
          method,
          headers: headers(),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data?.error?.message || ("HTTP " + res.status);
          logStatus(method + " " + path + " FAILED (" + (data?.error?.code || res.status) + ")", errMsg);
          return { ok: false, status: res.status, data };
        }
        return { ok: true, status: res.status, data };
      } catch (e) {
        logStatus(method + " " + path + " NETWORK ERROR", String(e?.message || e));
        return { ok: false, status: 0, data: { error: String(e) } };
      }
    }

    // --- SSE (/events) ---
    function connectSse() {
      if (es) {
        es.close();
        es = null;
      }
      const sid = $("inp-session-id").value.trim();
      if (!sid) {
        $("badge-sse").textContent = "SSE: No Session";
        return;
      }
      $("badge-sse").textContent = "SSE: Connecting...";
      es = new EventSource("/events?sessionId=" + encodeURIComponent(sid));
      es.onopen = () => {
        $("badge-sse").textContent = "SSE: Connected (" + sid.slice(0, 10) + ")";
        $("badge-sse").classList.add("ok");
      };
      es.onerror = () => {
        $("badge-sse").textContent = "SSE: Disconnected / Auth Needed";
        $("badge-sse").classList.remove("ok");
      };
      es.addEventListener("island", (ev) => {
        try {
          renderIsland(JSON.parse(ev.data));
        } catch (e) {
          logStatus("SSE parse error", String(e));
        }
      });
    }

    function renderIsland(island) {
      if (!island || !island.kind) return;
      if (island.kind === "steps") {
        $("island-steps-wrap").style.display = "block";
        const lines = (island.steps || []).map((s) => "[" + s.status.toUpperCase() + "] " + s.label + (s.error ? " — " + s.error : ""));
        $("island-steps").textContent = lines.join("\\n") + " (" + island.elapsedMs + " ms)";
        return;
      }
      if (island.kind === "dismiss") {
        if (currentOpenIntentId === island.intentId) currentOpenIntentId = null;
        $("island-active").innerHTML = "<div class='empty-state'>Card " + escapeHtml(island.intentId.slice(0, 8)) + " dismissed (" + escapeHtml(island.reason) + ").</div>";
        return;
      }
      if (island.kind === "confirm") {
        currentOpenIntentId = island.intentId;
        $("inp-intent-id").value = island.intentId;
        const chipsHtml = (island.chips || []).map((c) => "<span class='chip'>" + escapeHtml(c) + "</span>").join("");
        const rowsHtml = (island.rows || [])
          .map((r) => "<li><span>" + escapeHtml(r.label) + (r.estimate ? " (est.)" : "") + "</span><strong>" + escapeHtml(r.value === null ? "—" : r.value) + "</strong></li>")
          .join("");
        const adjHtml = (island.adjustments || []).map((a) => "<li><strong>Adjustment:</strong> " + escapeHtml(a) + "</li>").join("");
        const riskHtml = (island.risks || []).map((r) => "<li><strong>Risk:</strong> " + escapeHtml(r) + "</li>").join("");
        const discText = (island.disclosure || []).map((d) => (d.bold ? "<strong>" + escapeHtml(d.text) + "</strong>" : escapeHtml(d.text))).join("");
        $("island-active").innerHTML =
          "<div class='island-box'>" +
          "<div class='chip-row'>" + chipsHtml + "</div>" +
          "<h4>" + escapeHtml(island.title) + "</h4>" +
          "<p style='margin: 6px 0; font-size: 13px;'>" + discText + "</p>" +
          "<ul class='kv-list'>" + rowsHtml + "</ul>" +
          (adjHtml || riskHtml ? "<ul class='notice-list'>" + adjHtml + riskHtml + "</ul>" : "") +
          "<div class='btn-row' style='margin-top: 12px;'>" +
          "<button type='button' class='btn-primary' id='btn-card-confirm'>Confirm Transaction</button>" +
          "<button type='button' id='btn-card-cancel'>Cancel</button>" +
          "</div>" +
          "<div style='margin-top: 8px; font-size: 11px; color: #555;'>" +
          "<div>Confirm = " + escapeHtml(island.buttons?.confirm || "") + "</div>" +
          "<div>Expires: " + escapeHtml(island.expiresAt) + "</div>" +
          "</div></div>";
        $("btn-card-confirm").onclick = () => confirmIntent(island.intentId);
        $("btn-card-cancel").onclick = () => cancelIntent(island.intentId);
        return;
      }
      if (island.kind === "choice") {
        const optsHtml = (island.options || [])
          .map((o) => "<button type='button' data-opt='" + escapeHtml(o.id) + "'>" + escapeHtml(o.label) + (o.detail ? " (" + escapeHtml(o.detail) + ")" : "") + "</button>")
          .join("");
        $("island-active").innerHTML =
          "<div class='island-box'>" +
          "<h4>" + escapeHtml(island.question) + "</h4>" +
          "<div class='btn-row' id='choice-opts'>" + optsHtml + "</div>" +
          "</div>";
        $("choice-opts").querySelectorAll("button").forEach((btn) => {
          btn.onclick = () => answerChoice(island.choiceId, btn.getAttribute("data-opt"));
        });
        return;
      }
      if (island.kind === "receipt") {
        if (currentOpenIntentId === island.intentId) {
          currentOpenIntentId = null;
          $("island-active").innerHTML = "<div class='empty-state'>Confirmation completed. Receipt shown below.</div>";
        }
        const rowsHtml = (island.rows || [])
          .map((r) => "<li><span>" + escapeHtml(r.label) + " (est: " + escapeHtml(r.estimated ?? "—") + ")</span><strong>" + escapeHtml(r.actual ?? "—") + "</strong></li>")
          .join("");
        const link = island.explorerUrl ? "<a href='" + escapeHtml(island.explorerUrl) + "' target='_blank' rel='noreferrer'>View on Arc Explorer ↗</a>" : "";
        const errHtml = island.error ? "<p style='color:#900;'><strong>Error (" + escapeHtml(island.error.code) + "):</strong> " + escapeHtml(island.error.message) + "</p>" : "";
        const nextBtn = island.nextStep ? "<button type='button' class='btn-sm' id='btn-next-step'>Next Step: " + escapeHtml(island.nextStep.label) + "</button>" : "";
        $("island-receipt").innerHTML =
          "<div class='island-box'>" +
          "<div class='chip-row'><span class='chip'>RECEIPT: " + escapeHtml(island.status.toUpperCase()) + "</span><span class='chip'>" + escapeHtml(island.elapsedMs) + " ms</span></div>" +
          "<ul class='kv-list'>" + rowsHtml + "</ul>" +
          (island.newBalance ? "<p style='margin:6px 0; font-size:13px;'><strong>New Balance:</strong> " + escapeHtml(island.newBalance) + "</p>" : "") +
          (island.txHash ? "<p class='mono' style='margin:6px 0; word-break:break-all;'>Tx: " + escapeHtml(island.txHash) + " " + link + "</p>" : "") +
          errHtml +
          (nextBtn ? "<div class='btn-row' style='margin-top:8px;'>" + nextBtn + "</div>" : "") +
          "</div>";
        if (island.nextStep && $("btn-next-step")) {
          $("btn-next-step").onclick = () => {
            $("inp-chat").value = island.nextStep.utterance;
            sendChat();
          };
        }
        refreshAll();
        return;
      }
      if (island.kind === "receive") {
        const html =
          "<div class='island-box'>" +
          "<h4>Receive on " + escapeHtml(island.chain) + "</h4>" +
          "<p class='mono' style='word-break:break-all; padding:8px; background:#f5f5f5; border:1px solid #ddd; border-radius:4px;'>" + escapeHtml(island.address) + "</p>" +
          "<p style='margin:0; font-size:12px;'>Tokens supported: <strong>" + escapeHtml((island.tokens || []).join(", ")) + "</strong></p>" +
          "</div>";
        $("receive-box").innerHTML = html;
        $("island-receipt").innerHTML = html;
        return;
      }
      if (island.kind === "onramp") {
        void onramp.open(island);
        return;
      }
      if (island.kind === "balances") {
        refreshAll();
      }
    }

    // --- State Refreshers ---
    async function refreshMe() {
      const r = await api("GET", "/me");
      if (!r.ok) return;
      const { user, wallets, limits } = r.data;
      $("stat-user-name").textContent = "User: " + (user?.displayName || user?.id || "—") + (user?.email ? " (" + user.email + ")" : "");
      const w = wallets?.[0];
      $("stat-wallet-addr").textContent = w?.address || "No wallet provisioned";
      $("stat-wallet-chain").textContent = "Chain: " + (w?.chain || "Arc_Testnet");
      if (limits) {
        $("stat-limits-cap").textContent = "$" + limits.maxPerTxUsd + " / tx · $" + limits.dailyCapUsd + " / day";
        $("stat-limits-sub").textContent = "Max slippage: " + (limits.maxSlippageBps / 100) + "% · Source: " + (limits.source || "db");
      }
    }

    async function refreshBalances() {
      const r = await api("GET", "/balances");
      if (!r.ok) return;
      $("stat-total-usd").textContent = "$" + Number(r.data.totalUsd ?? 0).toFixed(2);
      const tokens = r.data.chains?.[0]?.tokens || [];
      if (!tokens.length) {
        $("tbl-balances").innerHTML = "<tr><td colspan='4' class='empty-state'>No tokens found.</td></tr>";
        return;
      }
      $("tbl-balances").innerHTML = tokens
        .map(
          (t) =>
            "<tr>" +
            "<td><strong>" + escapeHtml(t.token) + "</strong></td>" +
            "<td class='mono'>" + escapeHtml(t.amount) + "</td>" +
            "<td>" + (t.usd === null || t.usd === undefined ? "—" : "$" + Number(t.usd).toFixed(2)) + "</td>" +
            "<td>" +
            "<button type='button' class='btn-sm' data-qsend='" + escapeHtml(t.token) + "'>Send</button> " +
            "<button type='button' class='btn-sm' data-qswap='" + escapeHtml(t.token) + "'>Swap</button>" +
            "</td></tr>"
        )
        .join("");
      $("tbl-balances").querySelectorAll("button[data-qsend]").forEach((btn) => {
        btn.onclick = () => {
          $("send-token").value = btn.getAttribute("data-qsend");
          switchTab("send");
        };
      });
      $("tbl-balances").querySelectorAll("button[data-qswap]").forEach((btn) => {
        btn.onclick = () => {
          $("swap-in").value = btn.getAttribute("data-qswap");
          switchTab("swap");
        };
      });
    }

    async function refreshVaults() {
      const r = await api("GET", "/vaults");
      if (!r.ok) return;
      const vaults = r.data.vaults || [];
      const positions = r.data.positions || [];

      $("tbl-vaults").innerHTML = vaults.length
        ? vaults
            .map(
              (v) =>
                "<tr>" +
                "<td><strong>" + escapeHtml(v.name) + "</strong></td>" +
                "<td>" + escapeHtml(v.token) + "</td>" +
                "<td>" + (Number(v.apy) * 100).toFixed(2) + "%</td>" +
                "<td class='mono'>" + escapeHtml(v.address.slice(0, 10)) + "…</td>" +
                "<td><button type='button' class='btn-sm' data-vault='" + escapeHtml(v.address) + "' data-token='" + escapeHtml(v.token) + "'>Use Vault</button></td>" +
                "</tr>"
            )
            .join("")
        : "<tr><td colspan='5' class='empty-state'>No active vaults available.</td></tr>";

      $("tbl-vaults").querySelectorAll("button[data-vault]").forEach((btn) => {
        btn.onclick = () => {
          $("earn-vault").value = btn.getAttribute("data-vault");
          const tok = btn.getAttribute("data-token");
          if (tok === "USDC" || tok === "EURC") $("earn-token").value = tok;
        };
      });

      $("tbl-positions").innerHTML = positions.length
        ? positions
            .map(
              (p) =>
                "<tr>" +
                "<td><strong>" + escapeHtml(p.vaultName) + "</strong></td>" +
                "<td class='mono'>" + escapeHtml(p.currentBalance) + " " + escapeHtml(p.token) + "</td>" +
                "<td>" + (Number(p.apy) * 100).toFixed(2) + "%</td>" +
                "<td class='mono'>" + escapeHtml(p.yieldEarned ?? "—") + "</td>" +
                "<td><button type='button' class='btn-sm' data-wvault='" + escapeHtml(p.vault) + "'>Withdraw All</button></td>" +
                "</tr>"
            )
            .join("")
        : "<tr><td colspan='5' class='empty-state'>No active vault investments yet.</td></tr>";

      $("tbl-positions").querySelectorAll("button[data-wvault]").forEach((btn) => {
        btn.onclick = () => {
          const v = btn.getAttribute("data-wvault");
          $("earn-vault").value = v;
          $("earn-amount").value = "all";
          propose("earn_withdraw", { vault: v, amount: "all" });
        };
      });
    }

    async function refreshContacts() {
      const r = await api("GET", "/contacts");
      if (!r.ok) return;
      const list = r.data.contacts || [];
      $("tbl-contacts").innerHTML = list.length
        ? list
            .map(
              (c) =>
                "<tr>" +
                "<td><strong>" + escapeHtml(c.name) + "</strong></td>" +
                "<td class='mono'>" + escapeHtml(c.address) + "</td>" +
                "<td><button type='button' class='btn-sm' data-cname='" + escapeHtml(c.name) + "'>Send to " + escapeHtml(c.name) + "</button></td>" +
                "</tr>"
            )
            .join("")
        : "<tr><td colspan='3' class='empty-state'>No contacts saved yet.</td></tr>";

      $("tbl-contacts").querySelectorAll("button[data-cname]").forEach((btn) => {
        btn.onclick = () => {
          $("send-to").value = btn.getAttribute("data-cname");
          switchTab("send");
        };
      });

      $("send-contact-pills").innerHTML = list
        .map((c) => "<button type='button' class='btn-sm' data-pill='" + escapeHtml(c.name) + "'>Pick: " + escapeHtml(c.name) + "</button>")
        .join("");
      $("send-contact-pills").querySelectorAll("button[data-pill]").forEach((btn) => {
        btn.onclick = () => {
          $("send-to").value = btn.getAttribute("data-pill");
        };
      });
    }

    async function refreshActivity() {
      const r = await api("GET", "/activity");
      if (!r.ok) return;
      const items = r.data.items || [];
      $("tbl-activity").innerHTML = items.length
        ? items
            .map(
              (a) =>
                "<tr>" +
                "<td class='mono'>" + escapeHtml((a.at || "").slice(11, 19) || a.at) + "</td>" +
                "<td><span class='chip'>" + escapeHtml(a.type) + "</span></td>" +
                "<td>" + escapeHtml(a.summary || "") + "</td>" +
                "<td class='mono'>" +
                (a.intentId ? "<button type='button' class='btn-sm' data-iid='" + escapeHtml(a.intentId) + "'>" + escapeHtml(a.intentId.slice(0, 8)) + "…</button>" : "—") +
                "</td></tr>"
            )
            .join("")
        : "<tr><td colspan='4' class='empty-state'>No activity recorded yet.</td></tr>";

      $("tbl-activity").querySelectorAll("button[data-iid]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-iid");
          $("inp-intent-id").value = id;
          const res = await api("GET", "/intents/" + encodeURIComponent(id));
          $("out-intent").textContent = JSON.stringify(res.data, null, 2);
        };
      });
    }

    async function refreshAll() {
      await Promise.all([refreshMe(), refreshBalances(), refreshVaults(), refreshContacts(), refreshActivity()]);
    }

    // --- Intent Actions ---
    async function propose(kind, params) {
      logStatus("Proposing " + kind + "...", params);
      const r = await api("POST", "/intents", { kind, params });
      if (r.ok) {
        logStatus(r.data.summary || ("Proposed " + kind));
        if (r.data.island) renderIsland(r.data.island);
        refreshActivity();
      }
    }

    async function confirmIntent(id) {
      const btn = $("btn-card-confirm");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Executing on Arc Testnet...";
      }
      logStatus("Confirming intent " + id + " on screen...");
      const r = await api("POST", "/intents/" + encodeURIComponent(id) + "/confirm", {});
      if (r.ok) {
        logStatus(r.data.summary || ("Confirmed " + id));
        if (r.data.island) renderIsland(r.data.island);
        if (activeVoiceConversation && typeof activeVoiceConversation.sendContextualUpdate === "function") {
          try {
            activeVoiceConversation.sendContextualUpdate("User confirmed intent " + id + " on screen. Result: " + (r.data.summary || r.data.status));
          } catch {}
        }
        await refreshAll();
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirm Transaction";
      }
    }

    async function cancelIntent(id) {
      const target = id || currentOpenIntentId || $("inp-intent-id").value.trim();
      if (!target) return logStatus("No active intent ID to cancel.");
      const r = await api("POST", "/intents/" + encodeURIComponent(target) + "/cancel", {});
      if (r.ok) {
        logStatus(r.data.summary || ("Cancelled " + target));
        if (currentOpenIntentId === target) {
          currentOpenIntentId = null;
          $("island-active").innerHTML = "<div class='empty-state'>Cancelled intent " + escapeHtml(target.slice(0, 8)) + ".</div>";
        }
        await refreshActivity();
      }
    }

    async function answerChoice(choiceId, optionId) {
      logStatus("Answering choice " + choiceId + " -> " + optionId);
      const r = await api("POST", "/choices/" + encodeURIComponent(choiceId), { optionId });
      if (r.ok) {
        $("send-to").value = optionId;
        await propose("send", { to: optionId, amount: $("send-amount").value.trim(), token: $("send-token").value });
      }
    }

    // --- Chat ---
    async function sendChat() {
      const text = $("inp-chat").value.trim();
      if (!text) return;
      $("inp-chat").value = "";
      chatMessages.push({ role: "user", content: text });
      renderChat();
      logStatus("Arcie is thinking...");
      const r = await api("POST", "/chat", { messages: chatMessages });
      if (r.ok) {
        const reply = r.data.reply || "(empty reply)";
        chatMessages.push({ role: "assistant", content: reply });
        renderChat();
        logStatus("Arcie: " + reply);
        await refreshAll();
      }
    }

    function renderChat() {
      if (!chatMessages.length) {
        $("out-chat").innerHTML = "<div class='empty-state'>Ask Arcie e.g. 'What is my balance?', 'Send 1 dollar to Bob', or 'Swap 2 USDC to EURC'.</div>";
        return;
      }
      $("out-chat").innerHTML = chatMessages
        .map(
          (m) =>
            "<div class='chat-msg " + escapeHtml(m.role) + "'>" +
            "<div class='chat-role'>" + (m.role === "user" ? "You" : "Arcie") + "</div>" +
            "<div>" + escapeHtml(m.content) + "</div></div>"
        )
        .join("");
      $("out-chat").scrollTop = $("out-chat").scrollHeight;
    }

    // --- Button Bindings ---
    $("btn-reconnect-sse").onclick = connectSse;
    $("btn-clear-token").onclick = () => {
      $("inp-privy-token").value = "";
      logStatus("Cleared Privy token.");
    };
    $("btn-onboard").onclick = async () => {
      logStatus("Running POST /auth/session...");
      const r = await api("POST", "/auth/session", {});
      if (r.ok) {
        logStatus("Onboarded user + Circle wallet (" + (r.data.wallet?.address || "") + ")");
        await refreshAll();
      }
    };
    $("btn-mint-voice").onclick = async () => {
      const r = await api("POST", "/voice/session", {});
      if (r.ok && r.data.sessionId) {
        $("inp-session-id").value = r.data.sessionId;
        logStatus("Minted voice session " + r.data.sessionId);
        connectSse();
      }
    };
    $("btn-refresh-all").onclick = refreshAll;
    $("btn-overview-refresh").onclick = refreshAll;
    const triggerReceive = async () => {
      const r = await api("POST", "/receive", {});
      if (r.ok) {
        logStatus(r.data.summary || "Receive details published.");
        if (r.data.island) renderIsland(r.data.island);
      }
    };
    $("btn-receive").onclick = triggerReceive;
    $("btn-overview-receive").onclick = () => {
      switchTab("send");
      triggerReceive();
    };

    $("btn-propose-send").onclick = () =>
      propose("send", {
        to: $("send-to").value.trim(),
        amount: $("send-amount").value.trim(),
        token: $("send-token").value,
      });

    $("btn-quote-swap").onclick = async () => {
      const body = {
        tokenIn: $("swap-in").value,
        tokenOut: $("swap-out").value,
        amountIn: $("swap-amount").value.trim(),
      };
      logStatus("Checking swap quote...");
      const r = await api("POST", "/quotes/swap", body);
      if (r.ok) {
        logStatus(r.data.summary);
        $("out-swap-quote").innerHTML =
          "<div class='island-box'><h4>" + escapeHtml(r.data.summary) + "</h4>" +
          "<ul class='kv-list'>" +
          "<li><span>Estimated Out</span><strong>" + escapeHtml(r.data.data?.estimatedOut) + " " + escapeHtml(body.tokenOut) + "</strong></li>" +
          "<li><span>Minimum Out (after slippage)</span><strong>" + escapeHtml(r.data.data?.minOut) + " " + escapeHtml(body.tokenOut) + "</strong></li>" +
          "</ul></div>";
      }
    };

    $("btn-propose-swap").onclick = () => {
      const slip = $("swap-slippage").value.trim();
      propose("swap", {
        tokenIn: $("swap-in").value,
        tokenOut: $("swap-out").value,
        amountIn: $("swap-amount").value.trim(),
        ...(slip ? { maxSlippageBps: Number(slip) } : {}),
      });
    };

    $("btn-refresh-vaults").onclick = refreshVaults;
    $("btn-propose-deposit").onclick = () =>
      propose("earn_deposit", {
        vault: $("earn-vault").value.trim() || "best",
        amount: $("earn-amount").value.trim(),
        token: $("earn-token").value,
      });
    $("btn-propose-withdraw").onclick = () =>
      propose("earn_withdraw", {
        vault: $("earn-vault").value.trim() || "best",
        amount: $("earn-amount").value.trim(),
      });

    const onramp = setupOnramp({
      mint: async (params) => {
        const r = await api("POST", "/onramp/sessions", params);
        if (!r.ok) throw new Error(r.data?.error?.message || "Could not open checkout. Please retry.");
        return r.data.island;
      },
      record: async (type, payload) => {
        const r = await api("POST", "/onramp/events", { type, payload });
        if (!r.ok) throw new Error("Could not record checkout update.");
      },
      refresh: refreshAll,
    });
    $("btn-onramp-start").onclick = async () => {
      const button = $("btn-onramp-start");
      button.disabled = true;
      const amount = $("onramp-amount").value.trim();
      try {
        await onramp.start({ token: $("onramp-token").value, ...(amount ? { amount } : {}) });
      } finally {
        button.disabled = false;
      }
    };

    $("btn-get-intent").onclick = async () => {
      const id = $("inp-intent-id").value.trim();
      if (!id) return logStatus("Enter an Intent ID first.");
      const r = await api("GET", "/intents/" + encodeURIComponent(id));
      $("out-intent").textContent = JSON.stringify(r.data, null, 2);
    };
    $("btn-cancel-open").onclick = () => cancelIntent();

    $("btn-chat-send").onclick = sendChat;
    $("inp-chat").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
    $("btn-chat-reset").onclick = () => {
      chatMessages = [];
      renderChat();
    };

    $("btn-refresh-contacts").onclick = refreshContacts;
    $("btn-add-contact").onclick = async () => {
      const r = await api("POST", "/contacts", {
        name: $("contact-name").value.trim(),
        address: $("contact-address").value.trim(),
      });
      if (r.ok) {
        logStatus("Added contact: " + r.data.contact?.name);
        $("contact-name").value = "";
        $("contact-address").value = "";
        await refreshContacts();
      }
    };
    $("btn-refresh-activity").onclick = refreshActivity;

    // --- ElevenLabs Voice SDK ---
    $("btn-voice-start").onclick = async () => {
      if (!runtimeConfig.elevenLabsAgentId) {
        return logStatus("ELEVENLABS_AGENT_ID is not set in .env.");
      }
      try {
        $("voice-status").textContent = "Voice: Minting session...";
        const vs = await api("POST", "/voice/session", {});
        if (!vs.ok || !vs.data.sessionId) {
          $("voice-status").textContent = "Voice: Session failed";
          return;
        }
        const sessionId = vs.data.sessionId;
        $("inp-session-id").value = sessionId;
        connectSse();

        $("voice-status").textContent = "Voice: Loading SDK...";
        const { Conversation } = await import("https://esm.sh/@elevenlabs/client@0.2.0");
        await navigator.mediaDevices.getUserMedia({ audio: true });
        $("voice-status").textContent = "Voice: Connecting...";
        activeVoiceConversation = await Conversation.startSession({
          agentId: runtimeConfig.elevenLabsAgentId,
          customLlmExtraBody: { session_id: sessionId },
          onConnect: () => {
            $("voice-status").textContent = "Voice: Connected";
            $("voice-status").classList.add("ok");
            $("btn-voice-start").disabled = true;
            $("btn-voice-stop").disabled = false;
          },
          onDisconnect: () => {
            $("voice-status").textContent = "Voice: Disconnected";
            $("voice-status").classList.remove("ok");
            $("btn-voice-start").disabled = false;
            $("btn-voice-stop").disabled = true;
            activeVoiceConversation = null;
          },
          onError: (err) => {
            logStatus("ElevenLabs error", String(err?.message || err));
            $("voice-status").textContent = "Voice: Error";
          },
          onMessage: (msg) => {
            if (msg?.message) {
              chatMessages.push({ role: msg.source === "user" ? "user" : "assistant", content: msg.message });
              renderChat();
            }
          },
        });
      } catch (e) {
        $("voice-status").textContent = "Voice: Failed";
        logStatus("Voice error", String(e?.message || e));
      }
    };

    $("btn-voice-stop").onclick = async () => {
      if (activeVoiceConversation) {
        await activeVoiceConversation.endSession();
        activeVoiceConversation = null;
      }
    };

    // --- Privy Login Widget ---
    async function mountPrivy(appId) {
      if (!appId) {
        $("privy-mount").innerHTML = "<span class='badge'>Privy: No App ID</span>";
        return;
      }
      try {
        const React = (await import("https://esm.sh/react@18.3.1")).default;
        const { createRoot } = await import("https://esm.sh/react-dom@18.3.1/client");
        const { PrivyProvider, usePrivy } = await import("https://esm.sh/@privy-io/react-auth@2.4.0?deps=react@18.3.1,react-dom@18.3.1");

        function PrivyControls() {
          const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
          React.useEffect(() => {
            if (!ready || !authenticated) return;
            getAccessToken().then(async (tok) => {
              if (tok) {
                $("inp-privy-token").value = tok;
                logStatus("Privy signed in (" + (user?.id || "user") + "). Running POST /auth/session...");
                const r = await api("POST", "/auth/session", {});
                if (r.ok) {
                  logStatus("Privy onboard complete: wallet " + (r.data.wallet?.address || ""));
                  await refreshAll();
                }
              }
            });
          }, [ready, authenticated, user?.id]);

          if (!ready) return React.createElement("span", { className: "badge" }, "Privy loading...");
          return React.createElement(
            "span",
            { className: "btn-row" },
            authenticated
              ? [
                  React.createElement("span", { key: "u", className: "badge ok" }, "Privy: " + (user?.id?.slice(0, 14) || "Signed In")),
                  React.createElement(
                    "button",
                    {
                      key: "out",
                      type: "button",
                      className: "btn-sm",
                      onClick: async () => {
                        onramp.close();
                        await logout();
                        $("inp-privy-token").value = "";
                        logStatus("Logged out of Privy.");
                      },
                    },
                    "Logout Privy"
                  ),
                ]
              : React.createElement(
                  "button",
                  { key: "in", type: "button", className: "btn-sm btn-primary", onClick: () => login() },
                  "Sign in with Privy"
                )
          );
        }

        const root = createRoot($("privy-mount"));
        root.render(
          React.createElement(
            PrivyProvider,
            {
              appId,
              config: {
                loginMethods: ["google", "apple", "email", "wallet"],
                appearance: { showWalletLoginFirst: false, theme: "light" },
                embeddedWallets: { ethereum: { createOnLogin: "off" } },
              },
            },
            React.createElement(PrivyControls)
          )
        );
      } catch (e) {
        $("privy-mount").innerHTML = "<span class='badge'>Privy Load Error</span>";
        logStatus("Privy SDK error (ensure " + location.origin + " is in Privy Allowed Origins)", String(e?.message || e));
      }
    }

    // --- Boot ---
    async function boot() {
      const cfg = await api("GET", "/config");
      if (cfg.ok) {
        runtimeConfig = cfg.data;
        $("badge-auth").textContent = "Auth Mode: " + runtimeConfig.authMode;
        if (runtimeConfig.demoUserId) $("inp-dev-user").value = runtimeConfig.demoUserId;
        mountPrivy(runtimeConfig.privyAppId);
      }
      connectSse();
      await refreshAll();
    }

    boot();
  </script>
</body>
</html>`;

export function uiRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.html(HTML));
  app.get("/assets/onramp.js", async (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(await onrampClientBundle());
  });
  return app;
}
