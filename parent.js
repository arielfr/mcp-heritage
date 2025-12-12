import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

/**
 * Converts a JSON Schema property definition to a Zod schema
 */
function jsonSchemaPropertyToZod(propertySchema) {
    if (!propertySchema || typeof propertySchema !== 'object') {
        return z.any();
    }

    const type = propertySchema.type;
    
    // Handle multiple types (array of types)
    if (Array.isArray(type)) {
        // If one of the types is null, make it nullable
        if (type.includes('null')) {
            const nonNullTypes = type.filter(t => t !== 'null');
            if (nonNullTypes.length === 1) {
                return jsonSchemaPropertyToZod({ ...propertySchema, type: nonNullTypes[0] }).nullable();
            }
        }
        // For multiple non-null types, use union (simplified - just use first type)
        return jsonSchemaPropertyToZod({ ...propertySchema, type: type[0] });
    }

    let zodSchema;

    switch (type) {
        case 'string':
            zodSchema = z.string();
            if (propertySchema.enum && Array.isArray(propertySchema.enum)) {
                // z.enum requires a tuple, so we need to cast the array
                zodSchema = z.enum(propertySchema.enum);
            }
            break;
        case 'number':
        case 'integer':
            zodSchema = z.number();
            if (type === 'integer') {
                zodSchema = z.number().int();
            }
            break;
        case 'boolean':
            zodSchema = z.boolean();
            break;
        case 'array':
            zodSchema = propertySchema.items
                ? z.array(jsonSchemaPropertyToZod(propertySchema.items))
                : z.array(z.any());
            break;
        case 'object':
            if (propertySchema.properties) {
                const shape = {};
                for (const [key, value] of Object.entries(propertySchema.properties)) {
                    shape[key] = jsonSchemaPropertyToZod(value);
                }
                zodSchema = z.object(shape);
            } else {
                zodSchema = z.record(z.any());
            }
            break;
        case 'null':
            zodSchema = z.null();
            break;
        default:
            zodSchema = z.any();
    }

    // Handle nullable
    if (propertySchema.type !== 'null' && (propertySchema.nullable === true || (Array.isArray(propertySchema.type) && propertySchema.type.includes('null')))) {
        zodSchema = zodSchema.nullable();
    }

    return zodSchema;
}

/**
 * Converts a JSON Schema inputSchema to a Zod schema compatible with registerTool
 */
function jsonSchemaToZodSchema(jsonSchema) {
    if (!jsonSchema || jsonSchema.type !== 'object') {
        // If not an object schema, return a passthrough schema
        return z.record(z.any());
    }

    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];
    
    const shape = {};
    for (const [key, propertySchema] of Object.entries(properties)) {
        let zodProperty = jsonSchemaPropertyToZod(propertySchema);
        
        // Make optional if not in required array
        if (!required.includes(key)) {
            zodProperty = zodProperty.optional();
        }
        
        shape[key] = zodProperty;
    }

    // If no properties, return a passthrough schema
    if (Object.keys(shape).length === 0) {
        return z.record(z.any());
    }

    return shape;
}

const config = {
    "name": "mcp-parent-http",
    "version": "1.0.0",
    "port": 3030,
    "childrenConfig": [
        {
            id: "mcp-child-a-http",
            url: "http://127.0.0.1:3031/mcp"
        },
        {
            id: "mcp-child-b-http",
            url: "http://127.0.0.1:3032/mcp"
        }
    ]
};

async function connectChildHttp(config) {
    const transport = new StreamableHTTPClientTransport(config.url);
    
    const client = new Client({
        name: config.id,
        version: "1.0.0",
    });

    await client.connect(transport);

    return client;
}

async function main() {
    const server = new McpServer({
        name: config.name,
        version: config.version,
    });
    
    for (const cfg of config.childrenConfig) {
        const client = await connectChildHttp(cfg);
        
        const { tools } = await client.listTools();
        
        for (const tool of tools) {
            // Convert JSON Schema from client to Zod schema
            const zodSchema = jsonSchemaToZodSchema(tool.inputSchema);
            
            server.registerTool(tool.name, {
                description: tool.description ?? '',
                inputSchema: zodSchema
            }, async (args) => {
                console.log(args)
                return await client.callTool({
                    name: tool.name,
                    arguments: args ?? {}
                });
            });
        }
    }
    
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
}

await main();