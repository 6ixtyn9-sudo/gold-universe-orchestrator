#!/usr/bin/env python3
import http.server
import os
import urllib.parse

PORT = 5000
HOST = "0.0.0.0"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/" or path == "":
            self.serve_file("index.html", "text/html")
        elif path.startswith("/doc/"):
            filename = path[5:]
            filepath = os.path.join("doc", filename)
            if os.path.isfile(filepath):
                self.serve_file(filepath, "text/plain; charset=utf-8")
            else:
                self.send_error(404, "File not found")
        else:
            filepath = path.lstrip("/")
            if os.path.isfile(filepath):
                content_type = "text/html" if filepath.endswith(".html") else "text/plain"
                self.serve_file(filepath, content_type)
            else:
                self.send_error(404, "File not found")

    def serve_file(self, filepath, content_type):
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

if __name__ == "__main__":
    print(f"Serving Ma Golide Mothership on http://{HOST}:{PORT}")
    with http.server.HTTPServer((HOST, PORT), Handler) as httpd:
        httpd.serve_forever()
