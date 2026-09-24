import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.VIRTUALFAB_PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
export const server=http.createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);
    if(pathname.split(/[\\/]/).some(part=>part==='..'||part==='.')||pathname.includes('\\')){res.writeHead(404);res.end('Not found');return;}
    // Only public assets are exposed; project documents and local files stay private.
    const allowed=pathname==='/'||pathname==='/index.html'||/^\/src\/[a-z-]+\.(js|css)$/.test(pathname)||/^\/node_modules\/three\/(build|examples\/jsm)\/[a-zA-Z0-9_/.-]+\.js$/.test(pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!allowed||!file.startsWith(root+path.sep)){res.writeHead(404);res.end('Not found');return;}
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(port,'127.0.0.1',()=>console.log(`VirtualFab Studio: http://127.0.0.1:${port}`));
