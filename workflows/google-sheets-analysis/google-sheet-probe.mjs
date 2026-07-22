import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const [, , credentialPath, spreadsheetId, gidArg = ""] = process.argv;

if (!credentialPath || !spreadsheetId) {
  console.error("Usage: node google-sheet-probe.mjs <service-account-json> <spreadsheet-id> [gid]");
  process.exit(2);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const proxy = getProxy(parsedUrl);
    const makeRequest = (socket) => {
      const reqOptions = proxy
        ? {
            protocol: "https:",
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            method,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            headers,
            socket,
            createConnection: () => socket,
          }
        : { method, headers };
      const req = proxy
        ? https.request(reqOptions, handleResponse)
        : https.request(url, reqOptions, handleResponse);

      function handleResponse(res) {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = text;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // Keep raw text for non-JSON errors.
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const err = new Error(`HTTP ${res.statusCode}: ${text.slice(0, 1000)}`);
          err.statusCode = res.statusCode;
          err.data = data;
          reject(err);
        }
      });
      }
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    };
    if (proxy) {
      createProxyTunnel(parsedUrl, proxy).then(makeRequest, reject);
    } else {
      makeRequest();
    }
  });
}

function getProxy(parsedUrl) {
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    "";
  if (!raw || parsedUrl.protocol !== "https:") return null;
  const proxy = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (proxy.protocol !== "http:") {
    throw new Error("Only HTTP proxies are currently supported via HTTPS_PROXY, for example http://127.0.0.1:7890");
  }
  return proxy;
}

function createProxyTunnel(parsedUrl, proxy) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${parsedUrl.hostname}:${parsedUrl.port || 443}` };
    if (proxy.username || proxy.password) {
      headers["proxy-authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    }
    const connectReq = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${parsedUrl.hostname}:${parsedUrl.port || 443}`,
      headers,
    });
    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: parsedUrl.hostname,
      });
      tlsSocket.on("secureConnect", () => resolve(tlsSocket));
      tlsSocket.on("error", reject);
    });
    connectReq.on("error", reject);
    connectReq.end();
  });
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();

  const token = await request("POST", "https://oauth2.googleapis.com/token", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(body),
    },
    body,
  });
  return token.access_token;
}

function apiGet(path, token) {
  return request("GET", `https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function quoteSheetName(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

try {
  const raw = await fs.readFile(credentialPath, "utf8");
  const credentials = JSON.parse(raw);
  console.log(`Service account: ${credentials.client_email}`);
  const token = await getAccessToken(credentials);

  const fields = "sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))";
  const meta = await apiGet(`${spreadsheetId}?fields=${encodeURIComponent(fields)}`, token);
  const sheets = meta.sheets?.map((sheet) => sheet.properties) ?? [];
  console.log("Sheets:");
  for (const sheet of sheets) {
    const rows = sheet.gridProperties?.rowCount ?? "?";
    const cols = sheet.gridProperties?.columnCount ?? "?";
    console.log(`- gid=${sheet.sheetId} title="${sheet.title}" size=${rows}x${cols}`);
  }

  const gid = gidArg ? Number(gidArg) : undefined;
  const selected = Number.isFinite(gid)
    ? sheets.find((sheet) => sheet.sheetId === gid)
    : sheets[0];
  if (!selected) {
    throw new Error(`Could not find gid=${gidArg}.`);
  }

  const range = `${quoteSheetName(selected.title)}!A1:AD25`;
  const valuesPath = `${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const values = await apiGet(valuesPath, token);
  console.log(`\nPreview: ${selected.title} (${range})`);
  const rows = values.values ?? [];
  for (const row of rows.slice(0, 25)) {
    console.log(row.map((cell) => String(cell).replace(/\s+/g, " ").trim()).join("\t"));
  }
} catch (error) {
  console.error(error.message);
  if (error.statusCode === 403) {
    console.error("\nPermission issue: share the spreadsheet with the service account email above as Viewer, or ask the admin to grant it access.");
  } else if (error.statusCode === 404) {
    console.error("\nNot found: the spreadsheet ID is wrong, or the service account cannot see this spreadsheet.");
  }
  process.exit(1);
}
