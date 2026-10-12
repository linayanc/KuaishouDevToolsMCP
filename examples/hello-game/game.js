// Intentional diagnostic messages; no network access.
const canvas = ks.createCanvas();
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#121827';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#ff9d27';
ctx.font = '20px sans-serif';
ctx.fillText('Kuaishou MCP: connected', 20, 70);
console.log('[kuaishou-mcp-demo] game started');
console.warn('[kuaishou-mcp-demo] example warning');
console.error('[kuaishou-mcp-demo] example error (intentional)');
let tick = 0;
setInterval(() => console.log('[kuaishou-mcp-demo] tick', ++tick), 5000);
setTimeout(() => { throw new Error('[kuaishou-mcp-demo] example exception (intentional)'); }, 3000);
