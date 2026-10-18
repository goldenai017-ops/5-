// ALTNEX BioLab — Cloudflare Worker backend
// Required secrets: GEMINI_API_KEY (games) and ANTHROPIC_API_KEY (KSP)
// Worker name should be: altnex-biolab-api
// Frontend endpoint is configured for:
// https://altnex-biolab-api.goldenai017.workers.dev/

const ALLOWED_ORIGINS = new Set([
  "https://goldenai017-ops.github.io",
]);

const MODEL = "gemini-2.5-flash";
const MAX_TOPIC_LENGTH = 180;

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://goldenai017-ops.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Используйте POST-запрос." }, 405, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ ok: false, error: "Запрос с этого сайта не разрешён." }, 403, origin);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, error: "Не удалось прочитать параметры запроса." }, 400, origin);
    }

    const mode = cleanText(input.mode, 20).toLowerCase() === "claude" ? "claude" : "gemini";
    const topic = cleanText(input.topic, MAX_TOPIC_LENGTH);
    const grade = cleanText(input.grade, 30);
    const language = cleanText(input.language, 30);
    const duration = cleanText(input.duration, 30);
    const lessonType = cleanText(input.lessonType, 80);
    const allowedOutputs = new Set([
      "План урока",
      "Презентация",
      "Задания",
      "Игра",
      "Интерактивная игра",
      "Тест с ответами",
    ]);
    const outputs = Array.isArray(input.outputs)
      ? input.outputs.map(value => cleanText(value, 50)).filter(value => allowedOutputs.has(value)).slice(0, 6)
      : [];

    if (!topic) return json({ ok: false, error: "Укажите тему урока." }, 400, origin);
    if (!outputs.length) return json({ ok: false, error: "Выберите хотя бы один материал." }, 400, origin);

    if (mode === "claude" && !env.ANTHROPIC_API_KEY) {
      return json({
        ok: false,
        error: "Claude пока не подключён: добавьте ANTHROPIC_API_KEY как Secret в Cloudflare Worker → Settings → Variables and Secrets.",
      }, 503, origin);
    }
    if (mode === "gemini" && !env.GEMINI_API_KEY) {
      return json({
        ok: false,
        error: "На сервере не настроен GEMINI_API_KEY. Добавьте его как Secret в Cloudflare Worker → Settings → Variables and Secrets.",
      }, 503, origin);
    }

    const isKazakh = language.toLowerCase().includes("қазақ");
    const responseLanguage = isKazakh ? "казахском языке" : "русском языке";

    const prompt = mode === "claude" ? `Ты — опытный методист и разработчик краткосрочных планов урока (КСП) для школ Казахстана.
Подготовь содержательный, практичный и аккуратно структурированный КСП.

ТЕМА: ${topic}
КЛАСС: ${grade || "не указан"}
ПРЕДМЕТ: Биология
ЯЗЫК: ${responseLanguage}
ДЛИТЕЛЬНОСТЬ: ${duration || "45 минут"}
ТИП УРОКА: ${lessonType || "изучение новой темы"}
ЗАПРОШЕННЫЕ МАТЕРИАЛЫ: ${outputs.join(", ")}

ОБЯЗАТЕЛЬНО:
- Сформулируй тему, предварительную цель урока и ожидаемые результаты обучения.
- Не выдумывай официальные коды и дословные формулировки целей обучения РК. Если учитель не предоставил цель программы, явно пометь её как рабочий вариант для проверки.
- Основная часть КСП должна быть таблицей со столбцами: этап/время, действия учителя, действия учащихся, оценивание/дескрипторы, ресурсы.
- Сумма времени этапов должна равняться ${duration || "45 минут"}.
- Добавь дифференциацию, поддержку учащихся с разными потребностями, формативное оценивание, рефлексию и домашнее задание.
- Для каждого задания дай понятную инструкцию и конкретные дескрипторы.
- Пиши на ${responseLanguage}; учитывай возраст класса и биологическую точность.
- Не используй пустые общие фразы, дублирование и вымышленные источники.
- Верни готовый КСП с заголовками и таблицей, пригодный для редактирования и переноса в документ.`
      : `Ты — методический помощник учителя биологии в Казахстане. Подготовь качественные материалы для школьного урока.

ТЕМА: ${topic}
КЛАСС: ${grade || "не указан"}
ЯЗЫК: ${responseLanguage}
ДЛИТЕЛЬНОСТЬ: ${duration || "45 минут"}
ТИП УРОКА: ${lessonType || "изучение и применение темы"}
НУЖНЫЕ МАТЕРИАЛЫ: ${outputs.join(", ")}

Требования:
- Пиши на ${responseLanguage}, грамотно и естественно.
- Для режима игры создавай игровую механику: правила, раунды, задания/вопросы, варианты ответов, правильные ответы и обратную связь для игрока.
- Учитывай возраст школьников и биологическую точность.
- Не выдумывай официальные коды целей обучения, ссылки на учебники или цитаты из программы РК.
- Используй понятные заголовки и списки без вступления о том, что ты ИИ.
- Верни готовый текст материалов без повторов и воды.`;

    try {
      let apiResponse;
      let materials = "";

      if (mode === "claude") {
        apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-5-5",
            max_tokens: 8192,
            temperature: 0.4,
            system: "Ты — опытный методист школ Казахстана. Соблюдай структуру КСП, проверяй точность предметного содержания и не выдумывай официальные цели обучения.",
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const result = await apiResponse.json().catch(() => ({}));
        if (!apiResponse.ok) {
          const message = result?.error?.message || "Проверьте API-ключ Claude и доступ к модели.";
          return json({ ok: false, error: `Ошибка Claude API: ${message}` }, 502, origin);
        }
        materials = (result?.content || [])
          .filter(block => block.type === "text")
          .map(block => block.text || "")
          .join("\n")
          .trim();
        if (!materials) {
          return json({ ok: false, error: "Claude вернул пустой ответ. Попробуйте изменить тему." }, 502, origin);
        }
      } else {
        apiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.55,
                topP: 0.9,
                maxOutputTokens: 8192,
              },
            }),
          }
        );
        const result = await apiResponse.json().catch(() => ({}));
        if (!apiResponse.ok) {
          const message = result?.error?.message || "Проверьте API-ключ Gemini и доступность модели.";
          return json({ ok: false, error: `Ошибка Gemini API: ${message}` }, 502, origin);
        }
        materials = (result?.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || "")
          .join("\n")
          .trim();
        if (!materials) {
          return json({ ok: false, error: "Gemini вернул пустой ответ. Попробуйте изменить тему или повторить запрос." }, 502, origin);
        }
      }

      return json({ ok: true, materials, provider: mode === "claude" ? "Claude" : "Gemini" }, 200, origin);
    } catch (error) {
      return json({
        ok: false,
        error: "Не удалось связаться с Gemini API. Попробуйте ещё раз позже.",
      }, 502, origin);
    }
  },
};
