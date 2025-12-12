# Installation

```
npm install
```

# Usage

Run the three MCP Server

```
node mcp-child-a.js
```

Runs on port 3031

```
node mcp-child-b.js
```

Runs on port 3032

```
node parent.js
```

Runs on port 3030

Then you can use the Streamable HTTP MCP or whatever client you want. You can also try it with inspector:

```
npx -y @modelcontextprotocol/inspector
```

Cursor example MCP configuration:

```json
{
  "mcpServers": {
    "heritage": {
      "url": "http://localhost:3030/mcp",
      "type": "streamableHttp"
    }
  }
}
```

## Author

Ariel Rey - 2025
