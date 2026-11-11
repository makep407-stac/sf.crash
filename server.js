const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const MIME = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
const server = http.createServer((req,res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, {"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
    return res.end(JSON.stringify({ok:true,service:"darna-social",version:"1.0.0"}));
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(ROOT, "." + pathname);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file,(err,data) => {
    if (err) { res.writeHead(404,{"content-type":"text/plain; charset=utf-8"}); return res.end("Not found"); }
    res.writeHead(200,{"content-type":MIME[path.extname(file)] || "application/octet-stream","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin"});
    res.end(data);
  });
});
server.listen(PORT,"0.0.0.0",()=>console.log("DARNA listening on "+PORT));
