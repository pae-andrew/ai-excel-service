# Excel AI Assistant

Чат-ассистент для работы с таблицами. Грузишь `.xlsx`/`.csv`/`.docx`/`.pdf`,
в чате просишь ("удали дубли", "сводная по регионам", "посчитай маржу") — Claude
выполняет через pandas и отдаёт изменённый xlsx (со всеми листами).

- **backend/** — FastAPI + Claude. Один tool `run_pandas`, исполнение в песочнице.
- **frontend/** — Next.js (App Router), чат с SSE-стримингом.

## Локальный запуск

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # см. примечание ниже
pip install -r requirements.txt
cp .env.example .env            # вписать ANTHROPIC_API_KEY
uvicorn main:app --reload       # http://localhost:8000
```
> На внешних томах venv может ломаться — создавай его в домашней папке
> (`python3 -m venv ~/excelai-venv`) и активируй оттуда.

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                        # http://localhost:3000
```

## Тест песочницы (без API-ключа)
```bash
cd backend && python test_sandbox.py   # проверяет блокировку os/open, мутации df
```

## Деплой

Нужен git-remote (GitHub) — оба провайдера деплоят push'ем.

**0. Запушить в GitHub**
```bash
gh repo create ai-excel-service --private --source=. --push   # или вручную
```

**1. Backend → Railway** (есть `Dockerfile` + `railway.json`)
- New Project → Deploy from GitHub repo → выбрать репо.
- Root Directory: `backend`.
- Variables: `ANTHROPIC_API_KEY`, `MODEL=claude-opus-4-8`,
  `ALLOWED_ORIGIN=https://<твой-проект>.vercel.app` (заполнить после шага 2).
- Healthcheck `/health` уже в `railway.json`. Скопировать публичный URL.

**2. Frontend → Vercel**
- Import Project → выбрать репо.
- **Root Directory: `frontend`** (важно — иначе соберёт корень).
- Env: `NEXT_PUBLIC_API_URL=https://<railway-url>`.
- Deploy → получить `https://<проект>.vercel.app`.

**3. Замкнуть CORS**: вписать Vercel-домен в `ALLOWED_ORIGIN` на Railway → redeploy.

## Безопасность
`run_pandas` исполняет код от модели в subprocess с whitelist импортов
(pandas/numpy/…), без `os`/`open`/сети, с timeout и rlimit. Достаточно для MVP;
для недоверенных юзеров в проде — заменить на контейнер-на-запрос. См.
`backend/sandbox.py`, `backend/_runner.py`.

## Отложено (по плану)
БД/аккаунты/история, объектное хранилище. Файлы/сессии живут в памяти с TTL 15 мин
(на Railway с несколькими репликами понадобится Redis — пока одна реплика).
