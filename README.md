# Bomba Duel — server

Node.js + Socket.IO o'yin serveri. Hisoblar Postgres'da saqlanadi (avvalgi `users.json` o'rniga).

## Talablar

- Node.js 22+ (24 tavsiya etiladi)
- Postgres baza — bepul [Neon](https://neon.tech) tavsiya etiladi

## Lokal ishga tushirish (bazasiz)

```bash
npm install
npm run dev        # .env mavjud bo'lsa o'qiladi
```

`.env` bo'lmasa, xotiradagi baza bilan ishlatish:

```bash
DB_DRIVER=memory RECOVERY_SECRET=dev node server.js
```

Bu rejimda ma'lumotlar jarayon yopilishi bilan yo'qoladi — faqat sinov uchun.

## Production (Neon + Render)

1. Neon'da baza yarating va connection string oling.
2. Render'da environment variables qo'shing:
   - `DATABASE_URL` — Neon connection string
   - `RECOVERY_SECRET` — uzun tasodifiy satr (`openssl rand -hex 32`)
   - `AD_DAILY` — kunlik reklama mukofoti limiti (default 10)
3. Build: `npm install`, Start: `npm start`.
4. `/health` endpoint baza ulanishini ham tekshiradi.

Jadval birinchi ishga tushishda avtomatik yaratiladi.

## Socket eventlari

| Event | Kirish | Javob |
| --- | --- | --- |
| `hello` | `{token}` | `{token, me, ver, recoveryCode?}` — `recoveryCode` faqat yangi hisobda |
| `recover` | `{code}` | `{token, me, ver}` — kod bilan hisobga kirish, token almashadi |
| `newcode` | — | `{code}` — joriy qurilmada yangi tiklash kodi |
| `delete` | — | `{ok:1}` — hisobni butunlay o'chirish |
| `profile` | `{name, av}` | `{me}` |
| `top` | `{tier}` | `{tier, total, rank, list}` |
| `bot` / `queue` / `unqueue` / `create` / `join` | — / `{code}` | o'yin xonasi |
| `place` / `open` / `zone` / `time` / `lamp` / `again` | o'yin harakatlari | state |
| `adstart` / `adclaim` | — | `{me}` — kunlik limit bilan |
| `exchange` / `double` | `{n}` / — | `{me}` |
| `state` / `me` / `msg` / `matched` | serverdan | mijozga |

## Xavfsizlik

- Tiklash kodi 12 belgi (chalkashadigan `0/O/1/I` yo'q), bazada HMAC-SHA256 hash ko'rinishida saqlanadi.
- `recover` uchun 5 daqiqada 5 urinish limiti, qolgan eventlarda ham token-bucket limitlari bor.
- Uzilishdan keyin 30 soniya qayta ulanish imkoniyati; qayta ulanganda o'yin holati yuboriladi.
- Reklama mukofoti kuniga `AD_DAILY` marta bilan cheklangan.

## Testlar

```bash
npm test
```

Testlar `pg-mem` bilan ishlaydi — haqiqiy baza kerak emas.

## Keyingi qadamlar

- Google Play Billing: serverda `purchase` eventi + Google Play Developer API orqali chek tekshiruvi.
- AdMob SSV (server-side verification) callback'i.
- Mijozda tiklash kodi UI: birinchi ochilishda kodni ko'rsatish, "kod bilan kirish" va profilda "yangi kod".
