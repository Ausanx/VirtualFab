import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.VIRTUALFAB_PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
export async function publicAsset(urlPath) {
  const pathname=decodeURIComponent(urlPath);
  if(pathname.split(/[\\/]/).some(part=>part==='..'||part==='.')||pathname.includes('\\'))return null;
  const allowed=pathname==='/'||pathname==='/index.html'||/^\/src\/[a-z-]+\.(js|css)$/.test(pathname)||/^\/node_modules\/three\/(build|examples\/jsm)\/[a-zA-Z0-9_/.-]+\.js$/.test(pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!allowed||!file.startsWith(root+path.sep))return null;
  return {data:await readFile(file),headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"}};
}
export const server=http.createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const asset=await publicAsset(new URL(req.url,'http://localhost').pathname);
    if(!asset){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,asset.headers);
    res.end(req.method==='HEAD'?undefined:asset.data);
  }catch{res.writeHead(404);res.end('Not found');}
});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(port,'127.0.0.1',()=>console.log(`VirtualFab Studio: http://127.0.0.1:${port}`));
