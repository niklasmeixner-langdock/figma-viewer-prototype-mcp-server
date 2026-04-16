#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || "3001", 10);

// Cache the HTML template
let cachedHtml: string | null = null;
function getPrototypeHtml(): string {
  if (!cachedHtml) {
    cachedHtml = readFileSync(join(__dirname, "ui", "prototype.html"), "utf-8");
  }
  return cachedHtml;
}

// Encode config for safe embedding in a data attribute
function encodeForDataAttr(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Encode config for safe embedding in a <script> tag
function safeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "prototype-viewer",
    version: "1.0.0",
  });

  // Register the app resource (the raw HTML template)
  registerAppResource(
    server,
    "Prototype Viewer",
    "ui://prototype/viewer",
    { description: "Interactive Figma prototype viewer" },
    async () => ({
      contents: [
        {
          uri: "ui://prototype/viewer",
          mimeType: RESOURCE_MIME_TYPE,
          text: getPrototypeHtml(),
          _meta: {
            ui: {
              csp: {
                resourceDomains: ["https://www.figma.com"],
                connectDomains: ["https://www.figma.com"],
              },
            },
          },
        },
      ],
    })
  );

  // Register the showPrototype tool
  registerAppTool(
    server,
    "showPrototype",
    {
      title: "Show Prototype",
      description:
        "Display a Figma prototype in an interactive iframe viewer.",
      inputSchema: {
        prototypeUrl: z
          .string()
          .url()
          .describe("Figma prototype URL to display."),
        title: z
          .string()
          .optional()
          .describe("Display title for the prototype viewer."),
      },
      _meta: {
        ui: { resourceUri: "ui://prototype/viewer" },
      },
    },
    async ({ prototypeUrl, title }: { prototypeUrl: string; title?: string }) => {
      const displayTitle = title || "Prototype";

      const config = { prototypeUrl, title: displayTitle };

      // Inject config into the HTML template
      let html = getPrototypeHtml();

      // Inject as data attribute on .container
      html = html.replace(
        '<div class="container">',
        `<div class="container" data-config="${encodeForDataAttr(config)}">`
      );

      // Inject as window-level config
      html = html.replace(
        "<script>",
        `<script>window.PROTOTYPE_CONFIG = ${safeJsonForScript(config)};</script>\n  <script>`
      );

      const renderData = { config };

      return {
        content: [
          {
            type: "resource" as const,
            resource: {
              uri: "ui://prototype/viewer",
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
            },
          },
        ],
        _meta: {
          "mcpui.dev/ui-initial-render-data": renderData,
        },
      };
    }
  );

  return server;
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", name: "prototype-viewer" });
});

app.listen(PORT, () => {
  console.log(`Prototype MCP server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
});
