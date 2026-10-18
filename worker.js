// ALTNEX BioLab — Cloudflare Worker backend
// Required secrets: GEMINI_API_KEY (games) and ANTHROPIC_API_KEY (KSP)
// Worker name should be: altnex-biolab-api
// Frontend endpoint is configured for:
// https://altnex-biolab-api.goldenai017.workers.dev/

const ALLOWED_ORIGINS = new Set([
  "https://goldenai017-ops.github.io",
]);

const MODEL = "gemini-3.8-flash";
const FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
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

async function requestGemini(apiKey, prompt, sourceImages = []) {
  // Try the primary stable model and fall back if this model is unavailable for the key/project.
  const models = [MODEL, ...FALLBACK_MODELS];
  let lastResult = null;
  let lastResponse = null;
  let lastModel = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 900));
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { text: prompt },
              ...sourceImages.slice(0, 8).flatMap((image, index) => [
                { text: `ВИЗУАЛЬНЫЙ СНИМОК СТРАНИЦЫ УЧЕБНИКА №${image.page || index + 1}. Анализируй изображение, диаграммы, схемы, подписи и иллюстрации на этой странице.` },
                { inline_data: { mime_type: image.mimeType || "image/jpeg", data: image.data } },
              ]),
            ] }],
            generationConfig: {
              temperature: 0.55,
              topP: 0.9,
              maxOutputTokens: 8192,
            },
          }),
        }
      );
      const result = await response.json().catch(() => ({}));
      lastResponse = response;
      lastResult = result;
      lastModel = model;
      if (response.ok) return { response, result, model };

      const status = response.status;
      const message = String(result?.error?.message || "").toLowerCase();
      const modelUnavailable = (status === 404 || status === 400) &&
        /model|not found|not supported|unsupported|not available|does not exist/.test(message);
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (modelUnavailable) break; // try the next model
      if (retryable && attempt === 0) continue;
      if (retryable) break; // move to the next model
      return { response, result, model };
    }
  }
  return { response: lastResponse, result: lastResult, model: lastModel };
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

    const requestedMode = cleanText(input.mode, 20).toLowerCase();
    const isSlides = requestedMode === "slides";
    const mode = requestedMode === "claude" ? "claude" : "gemini";
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
    const outputs = isSlides ? ["Презентация"] : (Array.isArray(input.outputs)
      ? input.outputs.map(value => cleanText(value, 50)).filter(value => allowedOutputs.has(value)).slice(0, 6)
      : []);
    const slideCount = Math.min(15, Math.max(5, Number.parseInt(input.slideCount, 10) || 10));
    const visualStyle = cleanText(input.visualStyle, 40) || "mixed";
    const sourceMaterial = cleanText(input.sourceMaterial, 48000);
    const sourceImages = Array.isArray(input.sourceImages)
      ? input.sourceImages.slice(0, 8).filter(image =>
          image && Number.isFinite(Number(image.page)) &&
          typeof image.data === "string" && image.data.length > 100 &&
          image.data.length <= 900000
        ).map(image => ({
          page: Number(image.page),
          mimeType: image.mimeType === "image/png" ? "image/png" : "image/jpeg",
          data: image.data,
        }))
      : [];

    if (!topic) return json({ ok: false, error: "Укажите тему урока." }, 400, origin);
    if (!outputs.length) return json({ ok: false, error: "Выберите хотя бы один материал." }, 400, origin);
    if (isSlides && !sourceMaterial) return json({ ok: false, error: "Сначала загрузите учебник или другой исходный материал в формате PDF или TXT." }, 400, origin);

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
11. ОФОРМЛЕНИЕ ДОКУМЕНТА: весь текст должен быть рассчитан на Times New Roman, 12 pt. Не вставляй символы Markdown #, ##, ### в заголовки. Используй обычные текстовые заголовки без решёток и декоративных символов.
12. Таблицы должны быть полноценными Markdown-таблицами с ровным количеством столбцов в каждой строке. Не заменяй таблицы списками. Делай заголовки столбцов короткими и понятными, ячейки — содержательными, без длинных абзацев. Не используй таблицы внутри таблиц.
13. Не добавляй звёздочки для выделения (**), обратные кавычки, горизонтальные разделители из дефисов или другие технические Markdown-символы в итоговом тексте. Для выделения используй обычные формулировки и отдельные строки-заголовки.
14. Выведи готовый КСП с понятными заголовками и удобными для печати таблицами. Если дополнительно выбраны другие материалы, вынеси каждый в отдельный раздел.` : `ТРЕБОВАНИЯ К УЧЕБНЫМ МАТЕРИАЛАМ:
- Пиши грамотно и естественно на ${responseLanguage}; учитывай возраст учащихся и биологическую точность.
- Для презентации предложи структуру слайдов: заголовок, короткие тезисы, описание подходящей схемы/иллюстрации и заметки учителю.
- Для заданий указывай инструкцию, ожидаемый ответ и критерий/дескриптор.
- Для теста составь вопросы разных уровней, варианты ответов при необходимости и отдельный ключ ответов.
- Для игры укажи цель, правила, подготовку, ход/раунды, вопросы или задания, правильные ответы и понятную обратную связь.
- Для интерактивной игры предложи пошаговую механику, которую можно реализовать на сайте; не утверждай, что текст сам по себе уже является работающей интерактивной игрой.
- Не выдумывай официальные коды целей обучения, ссылки на учебники, цитаты или нормативные акты.
- Используй понятные заголовки, конкретные задания и минимум вводных фраз.`}

Проверь перед ответом: соответствует ли материал классу, верны ли биологические факты, хватает ли данных для выполнения заданий, нет ли придуманных официальных кодов и совпадает ли время этапов с общей длительностью.`;


    const slidePrompt = `Ты — эксперт по созданию визуально выразительных учебных презентаций по биологии для школьников Казахстана.
Создай презентацию на языке ${responseLanguage}. Верни ТОЛЬКО корректный JSON, без Markdown и без пояснений вокруг JSON.

ТЕМА: ${topic}
КЛАСС: ${grade || "не указан"}
ЯЗЫК: ${responseLanguage}
КОЛИЧЕСТВО СЛАЙДОВ: ровно ${slideCount}
ВИЗУАЛЬНЫЙ СТИЛЬ: ${visualStyle === "photo" ? "реалистичные фотографии, крупные изображения, минимум текста" : visualStyle === "infographic" ? "инфографика, схемы, диаграммы и простые визуальные метафоры" : "сочетание фотографий, схем и инфографики как в современной учебной презентации"}

ОБЯЗАТЕЛЬНЫЙ ИСХОДНЫЙ МАТЕРИАЛ ИЗ ЗАГРУЖЕННЫХ ПОЛЬЗОВАТЕЛЕМ КНИГ:
<source_material>
${sourceMaterial}
</source_material>

СТРОГИЕ ПРАВИЛА РАБОТЫ С ИСТОЧНИКОМ:
- Используй загруженный материал как единственный источник фактов, определений, объяснений и числовых данных для слайдов.
- Не добавляй знания из памяти модели или интернета, если их нет в предоставленном материале. Если в книге не хватает информации, прямо обозначь это в заметках учителю, а не выдумывай.
- Не приписывай книге утверждения, которых в ней нет. Сохраняй смысл терминов и объяснений из учебника.
- У каждого слайда добавь поле sourcePages: массив коротких строк с названиями файла и страницами, откуда взяты основные сведения. Используй только метки [Источник: ...], которые присутствуют в предоставленном тексте. Если точная страница не указана, используй только название файла.
- ОБЯЗАТЕЛЬНО изучи приложенные снимки страниц учебника: анализируй фотографии, рисунки, схемы, графики, таблицы, подписи и их связь с текстом, а не только извлечённый текст.
- Если на снимке страницы есть подходящая иллюстрация, верни sourceImagePage — точный номер PDF-страницы — и imageCrop: рамку вокруг самой иллюстрации в нормализованных координатах 0–1000 (x,y,w,h), отсчитываемых от левого верхнего угла всего снимка страницы. Обрежь основной текст и поля, оставь небольшой отступ вокруг изображения.
- Если подходящей иллюстрации нет, верни sourceImagePage: null и imageCrop: null. Не выдумывай номера страниц или координаты; номер должен совпадать с подписью перед снимком.
- imageQuery используй как резервный поиск фотографии, если подходящего изображения в книге нет. Не выдавай найденную фотографию за изображение из книги.

Верни JSON такой структуры:
{
  "title": "Краткое название презентации",
  "subtitle": "Одна короткая фраза о теме",
  "slides": [
    {
      "title": "Заголовок слайда",
      "bullets": ["Короткий тезис", "Короткий тезис", "Короткий тезис"],
      "imageQuery": "specific English keywords for a relevant Wikimedia Commons educational photograph if needed",
      "sourceImagePage": null,
      "imageCrop": null,
      "visual": "Краткое описание схемы или визуального акцента на русском языке",
      "speakerNotes": "Короткие заметки учителю для объяснения",
      "sourcePages": ["имя файла, страница/страницы из предоставленных меток источника"]
    }
  ]
}

Правила:
- Верни ровно ${slideCount} слайдов, включая титульный и заключительный.
- На каждом слайде максимум 3–4 коротких тезиса, каждый до 18 слов. Не перегружай слайды текстом.
- Для каждого слайда укажи imageQuery на английском языке, конкретный и пригодный для поиска реальной фотографии или научной иллюстрации. Не используй абстрактные запросы.
- Первый слайд — выразительная обложка с темой и кратким подзаголовком; последний — выводы или вопрос для обсуждения.
- Соблюдай биологическую точность и возрастную уместность. Не придумывай факты, статистику или источники.
- Содержимое JSON должно быть валидным: двойные кавычки, без trailing commas, без Markdown-обрамления.
- Не добавляй поля кроме title, subtitle, slides и полей каждого слайда, указанных в примере.`;
    const finalPrompt = isSlides ? slidePrompt : prompt;

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
        const gemini = await requestGemini(env.GEMINI_API_KEY, finalPrompt, isSlides ? sourceImages : []);
        apiResponse = gemini.response;
        const result = gemini.result || {};
        if (!apiResponse?.ok) {
          const message = result?.error?.message || "Gemini API не вернул подробности ошибки.";
          return json({ ok: false, error: `Ошибка Gemini API (HTTP ${apiResponse?.status || "неизвестно"}, модель ${gemini.model || "не определена"}): ${message} Проверьте Secret GEMINI_API_KEY, доступ к API и лимиты проекта Google AI Studio.` }, 502, origin);
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
