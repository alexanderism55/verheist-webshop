// server.js

// --------------------------------------------------
// IMPORTS
// --------------------------------------------------

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const https = require("https");

// --------------------------------------------------
// APP SETUP
// --------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const BASE_URL =
  "https://my403449-api.s4hana.cloud.sap/sap/opu/odata/sap/API_SALES_ORDER_SRV";

const clientCertB64 = process.env.SAP_CERT_B64 || "";
const clientKeyB64 = process.env.SAP_KEY_B64 || "";

console.log("--------------------------------------------------");
console.log("[BOOT] Starting SAP proxy server...");
console.log("[BOOT] SAP_CERT_B64:", clientCertB64 ? "Success" : "Fail");
console.log("[BOOT] SAP_KEY_B64:", clientKeyB64 ? "Success" : "Fail");

if (!clientCertB64 || !clientKeyB64) {
  throw new Error("Missing SAP_CERT_B64 or SAP_KEY_B64 environment variable");
}

const clientCert = Buffer.from(clientCertB64, "base64");
const clientKey = Buffer.from(clientKeyB64, "base64");

console.log("[BOOT] clientCert decode:", clientCert.length > 0 ? "Success" : "Fail");
console.log("[BOOT] clientKey decode:", clientKey.length > 0 ? "Success" : "Fail");

const sapAgent = new https.Agent({
  cert: clientCert,
  key: clientKey,
  rejectUnauthorized: true,
});

console.log("[BOOT] HTTPS SAP agent:", sapAgent ? "Success" : "Fail");
console.log("[BOOT] SAP base URL:", BASE_URL ? "Success" : "Fail");
console.log("--------------------------------------------------");

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

function toSapDate(date = new Date()) {
  return `/Date(${date.getTime()})/`;
}

function preview(text, max = 300) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function extractCookies(resp) {
  try {
    if (typeof resp.headers.getSetCookie === "function") {
      return resp.headers.getSetCookie().map((c) => c.split(";")[0]);
    }

    if (typeof resp.headers.raw === "function") {
      const rawCookies = resp.headers.raw()["set-cookie"] || [];
      return rawCookies.map((c) => c.split(";")[0]);
    }

    return [];
  } catch (err) {
    console.log("[COOKIE] Cookie extraction:", "Fail");
    return [];
  }
}

async function sapFetch(url, options = {}) {
  const method = options.method || "GET";

  console.log("--------------------------------------------------");
  console.log(`[SAP] ${method} ${url}`);
  console.log("[SAP] Headers:", options.headers ? "Success" : "Fail");
  console.log("[SAP] Body:", options.body ? "Success" : "Not Sent");

  const resp = await fetch(url, {
    ...options,
    agent: sapAgent,
  });

  console.log("[SAP] Response status:", resp.status, resp.statusText);
  return resp;
}

async function fetchCsrfToken() {
  console.log("[CSRF] Requesting token from SAP...");

  const url = `${BASE_URL}/A_SalesOrder?$top=1`;

  const resp = await sapFetch(url, {
    method: "GET",
    headers: {
      "X-CSRF-Token": "Fetch",
      "Accept": "application/json",
    },
  });

  const csrf = resp.headers.get("x-csrf-token");
  const cookies = extractCookies(resp);

  console.log("[CSRF] Token received:", csrf ? "Success" : "Fail");
  console.log("[CSRF] Cookies received:", cookies.length > 0 ? "Success" : "Fail");

  if (!resp.ok) {
    const text = await resp.text();
    console.log("[CSRF] Failed response body:", preview(text));
    throw new Error(`Failed CSRF fetch: ${resp.status} ${resp.statusText}`);
  }

  if (!csrf) {
    const text = await resp.text();
    console.log("[CSRF] Missing token. Response body:", preview(text));
    throw new Error("Failed to obtain CSRF token");
  }

  return { csrf, cookies };
}

async function fetchCsrfAndEtagForOrder(salesOrder) {
  console.log("[ETAG] Fetching CSRF + ETag for sales order:", salesOrder);

  const url = `${BASE_URL}/A_SalesOrder('${salesOrder}')`;

  const resp = await sapFetch(url, {
    method: "GET",
    headers: {
      "X-CSRF-Token": "Fetch",
      "Accept": "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.log("[ETAG] Failed response body:", preview(text));
    throw new Error(`Failed to fetch order for ETag: ${resp.status} ${resp.statusText}`);
  }

  const csrf = resp.headers.get("x-csrf-token");
  const etag = resp.headers.get("etag") || resp.headers.get("ETag") || "*";
  const cookies = extractCookies(resp);

  console.log("[ETAG] CSRF token:", csrf ? "Success" : "Fail");
  console.log("[ETAG] ETag:", etag ? "Success" : "Fail");
  console.log("[ETAG] Cookies:", cookies.length > 0 ? "Success" : "Fail");

  if (!csrf) {
    throw new Error("Failed to obtain CSRF token while fetching ETag");
  }

  return { csrf, cookies, etag };
}

function validateCartItems(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return "cartItems must be a non-empty array";
  }

  for (const item of cartItems) {
    if (
      item.itemNo === undefined ||
      item.itemNo === null ||
      item.material === undefined ||
      item.material === null ||
      item.material === "" ||
      item.quantity === undefined ||
      item.quantity === null
    ) {
      return "Each cart item must contain itemNo, material, and quantity";
    }

    if (!Number.isFinite(Number(item.itemNo))) {
      return `Invalid itemNo: ${item.itemNo}`;
    }

    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
      return `Invalid quantity for material ${item.material}: ${item.quantity}`;
    }
  }

  return null;
}

