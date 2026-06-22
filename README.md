# Excel AI Assistant

Чат-ассистент для работы с таблицами. Грузишь `.xlsx`/`.csv`, в чате просишь
("удали дубли", "сводная по регионам", "посчитай маржу") — Claude выполняет
через pandas и отдаёт изменённый файл.

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
- Backend → Railway (Dockerfile есть). Env: `ANTHROPIC_API_KEY`, `ALLOWED_ORIGIN`, `MODEL`.
- Frontend → Vercel. Env: `NEXT_PUBLIC_API_URL` = URL backend на Railway.

## Безопасность
`run_pandas` исполняет код от модели в subprocess с whitelist импортов
(pandas/numpy/…), без `os`/`open`/сети, с timeout и rlimit. Достаточно для MVP;
для недоверенных юзеров в проде — заменить на контейнер-на-запрос. См.
`backend/sandbox.py`, `backend/_runner.py`.

## Отложено (по плану)
БД/аккаунты/история, docx/pdf, объектное хранилище. Файлы живут в памяти с TTL 15 мин.
