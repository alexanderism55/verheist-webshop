# Work Instruction: Material Webshop, API Setup, and Claude MCP Order Flow

## Overview

This document explains how to set up the simple material webshop, run the API locally, use the API for both reading and writing, and prepare the order flow so that a placed order can be forwarded to Claude through an MCP server.[cite:28][cite:17][cite:39]

The current setup uses a static HTML frontend and a Node.js Express API, which is a standard pattern for simple browser-based applications that need JSON endpoints and routing.[cite:28][cite:25] The API already supports read operations with `GET` routes and write operations with a `POST` route, which is the minimum needed for loading materials and creating orders.[cite:28][cite:25]

## System Components

The full solution has four parts:

- `material-webshop.html` — the browser frontend where the user selects materials, enters quantities, and submits an order.
- `server.js` — the Express API server that serves the frontend and exposes JSON endpoints.
- `package.json` — the Node.js project file that defines dependencies and the start command.
- Future MCP bridge logic — an additional step that takes a created order and forwards it to Claude through an MCP-compatible integration path.[cite:28][cite:17][cite:39]

Anthropic describes the Messages API as stateless and based on sending messages in structured request format, while MCP is described as an open standard for secure, two-way connections between AI tools and external systems.[cite:34][cite:39] That means the cleanest architecture is to keep the webshop API responsible for order creation, then pass validated order data to a separate MCP-aware component that Claude can interact with or receive context from.[cite:39][cite:42]

## Folder Structure

Use this project structure:

```text
material-webshop-api/
├── material-webshop.html
├── server.js
├── package.json
└── work-instructions-material-webshop.md
```

This is a simple static-plus-API structure and is suitable for local development because Express can serve both the HTML file and the API endpoints from one process.[cite:25][cite:28]

## Installation

### Step 1: Install Node.js

Install a current Node.js LTS version on the machine that will run the webshop API. Express applications require Node.js in order to execute JavaScript on the server and expose HTTP routes.[cite:25][cite:28]

### Step 2: Open the project folder

Place the three project files in one folder named `material-webshop-api`. The server expects `material-webshop.html` to be in the same directory because static file serving is configured from the project root.[cite:28]

### Step 3: Install dependencies

Run the following command inside the project folder:

```bash
npm install
```

This installs Express for routing and JSON handling, and CORS middleware so browser requests can be allowed across origins when necessary.[cite:17][cite:28][cite:27]

### Step 4: Start the server

Run:

```bash
npm start
```

The server starts on port 3000 by default unless a different `PORT` environment variable is provided, which is a common Express deployment pattern.[cite:25][cite:28]

### Step 5: Open the webshop

Open the following URL in a browser:

```text
http://localhost:3000/material-webshop.html
```

Because Express is serving the static frontend from the same origin, the browser can call `/api/materials` and `/api/orders` without extra frontend configuration.[cite:28][cite:17]

## API Endpoints

The current API supports both reading and writing.

| Endpoint | Method | Purpose | Type |
|---|---|---|---|
| `/api/health` | GET | Check whether the API is running | Read [cite:25] |
| `/api/materials` | GET | Return the list of available materials | Read [cite:28] |
| `/api/orders` | GET | Return the list of created orders | Read [cite:28] |
| `/api/orders` | POST | Create a new order | Write [cite:28][cite:25] |

This means the API already meets the requirement to read and write data at the application level, although the write layer is currently in-memory and not yet persistent across restarts.[cite:25]

## How the Frontend Uses the API

When the page loads, the frontend requests `GET /api/materials` and renders the material list on screen. This follows the standard browser-to-JSON API pattern where `fetch()` reads the catalog before the user interacts with the order form.[cite:25][cite:28]

When the user presses the order button, the frontend sends a `POST /api/orders` request containing customer details and selected material items. This is the write action in the system and is the event that should later trigger forwarding to Claude through the MCP path.[cite:25][cite:39]

## API Request and Response Examples

### Read materials

Request:

```http
GET /api/materials
```

Example response:

