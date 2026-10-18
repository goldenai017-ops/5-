// ALTNEX BioLab — Cloudflare Worker backend
// Required secret: GEMINI_API_KEY
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

    if (!env.GEMINI_API_KEY) {
      return json({
        ok: false,
        error: "На сервере ещё не настроен GEMINI_API_KEY. Добавьте API-ключ в Cloudflare Worker → Settings → Variables and Secrets.",
      }, 503, origin);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, error: "Не удалось прочитать параметры запроса." }, 400, origin);
    }

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

    const isKazakh = language.toLowerCase().includes("қазақ");
    const responseLanguage = isKazakh ? "казахском языке" : "русском языке";

    const prompt = `Ты — методический помощник учителя биологии в Казахстане. Подготовь качественные материалы для школьного урока.

ТЕМА: ${topic}
КЛАСС: ${grade || "не указан"}
ЯЗЫК: ${responseLanguage}
ДЛИТЕЛЬНОСТЬ: ${duration || "45 минут"}
ТИП УРОКА: ${lessonType || "изучение и применение темы"}
НУЖНЫЕ МАТЕРИАЛЫ: ${outputs.join(", ")}

Требования:
- Пиши на ${responseLanguage}, грамотно и естественно.
- Учитывай возраст школьников и указанную длительность.
- Сначала дай чёткую цель урока и ожидаемые результаты.
- План урока должен иметь этапы, время, действия учителя и учащихся, оценивание и ресурсы.
- Для презентации дай структуру слайдов и содержательные тезисы, а не только названия.
- Для заданий сформулируй конкретные задания разного уровня сложности.
- Для игры опиши правила, ход и примеры карточек/вопросов.
- Для теста создай 5–8 вопросов с вариантами ответа и отдельным ключом.
- Не выдумывай официальные коды целей обучения, ссылки на учебники или цитаты из программы РК. Если точные официальные формулировки не предоставлены, пометь цели как предварительные и предложи сверить с действующей программой.
- Проверяй биологическую точность. Если в теме есть спорные или меняющиеся сведения, формулируй осторожно.
- Используй заголовки и списки. Не добавляй вступление о том, что ты ИИ.
- Верни только готовый текст материалов, пригодный для отображения на странице.
- Объём — достаточно подробный для реальной подготовки урока, но без повторов и воды.`;

    try {
      const apiResponse = await fetch(
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

      const materials = (result?.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .join("\n")
        .trim();

      if (!materials) {
        return json({ ok: false, error: "Gemini вернул пустой ответ. Попробуйте изменить тему или повторить запрос." }, 502, origin);
      }

      return json({ ok: true, materials }, 200, origin);
    } catch (error) {
      return json({
        ok: false,
        error: "Не удалось связаться с Gemini API. Попробуйте ещё раз позже.",
      }, 502, origin);
    }
  },
};
