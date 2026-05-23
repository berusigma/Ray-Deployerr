# Ray App — Deploy Guide

## Stack
- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas (Cluster0)
- **Frontend**: Vanilla HTML/CSS/JS
- **Deploy**: Vercel

---

## 1. Setup MongoDB Atlas

1. Buka [mongodb.com/cloud/atlas](https://mongodb.com/cloud/atlas)
2. Buat cluster **Cluster0** (free tier M0)
3. Buat database user (username + password)
4. Whitelist IP: `0.0.0.0/0` (allow all — Vercel dynamic IP)
5. Salin **Connection String** format:
   ```
   mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/rayapp?retryWrites=true&w=majority
   ```

---

## 2. Deploy ke Vercel

### Via CLI:
```bash
npm install -g vercel
cd ray-app
vercel login
vercel --prod
```

### Via GitHub:
1. Push ke GitHub repo
2. Import di [vercel.com/new](https://vercel.com/new)
3. Set **Root Directory** ke `/` (tidak perlu diubah)

---

## 3. Environment Variables di Vercel

Buka **Project Settings → Environment Variables**, tambahkan:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/rayapp?...` |
| `JWT_SECRET` | String random panjang (min 32 karakter) |
| `ADMIN_SECRET` | Secret key untuk promosi ke admin |
| `BASE_URL` | `https://nama-project.vercel.app` |

---

## 4. Buat Akun Admin Pertama

Setelah deploy:

1. **Register** akun biasa di website
2. Buka MongoDB Atlas → Collections → `users`
3. Edit dokumen user kamu → ubah `role` dari `"user"` ke `"admin"`

Atau pakai endpoint (setelah login sebagai admin pertama):
```
PUT /api/admin/users/:id/make-admin
Body: { "secret": "nilai ADMIN_SECRET kamu" }
```

---

## 5. Sesuaikan TikTok URL

Di file `api/routes/servers.js`, baris:
```js
const TIKTOK_URL = 'https://www.tiktok.com/@rayapp_host';
```
Ganti dengan akun TikTok kamu.

---

## Fitur Keamanan

- Helmet.js (security headers)
- Rate limiting (global + auth + upload)
- MongoDB sanitize (prevent injection)
- XSS escape di semua output
- Path traversal prevention
- File type blocking (.php, .py, .exe, dll)
- IP blocking system
- JWT authentication
- Emoji captcha anti-bot
- Auto-delete inactive servers (7 hari)

---

## Struktur File

```
ray-app/
├── api/
│   ├── index.js          # Main server
│   ├── models.js         # MongoDB schemas
│   ├── middleware.js      # Auth, IP blocker, logger
│   └── routes/
│       ├── auth.js        # Register, login, captcha
│       ├── servers.js     # CRUD server/folder
│       ├── files.js       # Upload, download, rename, delete
│       └── admin.js       # Admin endpoints
├── public/
│   ├── index.html         # Landing page
│   ├── login.html
│   ├── register.html      # + emoji captcha
│   ├── dashboard.html
│   ├── filemanager.html   # File manager cPanel-style
│   ├── admin.html         # Admin panel
│   ├── 404.html
│   └── assets/
│       ├── css/style.css  # Ocean theme
│       └── js/utils.js    # Global JS utilities
├── package.json
├── vercel.json
└── .env.example
```

---

## Limits (bisa diubah di kode)

| Limit | Value |
|-------|-------|
| Max server per akun | 4 |
| Max buat server per hari | 2 |
| Max file size | 10 MB |
| Max total storage per server | 50 MB |
| Auto-delete jika tidak aktif | 7 hari |
