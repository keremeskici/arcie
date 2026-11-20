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

    #send-contacts-dialog { width: min(400px, calc(100% - 24px)); max-height: 75vh; padding: 16px; border: 1px solid #ccc; border-radius: 8px; }
    #send-contacts-dialog::backdrop { background: #0006; }
    #send-contact-list { padding: 0; list-style: none; }
    #send-contact-list button { display: block; width: 100%; margin-bottom: 4px; text-align: left; }
    #send-contact-list small { display: block; overflow-wrap: anywhere; }
    #btn-retry-send-contacts[hidden], #btn-retry-send-amount[hidden] { display: none; }
    .send-review h4, .send-review .kv-list strong { min-width: 0; overflow-wrap: anywhere; }
    #send-max-status, #send-review-status { margin-top: 6px; font-size: 12px; }
    #btn-send-all[aria-pressed="true"] { color: #fff; background: #333; }

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
        <button type="button" class="tab-btn" data-tab="earn">4. Savings</button>
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
            <button type="button" onclick="window.switchTab('earn')">Savings →</button>
            <button type="button" onclick="window.switchTab('onramp')">Add Money (Onramp) →</button>
            <button type="button" onclick="window.switchTab('contacts')">Manage Contacts →</button>
          </div>
        </div>
      </div>

      <!-- SUBSCREEN 2: SEND & RECEIVE -->
      <div class="subscreen" id="tab-send">
        <div class="grid-2">
          <div class="card">
            <div class="card-header"><h2 class="card-title">Send money</h2></div>
            <div class="grid-2">
              <div class="form-row">
                <label for="send-amount">Amount</label>
                <input id="send-amount" type="text" inputmode="decimal" placeholder="0" />
              </div>
              <div class="form-row">
                <label for="send-token">Currency</label>
                <select id="send-token">
                  <option value="USDC">USDC</option>
                  <option value="EURC">EURC</option>
                  <option value="cirBTC">cirBTC</option>
                </select>
              </div>
            </div>
            <div class="btn-row">
              <button id="btn-send-all" type="button" aria-pressed="false">Send all</button>
              <button id="btn-retry-send-amount" type="button" hidden>Retry amount</button>
            </div>
            <div id="send-max-status" role="status" aria-live="polite"></div>
            <div class="form-row" style="margin-top: 12px;">
              <label for="send-to">To</label>
              <input id="send-to" type="text" placeholder="Wallet address or contact name" autocomplete="off" />
              <small id="send-address" class="mono" style="overflow-wrap:anywhere"></small>
            </div>
            <div class="btn-row">
              <button id="btn-send-contacts" type="button" aria-haspopup="dialog">Contacts</button>
              <button id="btn-propose-send" class="btn-primary" type="button" disabled>Review</button>
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
              <div class="card-subtitle">Live prices update while this tab is open. Swap approves the displayed minimum.</div>
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
          <div class="form-row">
            <label for="swap-amount">Amount In</label>
            <input id="swap-amount" type="text" inputmode="decimal" maxlength="80" value="2" />
          </div>
          <div id="out-swap-quote" style="margin: 12px 0;"></div>
          <div class="btn-row">
            <button id="btn-swap" class="btn-primary" type="button" disabled>Swap</button>
          </div>
          <p id="out-swap-status" role="status"></p>
        </div>
      </div>

      <!-- SUBSCREEN 4: SAVINGS -->
      <div class="subscreen" id="tab-earn">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Savings</h2>
            <button id="btn-refresh-savings" class="btn-sm" type="button">Refresh savings</button>
          </div>
          <div class="grid-3">
            <div class="stat-box">
              <div class="stat-label">Savings balance</div>
              <div class="stat-value" id="savings-balance">—</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Variable annual rate</div>
              <div class="stat-value" id="savings-rate">—</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Earnings</div>
              <div class="stat-value" id="savings-earned">—</div>
            </div>
          </div>
          <p id="savings-status" role="status">Loading savings…</p>
          <div class="form-row" style="margin-top: 14px;">
            <label for="savings-amount">Amount (USD)</label>
            <input id="savings-amount" type="text" inputmode="decimal" placeholder="0.00" />
          </div>
          <div class="btn-row">
            <button id="savings-deposit" class="btn-primary" type="button" disabled>Review deposit</button>
            <button id="savings-withdraw" type="button" disabled>Review withdrawal</button>
            <button id="savings-withdraw-all" type="button" disabled>Review full withdrawal</button>
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
              <label for="onramp-amount">Amount to spend</label>
              <input id="onramp-amount" type="text" value="20" />
            </div>
            <div class="form-row">
              <label for="onramp-token">Currency</label>
              <select id="onramp-token">
                <option value="USDC">USD (USDC)</option>
                <option value="EURC">EUR (EURC)</option>
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

  <dialog id="send-contacts-dialog" aria-labelledby="send-contacts-title">
    <div class="card-header">
      <h2 id="send-contacts-title" class="card-title">Choose contact</h2>
      <button id="btn-close-send-contacts" type="button" autofocus>Close</button>
    </div>
    <p id="send-contacts-status" role="status"></p>
    <button id="btn-retry-send-contacts" type="button" hidden>Retry contacts</button>
    <ul id="send-contact-list"></ul>
  </dialog>

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
      syncSwap();
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
    let currentOpenChoiceId = null;
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

    async function api(method, path, body, signal) {
      try {
        const res = await fetch(path, {
          method,
          headers: headers(),
          signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data?.error?.message || ("HTTP " + res.status);
          if (!signal?.aborted) logStatus(method + " " + path + " FAILED (" + (data?.error?.code || res.status) + ")", errMsg);
          return { ok: false, status: res.status, data };
        }
        return { ok: true, status: res.status, data };
      } catch (e) {
        if (!signal?.aborted) logStatus(method + " " + path + " NETWORK ERROR", String(e?.message || e));
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
        if (currentOpenIntentId !== island.intentId) return;
        currentOpenIntentId = null;
        $("island-active").innerHTML = "<div class='empty-state'>Card " + escapeHtml(island.intentId.slice(0, 8)) + " dismissed (" + escapeHtml(island.reason) + ").</div>";
        return;
      }
      if (island.kind === "dismiss_choice") {
        if (currentOpenChoiceId !== island.choiceId) return;
        currentOpenChoiceId = null;
        $("island-active").innerHTML = "<div class='empty-state'>Contact choice closed.</div>";
        return;
      }
      if (island.kind === "confirm") {
        currentOpenChoiceId = null;
        currentOpenIntentId = island.intentId;
        $("inp-intent-id").value = island.intentId;
        const send = island.action ? island.action === "send" : island.chips?.[0] === "Send";
        const details = send && island.send;
        const title = details ? "Send " + details.amount + " " + details.token + " to " + details.recipient : island.title;
        const chipsHtml = (island.chips || []).map((c) => "<span class='chip'>" + escapeHtml(c) + "</span>").join("");
        const rows = (island.rows || []).map(r => details && r.label === "Amount" ? { ...r, value: details.amount + " " + details.token } : r);
        if (details?.address) rows.push({ label: "Address", value: details.address });
        const rowsHtml = rows.map((r) => "<li><span>" + escapeHtml(r.label) + (r.estimate ? " (est.)" : "") + "</span><strong>" + escapeHtml(r.value === null ? "—" : r.value) + "</strong></li>").join("");
        const adjHtml = (island.adjustments || []).map((a) => "<li>" + (send ? "" : "<strong>Adjustment:</strong> ") + escapeHtml(a) + "</li>").join("");
        const risks = (island.risks || []).filter(r => !send || r !== "Onchain transfers can't be reversed.");
        const riskHtml = risks.map((r) => "<li>" + (send ? "" : "<strong>Risk:</strong> ") + escapeHtml(r) + "</li>").join("");
        const discText = (island.disclosure || []).map((d) => (d.bold ? "<strong>" + escapeHtml(d.text) + "</strong>" : escapeHtml(d.text))).join("");
        $("island-active").innerHTML =
          "<div class='island-box" + (send ? " send-review" : "") + "'>" +
          (send ? "" : "<div class='chip-row'>" + chipsHtml + "</div>") +
          "<h4>" + escapeHtml(title) + "</h4>" +
          (send ? "" : "<p style='margin: 6px 0; font-size: 13px;'>" + discText + "</p>") +
          "<ul class='kv-list'>" + rowsHtml + "</ul>" +
          (adjHtml || riskHtml ? "<ul class='notice-list'>" + adjHtml + riskHtml + "</ul>" : "") +
          "<div class='btn-row' style='margin-top: 12px;'>" +
          "<button type='button' class='btn-primary' id='btn-card-confirm'>" + (send ? "Confirm" : "Confirm Transaction") + "</button>" +
          "<button type='button' id='btn-card-cancel'>Cancel</button></div>" +
          (send ? "<div id='send-review-status' role='status'></div>" :
            "<div style='margin-top: 8px; font-size: 11px; color: #555;'><div>Confirm = " + escapeHtml(island.buttons?.confirm || "") + "</div><div>Expires: " + escapeHtml(island.expiresAt) + "</div></div>") +
          "</div>";
        const confirm = $("btn-card-confirm");
        if (send) {
          const expires = Date.parse(island.expiresAt);
          function expired() {
            if (Date.now() < expires) return false;
            confirm.disabled = true;
            if (confirm.isConnected) $("send-review-status").textContent = "This request expired. Prepare a new send.";
            return true;
          }
          if (!expired()) setTimeout(() => { if (confirm.isConnected && !confirm.disabled) expired(); }, expires - Date.now() + 1);
          confirm.onclick = () => { if (!expired()) confirmIntent(island.intentId, expires); };
        } else confirm.onclick = () => confirmIntent(island.intentId);
        $("btn-card-cancel").onclick = () => cancelIntent(island.intentId);
        return;
      }
      if (island.kind === "choice") {
        currentOpenChoiceId = island.choiceId;
        currentOpenIntentId = null;
        const optsHtml = (island.options || [])
          .map((o) => "<button type='button' data-opt='" + escapeHtml(o.id) + "'>" + escapeHtml(o.label) + (o.detail ? " (" + escapeHtml(o.detail) + ")" : "") + "</button>")
          .join("");
        $("island-active").innerHTML =
          "<div class='island-box'>" +
          "<h4>" + escapeHtml(island.question) + "</h4>" +
          "<div class='btn-row' id='choice-opts'>" + optsHtml + "</div>" +
          "<button type='button' id='btn-cancel-choice'>Cancel</button>" +
          "</div>";
        $("choice-opts").querySelectorAll("button").forEach((btn) => {
          btn.onclick = () => answerChoice(island.choiceId, btn.getAttribute("data-opt"));
        });
        $("btn-cancel-choice").onclick = async () => {
          const result = await api("DELETE", "/choices/" + encodeURIComponent(island.choiceId));
          if (result.ok) renderIsland({ kind: "dismiss_choice", choiceId: island.choiceId });
        };
        return;
      }
      if (island.kind === "receipt") {
        if (island.intentId === pendingSwap?.body.requestId) {
          finishSwap(island.status === "succeeded" ? "Swap complete." : island.error?.message || "Swap failed.", island.status === "succeeded");
        }
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
          refreshSendAmount();
          switchTab("send");
        };
      });
      $("tbl-balances").querySelectorAll("button[data-qswap]").forEach((btn) => {
        btn.onclick = () => {
          if (!pendingSwap) {
            $("swap-in").value = btn.getAttribute("data-qswap");
            if ($("swap-out").value === $("swap-in").value) $("swap-out").value = $("swap-in").value === "USDC" ? "EURC" : "USDC";
          }
          switchTab("swap");
        };
      });
    }

    const savingsDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    const savingsRate = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });
    let savingsAccount = null;
    let savingsRequest = 0;
    let preparingSavings = false;

    function formatSavingsDollars(value) {
      if (value == null || !Number.isFinite(Number(value))) return "—";
      const n = Number(value);
      if (n > 0 && n < 0.01) return "Less than 1¢";
      if (n < 0 && n > -0.01) return "Loss under 1¢";
      return savingsDollars.format(n);
    }

    function updateSavingsButtons() {
      const amount = $("savings-amount").value.trim();
      const available = savingsAccount?.available && !preparingSavings;
      const valid = /^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$/.test(amount) && Number(amount) > 0 && Number.isFinite(Number(amount));
      const balance = savingsAccount?.balance == null ? null : Number(savingsAccount.balance);
      $("savings-deposit").disabled = !available || !valid;
      $("savings-withdraw").disabled = !available || !valid || balance === null || Number(amount) > balance;
      $("savings-withdraw-all").disabled = !available || !(balance > 0);
    }

    async function refreshSavings() {
      const current = ++savingsRequest;
      savingsAccount = null;
      updateSavingsButtons();
      $("savings-status").textContent = "Loading savings…";
      const r = await api("GET", "/savings");
      if (current !== savingsRequest) return;
      savingsAccount = r.ok ? r.data : null;
      $("savings-balance").textContent = formatSavingsDollars(savingsAccount?.balance);
      $("savings-earned").textContent = formatSavingsDollars(savingsAccount?.earned);
      $("savings-rate").textContent = Number.isFinite(savingsAccount?.annualRate) ? savingsRate.format(savingsAccount.annualRate) : "—";
      $("savings-status").textContent = savingsAccount?.available ? "" : "Savings unavailable. Refresh to try again.";
      updateSavingsButtons();
    }

    async function reviewSavings(kind, all = false) {
      if (!savingsAccount?.available || preparingSavings) return;
      const amount = all ? "all" : $("savings-amount").value.trim();
      preparingSavings = true;
      updateSavingsButtons();
      try {
        await propose(kind, { vault: "savings", amount }, "Preparing your savings review…");
      } finally {
        preparingSavings = false;
        updateSavingsButtons();
      }
    }

    async function refreshContacts() {
      const r = await api("GET", "/contacts");
      if (!r.ok) return;
      const list = r.data.contacts || [];
      $("tbl-contacts").innerHTML = list.length
        ? list
            .map(
              (c, index) =>
                "<tr>" +
                "<td><strong>" + escapeHtml(c.name) + "</strong></td>" +
                "<td class='mono'>" + escapeHtml(c.address) + "</td>" +
                "<td><button type='button' class='btn-sm' data-contact-index='" + index + "'>Send to " + escapeHtml(c.name) + "</button></td>" +
                "</tr>"
            )
            .join("")
        : "<tr><td colspan='3' class='empty-state'>No contacts saved yet.</td></tr>";

      $("tbl-contacts").querySelectorAll("button[data-contact-index]").forEach((btn) => {
        btn.onclick = () => {
          pickSendContact(list[Number(btn.dataset.contactIndex)]);
          switchTab("send");
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
      await Promise.all([refreshMe(), refreshBalances(), refreshSavings(), refreshContacts(), refreshActivity()]);
    }

    // --- Intent Actions ---
    async function propose(kind, params, status) {
      if (status) logStatus(status);
      else logStatus("Proposing " + kind + "...", params);
      const r = await api("POST", "/intents", { kind, params });
      if (r.ok) {
        logStatus(r.data.summary || ("Proposed " + kind));
        if (r.data.island) renderIsland(r.data.island);
        refreshActivity();
      }
    }

    async function confirmIntent(id, sendExpires) {
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
      } else if (btn?.isConnected) {
        btn.disabled = sendExpires !== undefined && Date.now() >= sendExpires;
        btn.textContent = sendExpires !== undefined ? "Confirm" : "Confirm Transaction";
        if (sendExpires !== undefined) $("send-review-status").textContent = r.data.error?.message || "Couldn't confirm this send.";
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
      const r = await api("POST", "/choices/" + encodeURIComponent(choiceId), { optionId, prepare: true });
      if (r.ok && r.data.island) renderIsland(r.data.island);
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
      syncSwap();
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
        syncSwap();
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

    let selectedSendContact = null;
    let sendAll = false;
    let sendFeeChecked = false;
    let sendRead = null;
    let sendDebounce;
    let sendPreparing = false;
    const sendRecipient = () => selectedSendContact?.id || $("send-to").value.trim();

    function sendAmount() {
      let value = $("send-amount").value.trim();
      if (value.startsWith(".")) value = "0" + value;
      const decimals = $("send-token").value === "cirBTC" ? 8 : 6;
      return /^(0|[1-9][0-9]*)(?:\\.[0-9]+)?$/.test(value) && (value.split(".")[1]?.length || 0) <= decimals && Number(value) > 0 ? value : null;
    }

    function updateSendButton() {
      $("btn-propose-send").disabled = sendPreparing || !sendRecipient() || !sendAmount() || (sendAll && !sendFeeChecked);
      $("btn-send-all").setAttribute("aria-pressed", String(sendAll));
    }

    function refreshSendAmount(delay = 0) {
      clearTimeout(sendDebounce);
      sendRead?.abort();
      sendFeeChecked = false;
      $("btn-retry-send-amount").hidden = true;
      $("send-max-status").textContent = "";
      if (sendAll) {
        $("send-amount").value = "";
        $("send-max-status").textContent = "Calculating…";
        const to = sendRecipient(), token = $("send-token").value;
        const query = new URLSearchParams({ token });
        if (to) query.set("to", to);
        const read = new AbortController();
        sendRead = read;
        sendDebounce = setTimeout(async () => {
          const result = await api("GET", "/quotes/send-max?" + query, undefined, read.signal);
          if (read.signal.aborted) return;
          if (result.ok) {
            $("send-amount").value = result.data.amount;
            sendFeeChecked = result.data.feeChecked;
            $("send-max-status").textContent = to ? "" : token === "USDC" ? "Balance before the network fee." : "Choose a recipient to check the network fee.";
          } else {
            $("send-max-status").textContent = result.data.error?.message || "Couldn't calculate this amount.";
            $("btn-retry-send-amount").hidden = false;
          }
          updateSendButton();
        }, delay);
      }
      updateSendButton();
    }

    function pickSendContact(contact) {
      selectedSendContact = contact;
      $("send-to").value = contact.name;
      $("send-address").textContent = contact.address;
      refreshSendAmount();
    }

    let contactsRead;
    async function loadSendContacts() {
      contactsRead?.abort();
      const read = new AbortController();
      contactsRead = read;
      const list = $("send-contact-list");
      list.replaceChildren();
      $("send-contacts-status").textContent = "Loading contacts…";
      $("btn-retry-send-contacts").hidden = true;
      const result = await api("GET", "/contacts", undefined, read.signal);
      if (read.signal.aborted) return;
      if (!result.ok) {
        $("send-contacts-status").textContent = result.data.error?.message || "Couldn't load contacts.";
        $("btn-retry-send-contacts").hidden = false;
        return;
      }
      const contacts = result.data.contacts;
      $("send-contacts-status").textContent = contacts.length ? "" : "No contacts yet. Enter a wallet address to send money.";
      for (const c of contacts) {
        const item = document.createElement("li"), button = document.createElement("button"), address = document.createElement("small");
        button.type = "button";
        button.setAttribute("aria-pressed", String(selectedSendContact?.id === c.id));
        button.textContent = c.name;
        address.textContent = c.address;
        button.append(address);
        button.onclick = () => { pickSendContact(c); $("send-contacts-dialog").close(); };
        item.append(button);
        list.append(item);
      }
    }

    $("btn-send-contacts").onclick = () => { $("send-contacts-dialog").showModal(); loadSendContacts(); };
    $("btn-close-send-contacts").onclick = () => $("send-contacts-dialog").close();
    $("send-contacts-dialog").onclose = () => contactsRead?.abort();
    $("btn-retry-send-contacts").onclick = loadSendContacts;
    $("btn-retry-send-amount").onclick = () => refreshSendAmount();
    $("btn-send-all").onclick = () => { sendAll = !sendAll; $("send-amount").value = ""; refreshSendAmount(); };
    $("send-amount").oninput = () => { sendAll = false; refreshSendAmount(); };
    $("send-to").oninput = () => { selectedSendContact = null; $("send-address").textContent = ""; refreshSendAmount(180); };
    $("send-token").onchange = () => refreshSendAmount();
    $("btn-propose-send").onclick = async () => {
      if ($("btn-propose-send").disabled) return;
      sendPreparing = true;
      updateSendButton();
      try { await propose("send", { to: sendRecipient(), amount: sendAll ? "all" : sendAmount(), token: $("send-token").value }); }
      finally { sendPreparing = false; updateSendButton(); }
    };

    // Poll only for the visible Swap panel. Aborting also invalidates late responses.
    let swapTimer;
    let swapReads = new AbortController();
    let swapQuote = null;
    let pendingSwap = null;

    function swapVisible() {
      return !document.hidden && $("tab-swap").classList.contains("active");
    }

    function stopSwapReads() {
      clearTimeout(swapTimer);
      swapReads.abort();
      swapReads = new AbortController();
      swapQuote = null;
      $("btn-swap").disabled = true;
    }

    function swapParams() {
      return { tokenIn: $("swap-in").value, tokenOut: $("swap-out").value, amountIn: $("swap-amount").value.trim() };
    }

    function syncSwap() {
      stopSwapReads();
      const visible = swapVisible();
      const signal = swapReads.signal;
      const pending = pendingSwap;
      if (pending && pending.owner !== JSON.stringify(headers())) {
        finishSwap("Wallet or session changed. Check activity for your previous swap.", true);
        return;
      }
      for (const id of ["swap-in", "swap-out", "swap-amount"]) $(id).disabled = !!pending;
      $("btn-swap").textContent = pending?.retry ? "Retry swap" : "Swap";
      if (pending) {
        $("btn-swap").disabled = !visible || !pending.retry;
        if (visible && !pending.submitting && !pending.retry) {
          swapTimer = setTimeout(() => checkSwap(pending, signal), 2000);
        }
        return;
      }

      const params = swapParams();
      const decimal = params.tokenIn === "cirBTC" ? /^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,8})?$/ : /^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$/;
      if (!visible || params.amountIn.length > 80 || !decimal.test(params.amountIn) || !(Number(params.amountIn) > 0)) {
        $("out-swap-quote").textContent = visible ? "Enter an amount to get a quote." : "";
        return;
      }
      if (params.tokenIn === params.tokenOut) {
        $("out-swap-quote").textContent = "Choose two different currencies.";
        return;
      }
      $("out-swap-quote").textContent = "Getting a live quote…";
      swapTimer = setTimeout(() => refreshQuote(params, signal), 500);
    }

    async function refreshQuote(params, signal) {
      if (signal.aborted || !swapVisible()) return;
      const r = await api("POST", "/quotes/swap", params, signal);
      if (signal.aborted || !swapVisible()) return;
      const { estimatedOut, minOut } = r.data.data || {};
      if (r.ok && Number(minOut) > 0 && Number(estimatedOut) > 0) {
        swapQuote = { ...params, minOut };
        $("out-swap-quote").textContent = "Estimated output: " + estimatedOut + " " + params.tokenOut + " · Minimum received: " + minOut + " " + params.tokenOut;
      } else {
        swapQuote = null;
        $("out-swap-quote").textContent = r.data.error?.message || "Quote unavailable.";
      }
      $("btn-swap").disabled = !swapQuote;
      swapTimer = setTimeout(() => refreshQuote(params, signal), swapQuote ? 500 : 2000);
    }

    function finishSwap(message, clearAmount = false) {
      pendingSwap = null;
      $("out-swap-status").textContent = message;
      if (clearAmount) $("swap-amount").value = "";
      syncSwap();
    }

    function applySwapStatus(data) {
      if (data.island?.kind === "receipt") {
        renderIsland(data.island);
      } else if (data.status === "requote" || data.statusReason === "price_changed") {
        finishSwap("The price changed. Check the new estimate and tap Swap again.");
      } else if (data.status === "failed" || data.status === "rejected") {
        finishSwap(data.error?.message || data.summary || data.statusReason || "Swap failed.");
      } else if (data.status === "succeeded") {
        finishSwap("Swap complete.", true);
        refreshAll();
      } else {
        $("out-swap-status").textContent = data.error?.message || data.summary || "Your swap is processing.";
        syncSwap();
      }
    }

    async function checkSwap(pending, signal) {
      if (signal.aborted || !swapVisible()) return;
      const r = await api("GET", "/intents/" + encodeURIComponent(pending.body.requestId), undefined, signal);
      if (signal.aborted || pending !== pendingSwap || !swapVisible()) return;
      if (r.ok) {
        applySwapStatus(r.data);
        return;
      }
      if (r.status === 404 && pending.unacknowledged) {
        pending.retry = true;
        $("out-swap-status").textContent = "Submission could not be confirmed. Retry the same swap.";
      } else {
        $("out-swap-status").textContent = "Waiting for a swap status update…";
      }
      syncSwap();
    }

    $("btn-swap").onclick = async () => {
      if (!swapVisible() || $("btn-swap").disabled) return;
      if (!pendingSwap) {
        const params = swapParams();
        if (!swapQuote || Object.keys(params).some(key => params[key] !== swapQuote[key])) return syncSwap();
        pendingSwap = { body: { requestId: crypto.randomUUID(), ...swapQuote }, owner: JSON.stringify(headers()) };
      }
      const pending = pendingSwap;
      if (pending.submitting || pending.owner !== JSON.stringify(headers())) return syncSwap();
      pending.submitting = true;
      pending.retry = false;
      syncSwap();
      $("out-swap-status").textContent = "Submitting your swap…";
      const r = await api("POST", "/swaps", pending.body);
      // A receipt can arrive over the event stream before the POST returns.
      if (pending !== pendingSwap) return;
      pending.submitting = false;
      if (r.ok && r.data.intentId === pending.body.requestId) {
        pending.unacknowledged = false;
        applySwapStatus(r.data);
      } else if (r.status >= 400 && r.status < 500 && r.status !== 408) {
        finishSwap(r.data.error?.message || "Could not submit the swap.");
      } else {
        pending.unacknowledged = true;
        $("out-swap-status").textContent = "Checking whether the swap was submitted…";
        syncSwap();
      }
    };
    function swapEdited() {
      if (!pendingSwap) $("out-swap-status").textContent = "";
      syncSwap();
    }
    $("swap-amount").oninput = swapEdited;
    $("swap-in").onchange = swapEdited;
    $("swap-out").onchange = swapEdited;
    for (const id of ["inp-dev-user", "inp-privy-token", "inp-session-id"]) $(id).addEventListener("input", syncSwap);
    document.onvisibilitychange = syncSwap;
    window.onpagehide = stopSwapReads;
    window.onpageshow = syncSwap;

    $("btn-refresh-savings").onclick = refreshSavings;
    $("savings-amount").oninput = updateSavingsButtons;
    $("savings-deposit").onclick = () => reviewSavings("earn_deposit");
    $("savings-withdraw").onclick = () => reviewSavings("earn_withdraw");
    $("savings-withdraw-all").onclick = () => reviewSavings("earn_withdraw", true);

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
                syncSwap();
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
                        syncSwap();
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
