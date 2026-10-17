export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST-запрос." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "На сервере не задан OPENAI_API_KEY." });
  }

  try {
    const body = req.body || {};
    const topic = String(body.topic || "").trim().slice(0, 160);
    const grade = String(body.grade || "").trim().slice(0, 30);
    const language = String(body.language || "Русский").trim().slice(0, 30);
    const duration = String(body.duration || "45 минут").trim().slice(0, 30);
    const lessonType = String(body.lessonType || "Изучение новой темы").trim().slice(0, 80);
    const allowedOutputs = new Set(["План урока", "Презентация", "Задания", "Интерактивная игра", "Тест с ответами"]);
    const outputs = Array.isArray(body.outputs)
      ? body.outputs.filter((item) => allowedOutputs.has(item))
      : ["План урока", "Презентация", "Задания", "Тест с ответами"];

    if (!topic || !grade || !outputs.length) {
      return res.status(400).json({ error: "Укажите тему, класс и хотя бы один тип материала." });
    }

    const prompt = {
      topic,
      grade,
      language,
      duration,
      lessonType,
      outputs,
      instructions: [
        "Подготовь полезный и предметно корректный черновик урока биологии для школьного учителя.",
        "Отвечай на языке обучения. Если язык обучения Қазақша — весь учебный материал на казахском; если Русский — на русском.",
        "Не выдумывай официальные коды и формулировки целей обучения РК. Цель формулируй как предварительный рабочий вариант.",
        "Учитывай длительность урока; план этапов должен суммироваться до указанной длительности.",
        "Тест должен содержать 5 вопросов и ключ ответов. Задания должны иметь конкретные инструкции.",
        "Для презентации дай 5–7 слайдов с заголовком и краткими тезисами каждого.",
        "Если тема неоднозначна, используй общеизвестные школьные знания и не выдавай неподтверждённые детали за факты.",
        "Верни только JSON-объект с полями objective, plan, slides, tasks, game, quiz, teacherNote. Значения — строки. Не добавляй markdown-разметку."
      ]
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions: "Ты — методический помощник учителя биологии. Соблюдай инструкции пользователя и верни корректный JSON.",
        input: JSON.stringify(prompt),
        text: { format: { type: "json_object" } },
        max_output_tokens: 2600
      })
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.message || "Запрос к модели не выполнен.";
      return res.status(response.status === 429 ? 429 : 502).json({ error: message });
    }

    const outputText = result.output_text;
    if (!outputText) {
      return res.status(502).json({ error: "ИИ вернул пустой ответ. Попробуйте ещё раз." });
    }

    let lesson;
    try {
      lesson = JSON.parse(outputText);
    } catch {
      return res.status(502).json({ error: "Не удалось разобрать ответ ИИ. Попробуйте ещё раз." });
    }

    const safeFields = ["objective", "plan", "slides", "tasks", "game", "quiz", "teacherNote"];
    for (const field of safeFields) {
      lesson[field] = typeof lesson[field] === "string" ? lesson[field].slice(0, 12000) : "";
    }
    return res.status(200).json(lesson);
  } catch (error) {
    return res.status(500).json({ error: "Внутренняя ошибка сервера при подготовке урока." });
  }
}