```json
[
  { "id": 1, "name": "Steel", "price": 24, "unit": "sheet" },
  { "id": 2, "name": "Wood Panels", "price": 18, "unit": "panel" }
]
```

A JSON list like this is a typical REST-style response for catalog resources in Express APIs.[cite:25][cite:28]

### Create order

Request:

```http
POST /api/orders
Content-Type: application/json
```

Example body:

```json
{
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "notes": "Deliver next week",
  "items": [
    { "materialId": 1, "quantity": 3 },
    { "materialId": 4, "quantity": 2 }
  ]
}
```

Example success response:

```json
{
  "message": "Order created",
  "order": {
    "id": 1,
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "notes": "Deliver next week",
    "items": [
      { "materialId": 1, "name": "Steel", "quantity": 3, "unitPrice": 24, "lineTotal": 72 },
      { "materialId": 4, "name": "Glass", "quantity": 2, "unitPrice": 31, "lineTotal": 62 }
    ],
    "total": 134,
    "createdAt": "2026-05-27T12:00:00.000Z"
  }
}
```

This response structure is appropriate because it confirms the write operation and returns the normalized order object that can be reused by downstream systems.[cite:25][cite:28]

## Operating Procedure

### Daily use

1. Start the server with `npm start`.[cite:25]
2. Open the webshop in the browser at `http://localhost:3000/material-webshop.html`.[cite:28]
3. Wait for the materials list to load from `GET /api/materials`.[cite:28]
4. Select one or more materials and enter quantities.[cite:25]
5. Enter customer name, email, and optional notes.
6. Press **Place order** to send the order to `POST /api/orders`.[cite:25][cite:28]
7. Confirm the success message appears in the frontend.
8. Optionally inspect created orders with `GET /api/orders`.[cite:28]

### Testing with curl

Read materials:

```bash
curl http://localhost:3000/api/materials
```

Read orders:

```bash
curl http://localhost:3000/api/orders
```

Create an order:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Alice",
    "customerEmail": "alice@example.com",
    "notes": "Urgent request",
    "items": [
      { "materialId": 2, "quantity": 5 },
      { "materialId": 6, "quantity": 1 }
    ]
  }'
