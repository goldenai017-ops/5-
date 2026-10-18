/**
 * BioLab shared textbook library — Cloudflare Worker
 *
 * Bind an R2 bucket as BOOKS and add the secret LIBRARY_ADMIN_TOKEN.
 * Public: GET /books, GET /books/:key
 * Admin only: POST /books (multipart: file, grade), DELETE /books/:key
 */
const MAX_FILE_SIZE = 45 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/octet-stream"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function safeName(value) {
  return String(value || "учебник")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "учебник";
}

function isAdmin(request, env) {
  const expected = env.LIBRARY_ADMIN_TOKEN;
  const supplied = request.headers.get("X-Admin-Token") || "";
  return Boolean(expected && supplied && supplied === expected);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!env.BOOKS) return json({ ok: false, error: "R2 bucket binding BOOKS is not configured." }, 500, origin);

    if (url.pathname === "/books" && request.method === "GET") {
      const page = await env.BOOKS.list({ limit: 1000 });
      const books = page.objects.map(object => ({
        key: object.key,
        name: object.customMetadata?.name || object.key.split("/").pop(),
        grade: Number(object.customMetadata?.grade || 0),
        size: object.size,
        uploadedAt: object.uploaded?.toISOString?.() || null,
        contentType: object.httpMetadata?.contentType || "application/octet-stream"
      })).sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name, "ru"));
      return json({ ok: true, books, truncated: page.truncated }, 200, origin);
    }

    if (url.pathname.startsWith("/books/")) {
      const key = decodeURIComponent(url.pathname.slice("/books/".length));
      if (!key || key.includes("..") || key.startsWith("/")) return json({ ok: false, error: "Invalid book key." }, 400, origin);

      if (request.method === "GET") {
        const object = await env.BOOKS.get(key);
        if (!object) return json({ ok: false, error: "Книга не найдена." }, 404, origin);
        const headers = new Headers(corsHeaders(origin));
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
        headers.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(object.customMetadata?.name || "textbook"));
        headers.set("Cache-Control", "public, max-age=300");
        return new Response(object.body, { headers });
      }

      if (request.method === "DELETE") {
        if (!isAdmin(request, env)) return json({ ok: false, error: "Требуется право администратора." }, 401, origin);
        await env.BOOKS.delete(key);
        return json({ ok: true }, 200, origin);
      }
    }

    if (url.pathname === "/books" && request.method === "POST") {
      if (!isAdmin(request, env)) return json({ ok: false, error: "Требуется право администратора." }, 401, origin);
      let form;
      try { form = await request.formData(); }
      catch { return json({ ok: false, error: "Не удалось прочитать загружаемый файл." }, 400, origin); }

      const file = form.get("file");
      const grade = Number(form.get("grade"));
      if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, error: "Выберите PDF или TXT." }, 400, origin);
      if (![5, 6, 7, 8, 9, 10, 11].includes(grade)) return json({ ok: false, error: "Выберите класс с 5-го по 11-й." }, 400, origin);
      if (!file.size || file.size > MAX_FILE_SIZE) return json({ ok: false, error: "Размер файла должен быть не больше 45 МБ." }, 413, origin);

      const name = safeName(file.name);
      const extension = name.toLowerCase().split(".").pop();
      if (!["pdf", "txt"].includes(extension)) return json({ ok: false, error: "Поддерживаются только PDF и TXT." }, 415, origin);
      const contentType = extension === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
      const key = "grade-" + grade + "/" + crypto.randomUUID() + "/" + name;
      await env.BOOKS.put(key, file.stream(), {
        httpMetadata: { contentType },
        customMetadata: { name, grade: String(grade), uploadedBy: "BioLab admin" }
      });
      return json({ ok: true, book: { key, name, grade, size: file.size, contentType } }, 201, origin);
    }

    return json({ ok: false, error: "Маршрут не найден." }, 404, origin);
  }
};
