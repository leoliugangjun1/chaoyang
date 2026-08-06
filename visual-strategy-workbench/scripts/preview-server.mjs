import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PREVIEW_PORT || 3002);

const server = createServer(async (req, res) => {
  try {
    const target = req.url === "/" ? "preview.html" : "preview.html";
    const html = await readFile(join(root, target), "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "preview server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Preview server ready: http://127.0.0.1:${port}`);
});
