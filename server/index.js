import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createPost } from "./mcp.tool.js";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only JPEG, PNG, GIF, and WEBP are allowed."));
        }
    },
});

const server = new McpServer({
    name: "example-server",
    version: "1.0.0",
});

const app = express();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Manual tool registry
const toolsRegistry = new Map();

const addTwoNumbers = {
    name: "addTwoNumbers",
    description: "Add two numbers",
    schema: z.object({
        a: z.number(),
        b: z.number(),
    }),
    handler: async (arg) => {
        const { a, b } = arg;
        return {
            content: [
                {
                    type: "text",
                    text: `The sum of ${a} and ${b} is ${a + b}`,
                },
            ],
        };
    },
};

const createPostTool = {
    name: "createPost",
    description: "Create a post on X with optional text and image",
    schema: z.object({
        status: z.string().optional(),
        imagePath: z.string().optional(),
    }),
    handler: async (arg) => {
        const { status, imagePath } = arg;
        return createPost(status, imagePath);
    },
};

toolsRegistry.set(addTwoNumbers.name, addTwoNumbers);
toolsRegistry.set(createPostTool.name, createPostTool);

// Register tools with McpServer (for SDK compatibility)
server.tool(
    addTwoNumbers.name,
    addTwoNumbers.description,
    addTwoNumbers.schema,
    addTwoNumbers.handler
);
server.tool(
    createPostTool.name,
    createPostTool.description,
    createPostTool.schema,
    createPostTool.handler
);

const transports = {};

app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
        delete transports[transport.sessionId];
    });
    await server.connect(transport);
});

app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    console.log("Received /messages request with sessionId:", sessionId, "Body:", req.body);
    const transport = transports[sessionId];
    if (transport) {
        try {
            await transport.handlePostMessage(req, res);
        } catch (error) {
            console.error("Error handling /messages:", error);
            res.status(500).json({ error: "Internal server error: " + error.message });
        }
    } else {
        console.error("No transport found for sessionId:", sessionId);
        res.status(400).json({ error: "No transport found for sessionId" });
    }
});

app.get("/tools", async (req, res) => {
    try {
        const toolsList = Array.from(toolsRegistry.values()).map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: Object.fromEntries(
                    Object.entries(tool.schema.shape).map(([key, schema]) => [
                        key,
                        { type: schema._def.typeName.toLowerCase() },
                    ])
                ),
                required: Object.keys(tool.schema.shape).filter(
                    (key) => !tool.schema.shape[key].isOptional()
                ),
            },
        }));
        res.json(toolsList);
    } catch (error) {
        console.error("Error in /tools endpoint:", error);
        res.status(500).json({ error: "Failed to fetch tools: " + error.message });
    }
});

app.post("/call-tool", async (req, res) => {
    const { name, arguments: args } = req.body;
    console.log("Received /call-tool request:", { name, args });
    try {
        const tool = toolsRegistry.get(name);
        if (!tool) {
            throw new Error(`Tool ${name} not found`);
        }
        const validatedArgs = tool.schema.parse(args);
        const result = await tool.handler(validatedArgs);
        res.json(result);
    } catch (error) {
        console.error("Tool call error:", error);
        res.status(500).json({ error: "Tool call failed: " + error.message });
    }
});

app.post("/upload-image", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error("No image file uploaded");
        }
        const imagePath = path.join("uploads", req.file.filename);
        res.json({ imagePath });
    } catch (error) {
        console.error("Image upload error:", error);
        res.status(400).json({ error: error.message });
    }
});

app.post("/gemini", async (req, res) => {
    const { model, contents } = req.body;
    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        console.log("Gemini API request:", { model, contents });

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: contents.map((content) => ({
                    role: content.role === "model" ? "assistant" : content.role,
                    parts: content.parts.map((part) => ({
                        text: part.text,
                    })),
                })),
            }),
        });

        const responseBody = await response.text();
        if (!response.ok) {
            console.error("Gemini API response error:", response.status, responseBody);
            throw new Error(`Gemini API error: ${response.statusText} - ${responseBody}`);
        }

        const data = JSON.parse(responseBody);
        console.log("Gemini API response:", data);
        res.json(data);
    } catch (error) {
        console.error("Gemini API call failed:", error.message);
        res.status(500).json({ error: "Gemini API call failed: " + error.message });
    }
});

app.listen(3001, () => {
    console.log("Server is running on http://localhost:3001");
});