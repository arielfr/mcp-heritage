import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const config = {
    "name": "mcp-child-b-http",
    "version": "1.0.0",
    "port": 3032
};

const server = new McpServer({
    name: config.name,
    version: config.version,
});

server.registerTool("name-age", {
    description: "Predict the age of a person given a name",
    inputSchema: {
        name: z.string()
    }
}, async ({ name }) => {
    const response = await fetch(`https://api.agify.io/?name=${name}`)
    .then(response => response.json())
    .catch(error => {
        console.error("Error fetching age:", error);
        return {error: error.message };
    });
    
    return {
        content: [
            {
                type: "text",
                text: `${response.age}`
            }
        ]
    };
});

const app = createMcpExpressApp();
const port = config.port;
const path = "/mcp";

app.post(path, async (req, res) => {
    const acceptsSSE = req.headers.accept?.includes('text/event-stream');
    
    try {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // Stateless mode
            enableJsonResponse: !acceptsSSE // Use JSON response if client doesn't accept SSE
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            transport.close();
            server.close();
        });
    } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error'
                },
                id: null
            });
        }
    }
});

app.listen(port, (error) => {
    if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log(`Child A HTTP MCP listo en http://127.0.0.1:${port}${path}`);
});