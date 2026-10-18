# ALTNEX LABS

**ALTNEX LABS** — цифровая образовательная лаборатория, объединяющая науку, технологии и интерактивное обучение.

## Первый этап
Главная страница проекта с каталогом направлений:
- Интерактивная биология
- Образовательные игры
- Инструменты учителя
- Визуальные научные модели

## Как опубликовать сайт через GitHub Pages
1. Открой вкладку **Settings** этого репозитория.
2. В меню слева найди **Pages**.
3. В разделе **Build and deployment** выбери **Deploy from a branch**.
4. В качестве ветки выбери **main**, а папки — **/(root)**.
5. Нажми **Save** и подожди несколько минут.
6. Адрес сайта: https://goldenai017-ops.github.io/5-/

## Подключение ИИ в ALTNEX BioLab

Файл `biology.html` уже отправляет параметры урока в Cloudflare Worker. Серверная часть находится в `worker.js`. Для работы генерации нужно один раз развернуть Worker и добавить секрет Gemini API.

1. Войди в **Cloudflare Dashboard**: https://dash.cloudflare.com/
2. Открой **Workers & Pages** и создай Worker с именем **altnex-biolab-api**.
3. Открой созданный Worker → **Edit code**. Скопируй содержимое файла `worker.js` из этого репозитория и замени им стартовый код Worker. Нажми **Deploy**.
4. В настройках Worker открой **Settings → Variables and Secrets** и добавь секрет:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** твой API-ключ Gemini из Google AI Studio: https://aistudio.google.com/apikey
   Выбирай именно **Secret**, а не обычную переменную. Никогда не добавляй ключ в `biology.html` или в публичный репозиторий.
5. После сохранения секрета снова выполни **Deploy** (если Cloudflare попросит).
6. Проверь, что адрес Worker совпадает с адресом, который использует сайт: `https://altnex-biolab-api.goldenai017.workers.dev/`. Если Cloudflare выдал другой адрес `workers.dev`, измени URL в запросе `fetch(...)` в файле `biology.html` на выданный адрес и сохрани коммит.
7. Открой сайт BioLab, выбери тему, класс и нужные материалы, затем нажми **«Подготовить материалы»**.

Если генерация не работает, проверь секрет `GEMINI_API_KEY`, URL Worker и сообщение об ошибке в окне BioLab. Ключ API хранится только в Cloudflare Worker и не отправляется в браузер.

## План развития
1. Опубликовать главную страницу.
2. Создать интерактивную биологическую лабораторию.
3. Добавить учебные игры и викторины.
4. Добавить инструменты для учителя.
5. Улучшать доступность и адаптацию для телефона.

## Технологии
HTML, CSS, JavaScript, GitHub Pages, Cloudflare Workers и Gemini API.


## Подключение Presenton для презентаций

Презентации из формы «Создать урок» создаются через Presenton API. API-ключ не добавляй в HTML и не отправляй в чат — он должен храниться только как Secret в Cloudflare Worker.

1. Создай API key в аккаунте Presenton: https://presenton.ai/ (раздел аккаунта / API keys).
2. В Cloudflare Dashboard открой Workers & Pages → `altnex-biolab-api` → Settings → Variables and Secrets.
3. Добавь переменную типа **Secret** с именем `PRESENTON_API_KEY` и вставь свой Presenton API key.
4. Открой Edit code, замени код Worker содержимым актуального файла `worker.js` из этого репозитория и нажми Deploy.
5. После этого в BioLab отметь «Презентация · Presenton» и нажми «Подготовить материалы». Файл PPTX и ссылка на редактор появятся в карточке презентации.

КСП, задания, тесты и игры генерируются отдельными запросами через Gemini Worker. Если презентация не создаётся, проверь наличие Secret `PRESENTON_API_KEY` и доступность Presenton API.