```

These tests are enough to verify that the API can read data and write new orders without relying on the browser UI.[cite:25][cite:28]

## Read/Write Requirement

The requirement that the API must be able to read and write is satisfied functionally by the existing `GET` and `POST` routes, but it is not yet satisfied operationally for long-term storage because the orders are only kept in memory.[cite:25][cite:28] If the server restarts, all created orders are lost, so production use requires adding persistence such as SQLite, PostgreSQL, or another database-backed storage layer.[cite:25]

The recommended next version is:

- Keep `GET /api/materials` as a read endpoint.
- Keep `GET /api/orders` as a read endpoint.
- Keep `POST /api/orders` as a write endpoint.
- Add `PUT /api/orders/:id` if orders need to be edited later.
- Add `DELETE /api/orders/:id` only if order deletion is part of the workflow.[cite:28]

## Claude and MCP Integration Plan

Anthropic describes MCP as an open standard for connecting AI assistants to tools, data sources, and workflows through MCP servers and clients.[cite:39][cite:42] Anthropic also documents that Claude can be connected to remote MCP servers and that MCP can be used through Claude-related environments and integrations.[cite:37][cite:43]

For this project, the correct business flow is:

1. User presses **Place order** in the webshop.
2. Frontend sends `POST /api/orders` to the webshop API.
3. Webshop API validates the payload and creates the order.
4. After the order is created, the API forwards the structured order to an MCP bridge service.
5. The MCP bridge exposes the order to Claude or sends it into a Claude-compatible workflow using MCP.
6. Claude processes the order instructions, confirmation logic, or downstream automation based on the tools exposed by the MCP server.[cite:39][cite:37][cite:43]

### Recommended architecture

| Component | Responsibility |
|---|---|
| Webshop frontend | Capture user order data |
| Express API | Validate request, read/write order data, trigger downstream flow |
| Database | Persist materials and orders |
| MCP bridge/server | Expose order tools or order context in MCP format for Claude |
| Claude | Read the order context and perform the next business action |

This separation is safer than calling Claude directly from the browser because the server can validate data, control secrets, and log the workflow centrally.[cite:34][cite:39]

## Two Integration Options

### Option A: API calls Claude directly after order creation

Anthropic's Messages API accepts structured message input and is appropriate when the application itself sends prompts directly to Claude.[cite:34][cite:35] In this option, the Express API would call Claude immediately after saving the order and include the order JSON in the `messages` payload.[cite:34]

This is the fastest approach to implement, but it is not the same as using MCP. It is better when the goal is simply to notify Claude about a new order rather than expose a reusable external tool interface.[cite:34][cite:39]

### Option B: API forwards the order into an MCP-connected workflow

MCP is designed for two-way structured connections between applications, tools, and AI systems, which makes it a better fit when Claude needs to interact with external business tools in a standardized way.[cite:39][cite:42] In this option, the webshop API sends the new order to an MCP server or an MCP bridge service, and Claude accesses that order through the MCP tool layer rather than through a direct prompt-only API call.[cite:37][cite:43]

This is the recommended option for the stated plan because it aligns the order event with a tool-based, extensible integration model.[cite:39][cite:42]

## Recommended Implementation Sequence

1. Keep the existing Express API as the entry point for all webshop traffic.[cite:28]
2. Add database persistence so orders survive server restarts.[cite:25]
3. After `POST /api/orders` succeeds, trigger a server-side function called `forwardOrderToMcp(order)`.
4. Build or connect an MCP server that can receive new order data as a resource, tool input, or queued event for Claude-facing workflows.[cite:39][cite:42]
5. Define what Claude should do with the order, for example summarize it, classify it, route it, or prepare a reply.[cite:34][cite:37]
6. Add logging and retries so failed Claude or MCP actions do not lose the original order.

## Example Forwarding Pattern

A practical server-side pattern is:

```js
app.post('/api/orders', async (req, res) => {
  const order = createOrder(req.body);
  await saveOrder(order);
  await forwardOrderToMcp(order);
  res.status(201).json({ message: 'Order created', order });
});
```

This keeps the webshop API responsible for order validation and order creation, while the forwarding logic is handled in a separate function that can be expanded later.[cite:28][cite:39]

## Security and Operations Notes

CORS should be enabled intentionally and narrowed to approved frontend origins before production deployment, because CORS controls which browser origins are allowed to call the API.[cite:17][cite:27] The current permissive setup is acceptable for local testing but should be restricted for real deployment.[cite:17]

Anthropic's API uses structured requests and requires secure handling of API credentials, so any Claude or MCP bridge secrets must remain on the server and never be exposed in the browser frontend.[cite:34][cite:44] This makes the Express layer the correct place to store environment variables and outbound integration logic.[cite:34]

## Troubleshooting

| Problem | Likely cause | Action |
|---|---|---|
| Frontend loads but no materials appear | `/api/materials` is not reachable | Check that `npm start` is running and test `GET /api/materials` in a browser or curl [cite:28] |
| Order button fails | Invalid payload or API route issue | Check browser console and test `POST /api/orders` manually with curl [cite:25] |
| Orders disappear after restart | In-memory storage only | Add a database layer for persistence [cite:25] |
| Claude does not receive the order | MCP bridge or downstream workflow not connected | Verify the forwarding function, MCP server status, and Claude-side MCP configuration [cite:37][cite:39] |
| Browser request blocked | Origin policy or CORS issue | Restrict and configure CORS correctly in Express [cite:17][cite:27] |

## Final Operating Recommendation

Use the current project as the first stage of the order system: the frontend collects the order, the Express API validates and stores it, and a second server-side integration forwards the order to Claude through MCP.[cite:28][cite:39][cite:42] For production readiness, the most important upgrades are persistent storage, server-side logging, restricted CORS, and a dedicated MCP bridge that receives each newly created order after the write operation succeeds.[cite:17][cite:25][cite:39]
