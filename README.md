# Ray App — Deploy Guide

## Stack
Node.js + Express · MongoDB Atlas · Vanilla HTML/CSS/JS · Vercel

---

## 1. Setup MongoDB Atlas
1. Buka https://cloud.mongodb.com → buat cluster **M0 (free)**
2. Database → Create → nama: `rayapp`
3. Database Access → Add user (username + password)
4. Network Access → Add IP: `0.0.0.0/0`
5. Connect → Driver → salin connection string

---

## 2. Deploy ke Vercel

### Via GitHub (recommended):
```bash
# 1. Extract ZIP, masuk folder
cd ray-app
npm install   # test local dulu

# 2. Push ke GitHub
git init && git add . && git commit -m "init ray-app"
# push ke repo GitHub kamu

# 3. Import di vercel.com/new → pilih repo
```

### Via CLI:
```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## 3. Environment Variables di Vercel
Project Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/rayapp?retryWrites=true&w=majority` |
| `JWT_SECRET` | string random panjang (min 32 char) — bisa generate di: https://generate-secret.vercel.app/32 |
| `ADMIN_SECRET` | key rahasia untuk promosi admin |
| `BASE_URL` | `https://nama-project.vercel.app` |

---

## 4. Buat Admin Pertama
1. Register akun biasa di website
2. Buka MongoDB Atlas → Browse Collections → `users`
3. Edit dokumen → ubah `role: "user"` → `role: "admin"`
4. Login ulang → akses `/admin-panel`

---

## 5. Ganti URL TikTok
Di `api/routes/servers.js` baris:
```js
const TT_URL = 'https://www.tiktok.com/@rayapp_host';
```
Ganti dengan username TikTok kamu.

---

## Limits (ubah di kode)
| Setting | Default |
|---------|---------|
| Max server per akun | 4 |
| Max buat per hari | 2 |
| Max file size | 10 MB |
| Max storage per server | 50 MB |
| Auto-delete jika tidak aktif | 7 hari |