function buildItemsPayload(cartItems) {
  return cartItems.map((ci) => ({
    SalesOrderItem: String(ci.itemNo),
    Material: String(ci.material),
    RequestedQuantity: String(ci.quantity),
    RequestedQuantityUnit: "PC",
  }));
}

// --------------------------------------------------
// ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  console.log("[HTTP] GET /");
  res.send("Node proxy for SAP Sales Order API is running (client cert auth)");
});

app.get("/api/health", (req, res) => {
  console.log("[HTTP] GET /api/health");
  res.json({
    ok: true,
    service: "sap-sales-order-proxy",
    certLoaded: !!clientCertB64,
    keyLoaded: !!clientKeyB64,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/createSalesOrder", async (req, res) => {
  console.log("==================================================");
  console.log("[CREATE] /api/createSalesOrder called");
  console.log("[CREATE] Incoming body:", req.body ? "Success" : "Fail");

  try {
    const { cartItems, customerRef, withDeliveryBlock } = req.body;

    const validationError = validateCartItems(cartItems);
    if (validationError) {
      console.log("[CREATE] Validation:", "Fail");
      return res.status(400).send(validationError);
    }

    console.log("[CREATE] customerRef:", customerRef ? "Success" : "Default Used");
    console.log("[CREATE] withDeliveryBlock:", typeof withDeliveryBlock === "boolean" ? "Success" : "Default Used");
    console.log("[CREATE] cart item count:", cartItems.length > 0 ? "Success" : "Fail");

    const { csrf, cookies } = await fetchCsrfToken();

    const itemsPayload = buildItemsPayload(cartItems);
    const deliveryBlockReason = withDeliveryBlock ? "53" : "";
    const dateValue = toSapDate(new Date());

    const body = {
      SalesOrderType: "OR",
      SalesOrganization: "2510",
      DistributionChannel: "10",
      OrganizationDivision: "00",
      SoldToParty: "25186001",
      PurchaseOrderByCustomer: customerRef || "DemoWebshop",
      SalesOrderDate: dateValue,
      RequestedDeliveryDate: dateValue,
      PricingDate: dateValue,
      BillingDocumentDate: dateValue,
      ShippingCondition: "06",
      ShippingType: "01",
      TransactionCurrency: "EUR",
      CustomerPaymentTerms: "0004",
      DeliveryBlockReason: deliveryBlockReason,
      to_Item: itemsPayload,
    };

    console.log("[CREATE] Payload build:", body ? "Success" : "Fail");

    const url = `${BASE_URL}/A_SalesOrder`;

    const headersToSend = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookies.join("; "),
    };

    console.log("[CREATE] POST preparation:", headersToSend ? "Success" : "Fail");
    console.log("[CREATE] Cookies ready:", cookies.length > 0 ? "Success" : "Fail");

    const resp = await sapFetch(url, {
      method: "POST",
      headers: headersToSend,
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    console.log("[CREATE] SAP response body:", text ? "Success" : "Empty");

    if (!resp.ok) {
      console.log("[CREATE] SAP create request:", "Fail");
      return res.status(resp.status).send(text);
    }

    let data;
    try {
      data = JSON.parse(text);
      console.log("[CREATE] SAP response parse:", "Success");
    } catch (e) {
      console.log("[CREATE] SAP response parse:", "Fail");
      return res.status(500).send("Failed to parse SAP response");
    }

    const so = data?.d?.SalesOrder;

    console.log("[CREATE] Created SalesOrder:", so ? "Success" : "Fail");

    return res.json({
      salesOrder: so,
      message: "Sales order created successfully",
    });
  } catch (e) {
    console.log("[CREATE] Unexpected error:", e.message);
    return res.status(500).send(e.message);
  }
});

app.patch("/api/updateDeliveryBlock", async (req, res) => {
  console.log("==================================================");
  console.log("[PATCH] /api/updateDeliveryBlock called");
  console.log("[PATCH] Incoming body:", req.body ? "Success" : "Fail");

  try {
    const { salesOrder } = req.body;

    if (!salesOrder) {
      console.log("[PATCH] Validation:", "Fail");
      return res.status(400).send("salesOrder is required");
    }

    console.log("[PATCH] SalesOrder input:", "Success");

    const { csrf, cookies, etag } = await fetchCsrfAndEtagForOrder(salesOrder);

    const body = {
      DeliveryBlockReason: "",
    };

    const url = `${BASE_URL}/A_SalesOrder('${salesOrder}')`;

    const headersToSend = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      "If-Match": etag || "*",
      Cookie: cookies.join("; "),
    };

    console.log("[PATCH] If-Match ready:", etag ? "Success" : "Fail");
    console.log("[PATCH] Cookies ready:", cookies.length > 0 ? "Success" : "Fail");
    console.log("[PATCH] PATCH payload:", body ? "Success" : "Fail");

    const resp = await sapFetch(url, {
      method: "PATCH",
      headers: headersToSend,
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    console.log("[PATCH] SAP response body:", text ? "Success" : "Empty");

    if (!resp.ok) {
      console.log("[PATCH] SAP patch request:", "Fail");
      return res.status(resp.status).send(text);
    }

    console.log("[PATCH] Delivery block removal:", "Success");

    return res.json({
      ok: true,
      salesOrder,
      message: "Delivery block removed successfully",
    });
  } catch (e) {
    console.log("[PATCH] Unexpected error:", e.message);
    return res.status(500).send(e.message);
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`[BOOT] Server running on http://localhost:${PORT}`);
  console.log("[BOOT] Ready to receive frontend requests");
  console.log("==================================================");
});