import { config } from 'dotenv';
import readline from 'readline/promises';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch';

config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let tools = [];
const chatHistory = [];
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function initialize() {
    try {
        const response = await fetch("http://localhost:3001/tools");
        if (response.ok) {
            tools = await response.json();
            console.log("Connected to MCP server. Tools:", tools.map(t => t.name));
        } else {
            throw new Error(`Failed to fetch tools: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error fetching tools:", error);
        tools = [
            {
                name: "addTwoNumbers",
                description: "Add two numbers",
                parameters: {
                    type: "object",
                    properties: {
                        a: { type: "number" },
                        b: { type: "number" },
                    },
                    required: ["a", "b"],
                },
            },
            {
                name: "createPost",
                description: "Create a post on X",
                parameters: {
                    type: "object",
                    properties: {
                        status: { type: "string" },
                        imagePath: { type: "string" },
                    },
                },
            },
        ];
        console.log("Using default tools:", tools.map(t => t.name));
    }

    chatLoop();
}

async function chatLoop() {
    const question = await rl.question('You: ');
    chatHistory.push({
        role: "user",
        parts: [{ text: question }],
    });

    const lowerQuestion = question.toLowerCase();
    if (lowerQuestion.includes("add") && lowerQuestion.match(/\d+\s*and\s*\d+/)) {
        const numbers = lowerQuestion.match(/\d+/g).map(Number);
        if (numbers.length >= 2) {
            try {
                const result = await callTool("addTwoNumbers", { a: numbers[0], b: numbers[1] });
                console.log(`Tool result: ${result.content[0].text}`);
                chatHistory.push({
                    role: "assistant",
                    parts: [{ text: result.content[0].text }],
                });
            } catch (error) {
                console.error(`Tool call failed: ${error.message}`);
                chatHistory.push({
                    role: "assistant",
                    parts: [{ text: `Tool call failed: ${error.message}` }],
                });
            }
            return chatLoop();
        }
    } else if (
        (lowerQuestion.includes("post") || lowerQuestion.includes("create")) &&
        lowerQuestion.includes("on x")
    ) {
        const statusMatch = lowerQuestion.match(/write\s+(.+)/i) || 
                           lowerQuestion.match(/post\s+(.+)\s+on\s+x/i) || 
                           lowerQuestion.match(/create\s+(?:a\s+)?post\s+on\s+x\s+(?:and\s+)?write\s+(.+)/i);
        const imageMatch = lowerQuestion.match(/with\s+image\s+(.+)\s+on\s+x/i);
        const statusText = statusMatch && statusMatch[1] ? statusMatch[1].trim() : null;
        const imagePath = imageMatch && imageMatch[1] ? imageMatch[1].trim() : null;

        if (statusText || imagePath) {
            try {
                const args = {};
                if (statusText) args.status = statusText;
                if (imagePath) args.imagePath = imagePath;
                const result = await callTool("createPost", args);
                console.log(`Tool result: ${result.content[0].text}`);
                chatHistory.push({
                    role: "assistant",
                    parts: [{ text: result.content[0].text }],
                });
            } catch (error) {
                console.error(`Tool call failed: ${error.message}`);
                chatHistory.push({
                    role: "assistant",
                    parts: [{ text: `Tool call failed: ${error.message}` }],
                });
            }
        } else {
            console.error("Invalid post format. Please specify a message or image, e.g., 'write [message]' or 'post with image [path] on X'.");
            chatHistory.push({
                role: "assistant",
                parts: [{ text: "Invalid post format. Please specify a message or image, e.g., 'write [message]' or 'post with image [path] on X'." }],
            });
        }
        return chatLoop();
    } else if (lowerQuestion.includes("tools available")) {
        const toolNames = tools.map(tool => tool.name).join(", ");
        const responseText = `I have ${tools.length} tools available: ${toolNames}`;
        console.log(`AI: ${responseText}`);
        chatHistory.push({
            role: "assistant",
            parts: [{ text: responseText }],
        });
        return chatLoop();
    }

    try {
        const result = await model.generateContent({
            contents: chatHistory,
        });
        const responseText = result.response.candidates[0].content.parts[0].text;
        console.log(`AI: ${responseText}`);
        chatHistory.push({
            role: "assistant",
            parts: [{ text: responseText }],
        });
    } catch (error) {
        console.error("Gemini API error:", error);
        chatHistory.push({
            role: "assistant",
            parts: [{ text: `Error: ${error.message}` }],
        });
    }

    chatLoop();
}

async function callTool(name, args) {
    console.log("Calling tool:", { name, args });
    const response = await fetch("http://localhost:3001/call-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arguments: args }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tool call error: ${response.statusText} - ${errorText}`);
    }
    return await response.json();
}

initialize();