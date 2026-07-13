import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 5173);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const relativePath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const filePath = resolve(root, `.${relativePath}`);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new Error("Invalid path");
    }

    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a file");
    const extension = extname(filePath).toLowerCase();
    const isAppCode = [".html", ".js", ".css"].includes(extension);

    response.writeHead(200, {
      "Cache-Control": isAppCode ? "no-store, no-cache, must-revalidate" : "no-cache",
      "Content-Length": file.size,
      "Content-Type": contentTypes.get(extension) || "application/octet-stream",
      Expires: "0",
      Pragma: "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`Boggle Solver OCR build ocr22: http://localhost:${port}`);
});
