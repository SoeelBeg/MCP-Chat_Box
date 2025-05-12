let chatHistory = [];
let tools = [];

const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const imageInput = document.getElementById("image-input");
const status = document.getElementById("status");
const loading = document.getElementById("loading");

const eventSource = new EventSource("http://localhost:3001/sse");

eventSource.onopen = () => {
    status.textContent = "Connected to MCP server";
    fetchTools();
};

eventSource.onerror = (error) => {
    status.textContent = "Connection error. Retrying...";
    console.error("SSE error:", error);
};

eventSource.onmessage = (event) => {
    console.log("SSE message:", event.data);
};

async function fetchTools(attempt = 1, maxAttempts = 3) {
    try {
        const response = await fetch("http://localhost:3001/tools");
        if (response.ok) {
            tools = await response.json();
            console.log("Tools fetched successfully:", tools);
        } else {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error(`Attempt ${attempt} failed to fetch tools:`, error);
        if (attempt < maxAttempts) {
            console.log(`Retrying... (${attempt + 1}/${maxAttempts})`);
            return fetchTools(attempt + 1, maxAttempts);
        }
        status.textContent = "Error fetching tools. Using default tools.";
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
    }
}

function sendMessage() {
    const message = userInput.value.trim();
    const imageFile = imageInput.files[0];
    if (!message && !imageFile) return;

    addMessage("user", message || "Uploading image...");
    chatHistory.push({
        role: "user",
        parts: [{ text: message || "Image post" }],
    });

    userInput.value = "";
    imageInput.value = "";
    processMessage(message, imageFile);
}

userInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
});

function addMessage(role, text) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${role}`;
    messageDiv.textContent = text;
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function processMessage(message, imageFile) {
    loading.classList.remove("hidden");

    // Handle tool-related queries
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("add") && lowerMessage.match(/\d+\s*and\s*\d+/)) {
        // Handle addTwoNumbers
        const numbers = lowerMessage.match(/\d+/g).map(Number);
        if (numbers.length >= 2) {
            try {
                const result = await callTool("addTwoNumbers", { a: numbers[0], b: numbers[1] });
                addMessage("tool", `Tool result: ${result.content[0].text}`);
                chatHistory.push({
                    role: "model",
                    parts: [{ text: result.content[0].text }],
                });
                loading.classList.add("hidden");
                status.textContent = "Connected to MCP server";
                return;
            } catch (error) {
                addMessage("error", `Tool call failed: ${error.message}`);
                loading.classList.add("hidden");
                return;
            }
        }
    } else if (
        lowerMessage.includes("write") ||
        lowerMessage.includes("post") ||
        lowerMessage.includes("create") ||
        imageFile
    ) {
        // Handle createPost
        const statusMatch = lowerMessage.match(/write\s+(.+)/i) ||
                           lowerMessage.match(/post\s+(.+)(?:\s+with\s+image\s+.*)?\s+on\s+x/i) ||
                           lowerMessage.match(/create\s+(?:a\s+)?post\s+on\s+x\s+(?:and\s+)?write\s+(.+)/i);
        const imageMatch = lowerMessage.match(/with\s+image\s+(.+)\s+on\s+x/i);
        let statusText = statusMatch && statusMatch[1] ? statusMatch[1].trim() : (message.trim() || null);
        let imagePath = imageMatch && imageMatch[1] ? imageMatch[1].trim() : null;

        if (imageFile) {
            try {
                const formData = new FormData();
                formData.append("image", imageFile);
                const uploadResponse = await fetch("http://localhost:3001/upload-image", {
                    method: "POST",
                    body: formData,
                });
                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text();
                    throw new Error(`Image upload failed: ${errorText}`);
                }
                const uploadData = await uploadResponse.json();
                imagePath = uploadData.imagePath;
            } catch (error) {
                addMessage("error", `Image upload failed: ${error.message}`);
                loading.classList.add("hidden");
                return;
            }
        }

        if (statusText || imagePath) {
            try {
                const args = {};
                if (statusText) args.status = statusText;
                if (imagePath) args.imagePath = imagePath;
                const result = await callTool("createPost", args);
                addMessage("tool", `Tool result: ${result.content[0].text}`);
                chatHistory.push({
                    role: "model",
                    parts: [{ text: result.content[0].text }],
                });
                loading.classList.add("hidden");
                status.textContent = "Connected to MCP server";
                return;
            } catch (error) {
                addMessage("error", `Tool call failed: ${error.message}`);
                loading.classList.add("hidden");
                return;
            }
        } else {
            addMessage("error", "Invalid post format. Please specify a message or image, e.g., 'write [message]' or select an image.");
            loading.classList.add("hidden");
            return;
        }
    } else if (lowerMessage.includes("tools available")) {
        // Handle tool list query
        const toolNames = tools.map(tool => tool.name).join(", ");
        const responseText = `I have ${tools.length} tools available: ${toolNames}`;
        addMessage("ai", responseText);
        chatHistory.push({
            role: "model",
            parts: [{ text: responseText }],
        });
        loading.classList.add("hidden");
        status.textContent = "Connected to MCP server";
        return;
    }

    // Fallback to Gemini API for non-tool queries
    try {
        status.textContent = "Waiting for AI response...";
        const response = await fetch("http://localhost:3001/gemini", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gemini-1.5-flash",
                contents: chatHistory,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        console.log("Gemini response:", data);

        const candidate = data.candidates?.[0]?.content?.parts?.[0];
        if (!candidate) {
            throw new Error("Invalid response format from Gemini API");
        }

        const responseText = candidate.text;

        status.textContent = "Connected to MCP server";
        loading.classList.add("hidden");

        if (responseText) {
            addMessage("ai", responseText);
            chatHistory.push({
                role: "model",
                parts: [{ text: responseText }],
            });
        } else {
            addMessage("error", "No response from AI.");
        }
    } catch (error) {
        status.textContent = "Error connecting to AI service";
        addMessage("error", `Error: ${error.message}`);
        console.error("Gemini error:", error);
        loading.classList.add("hidden");
    }
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