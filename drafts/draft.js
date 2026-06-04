// server.js

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

// Base URL exactly matching your Postman host and path (without /A_SalesOrder at the end)
const BASE_URL = "https://my403449-api.s4hana.cloud.sap/sap/opu/odata/sap/API_SALES_ORDER_SRV";

const USERNAME = "S4_ODATA_USER";   // adjust to your comm user
const PASSWORD = "#E7{AuK$y4M%G%J#KA<%X5j\\]Fmd+YM6cCAm\\zRH";    // adjust to your password

// Dumb toggle for demo if you ever want it on backend
let paymentSuccessToggle = true;

// Remember last order that was created WITH a delivery block
let lastBlockedSalesOrder = null;

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

function basicAuthHeader() {
  const token = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

// Fetch CSRF token and cookies from SAP
async function fetchCsrfToken() {
  console.log("[CSRF] Requesting token from SAP");
  const resp = await fetch(`${BASE_URL}/A_SalesOrder?$top=1`, {
    method: "GET",
    headers: {
      "X-CSRF-Token": "Fetch",
      "Authorization": basicAuthHeader(),
      "Accept": "application/json"
    }
  });

  const csrf = resp.headers.get("x-csrf-token");
  const rawCookies = resp.headers.raw()["set-cookie"] || [];
  const cookies = rawCookies.map(c => c.split(";")[0]);

  console.log("[CSRF] Token:", csrf);
  console.log("[CSRF] Cookies:", cookies);

  if (!csrf) {
    const text = await resp.text();
    console.log("[CSRF] Response body (first 300 chars):", text.slice(0, 300));
    throw new Error("Failed to obtain CSRF token");
  }

  return { csrf, cookies };
}

// Fetch CSRF + cookies + ETag for a specific SalesOrder
async function fetchCsrfAndEtagForOrder(salesOrder) {
  console.log("[ETAG] Fetching ETag for order:", salesOrder);

  const url = `${BASE_URL}/A_SalesOrder('${salesOrder}')`;
  console.log("[ETAG] URL used:", url);

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-CSRF-Token": "Fetch",
      "Authorization": basicAuthHeader(),
      "Accept": "application/json"
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.log("[ETAG] Failed GET:", resp.status, text.slice(0, 300));
    throw new Error("Failed to fetch order for ETag");
  }

  const csrf = resp.headers.get("x-csrf-token");
  const etag = resp.headers.get("etag") || resp.headers.get("ETag") || "*";
  const rawCookies = resp.headers.raw()["set-cookie"] || [];
  const cookies = rawCookies.map(c => c.split(";")[0]);

  console.log("[ETAG] CSRF:", csrf);
  console.log("[ETAG] ETag:", etag);
  console.log("[ETAG] Cookies:", cookies);

  if (!csrf) {
    throw new Error("Failed to obtain CSRF token (ETag fetch)");
  }

  return { csrf, cookies, etag };
}

// --------------------------------------------------
// ROUTES
// --------------------------------------------------

// Health check
app.get("/", (req, res) => {
  res.send("Node proxy for SAP Sales Order API is running");
});

// Create Sales Order (with or without delivery block)
app.post("/api/createSalesOrder", async (req, res) => {
  console.log("--------------------------------------------------");
  console.log("[CREATE] /api/createSalesOrder called");
  console.log("[CREATE] Request body from frontend:", req.body);

  try {
    const { cartItems, customerRef, withDeliveryBlock } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      console.log("[CREATE] cartItems invalid or empty");
      return res.status(400).send("cartItems must be a non-empty array");
    }

    console.log("[CREATE] withDeliveryBlock flag:", withDeliveryBlock);

    // 1) CSRF + cookies
    const { csrf, cookies } = await fetchCsrfToken();

    // 2) Build payload
    const dateValue = "/Date(1779840000000)/";

    const itemsPayload = cartItems.map(ci => ({
      SalesOrderItem: String(ci.itemNo),
      Material: ci.material,
      RequestedQuantity: String(ci.quantity),
      RequestedQuantityUnit: "PC"
    }));

    const deliveryBlockReason = withDeliveryBlock ? "53" : "";

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
       to_Item: [
    {
      SalesOrderItem: "10",
      Material: "TG11",
      RequestedQuantity: "1",
      RequestedQuantityUnit: "PC"
    }
  ]
    };

    console.log("[CREATE] Body to SAP:", body);

    const url = `${BASE_URL}/A_SalesOrder`;
    console.log("[CREATE] Final URL used in fetch:", url);

    const headersToSend = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      "Authorization": basicAuthHeader(),
      "Cookie": cookies.join("; ")
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: headersToSend,
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    console.log("[CREATE] Response status:", resp.status);
    console.log("[CREATE] Response body (first 300 chars):", text.slice(0, 300));

    if (!resp.ok) {
      return res.status(resp.status).send(text);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("[CREATE] JSON parse error:", e.message);
      return res.status(500).send("Failed to parse SAP response");
    }

    const so = data.d && data.d.SalesOrder;
    console.log("[CREATE] Created SalesOrder:", so);

    if (withDeliveryBlock) {
      lastBlockedSalesOrder = so;
      console.log("[CREATE] Remembering blocked SalesOrder:", lastBlockedSalesOrder);
    }

    res.json({ salesOrder: so });
  } catch (e) {
    console.log("[CREATE] Unexpected error:", e.message);
    res.status(500).send(e.message);
  }
});

// Update Sales Order: remove delivery block
app.patch("/api/updateDeliveryBlock", async (req, res) => {
  console.log("--------------------------------------------------");
  console.log("[PATCH] /api/updateDeliveryBlock called");
  console.log("[PATCH] Request body from frontend:", req.body);

  try {
    const { salesOrder } = req.body;

    if (!salesOrder) {
      console.log("[PATCH] Missing salesOrder");
      return res.status(400).send("salesOrder is required");
    }

    console.log("[PATCH] SalesOrder to update:", salesOrder);

    const { csrf, cookies, etag } = await fetchCsrfAndEtagForOrder(salesOrder);

    const body = {
      DeliveryBlockReason: ""
    };

    const url = `${BASE_URL}/A_SalesOrder('${salesOrder}')`;
    console.log("[PATCH] Final URL used in fetch:", url);

    const headersToSend = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      "If-Match": etag || "*",
      "Authorization": basicAuthHeader(),
      "Cookie": cookies.join("; ")
    };

    const resp = await fetch(url, {
      method: "PATCH",
      headers: headersToSend,
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    console.log("[PATCH] Response status:", resp.status);
    console.log("[PATCH] Response body (first 300 chars):", text.slice(0, 300));

    if (!resp.ok) {
      return res.status(resp.status).send(text);
    }

    res.json({ ok: true });
  } catch (e) {
    console.log("[PATCH] Unexpected error:", e.message);
    res.status(500).send(e.message);
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});