// ALTNEX BioLab — Cloudflare Worker backend
// Required secrets: GEMINI_API_KEY (games) and ANTHROPIC_API_KEY (KSP)
// Worker name should be: altnex-biolab-api
// Frontend endpoint is configured for:
// https://altnex-biolab-api.goldenai017.workers.dev/

const ALLOWED_ORIGINS = new Set([
  "https://goldenai017-ops.github.io",
]);

const MODEL = "gemini-3.8-flash";
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

    const isKsp = outputs.includes("План урока");
    const prompt = `Ты — опытный методист по биологии и помощник учителя общеобразовательной школы Республики Казахстан.
Создавай точные, практически применимые материалы на языке ${responseLanguage}.

ТЕМА: ${topic}
КЛАСС: ${grade || "не указан"}
ПРЕДМЕТ: Биология
ЯЗЫК: ${responseLanguage}
ДЛИТЕЛЬНОСТЬ УРОКА: ${duration || "45 минут"}
ТИП УРОКА: ${lessonType || "не указан"}
ЗАПРОШЕННЫЕ МАТЕРИАЛЫ: ${outputs.join(", ")}

${isKsp ? `ОСОБЫЕ ТРЕБОВАНИЯ К КСП:
1. Составь полноценный краткосрочный план урока по практике школ Казахстана, а не общий конспект.
2. СРАЗУ В НАЧАЛЕ КСП оформи отдельную таблицу «Сабақ туралы жалпы мәлімет» / «Общая информация об уроке» с двумя столбцами: «Параметр» и «Содержание». Обязательно включи отдельные строки: пәні/предмет; сынып/класс; сабақтың тақырыбы/тема урока; оқу бағдарламасына сәйкес оқыту мақсаттары/цели обучения в соответствии с учебной программой; сабақтың мақсаты/цель урока; бағалау критерийлері/критерии оценивания; күтілетін нәтижелер/ожидаемые результаты; сабақтың түрі/тип урока; сабақтың ұзақтығы/продолжительность. Заполняй таблицу на выбранном языке. Цель обучения указывай точно только при наличии достоверной формулировки для данного класса и темы; иначе честно напиши, что официальную формулировку и код нужно уточнить по действующей программе, а рабочую цель урока приведи отдельно. Не пропускай строки и не заменяй таблицу списком.
3. Цели обучения: не выдумывай коды и официальные формулировки типовой учебной программы РК. Если учитель не указал код/формулировку и у тебя нет уверенности, напиши: «Цель обучения — уточнить по действующей учебной программе» и предложи отдельно рабочую цель урока. Не выдавай предположение за официальную цель.
4. Основной план оформи таблицей со столбцами: этап урока и время; действия учителя; действия учащихся; оценивание и конкретные дескрипторы; ресурсы.
5. Распредели время между этапами так, чтобы сумма точно равнялась ${duration || "45 минут"}. Включи начало/актуализацию, объяснение или исследование нового материала, практическую работу, закрепление и рефлексию. Не добавляй этапы, которые не помещаются во время.
6. Дай реальные задания по биологии для указанного класса, с ясными инструкциями и ожидаемыми ответами/ключами там, где это уместно.
7. Добавь формативное оценивание, дифференциацию (поддержка, базовый уровень, усложнение), необходимые ресурсы, рефлексию и домашнее задание.
8. Критерии и дескрипторы должны быть наблюдаемыми и проверяемыми; избегай формулировок вроде «активно работает» без конкретного действия.
9. Соблюдай биологическую точность, возрастную уместность, доступность для разных учеников и естественный язык.
10. Не выдумывай номера приказов, нормативные ссылки, страницы учебников, источники и официальные требования. Не используй пустые фразы и повторы.
11. Выведи готовый КСП с понятными заголовками и удобной для копирования таблицей. Если дополнительно выбраны другие материалы, вынеси каждый в отдельный раздел.` : `ТРЕБОВАНИЯ К УЧЕБНЫМ МАТЕРИАЛАМ:
- Пиши грамотно и естественно на ${responseLanguage}; учитывай возраст учащихся и биологическую точность.
- Для презентации предложи структуру слайдов: заголовок, короткие тезисы, описание подходящей схемы/иллюстрации и заметки учителю.
- Для заданий указывай инструкцию, ожидаемый ответ и критерий/дескриптор.
- Для теста составь вопросы разных уровней, варианты ответов при необходимости и отдельный ключ ответов.
- Для игры укажи цель, правила, подготовку, ход/раунды, вопросы или задания, правильные ответы и понятную обратную связь.
- Для интерактивной игры предложи пошаговую механику, которую можно реализовать на сайте; не утверждай, что текст сам по себе уже является работающей интерактивной игрой.
- Не выдумывай официальные коды целей обучения, ссылки на учебники, цитаты или нормативные акты.
- Используй понятные заголовки, конкретные задания и минимум вводных фраз.`}

Проверь перед ответом: соответствует ли материал классу, верны ли биологические факты, хватает ли данных для выполнения заданий, нет ли придуманных официальных кодов и совпадает ли время этапов с общей длительностью.`;

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
