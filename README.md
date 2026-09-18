# Coconut Padel

Matchmaker padel Americano karya anak Binjai.

- Multi lapangan
- Pemain telat diprioritaskan untuk mengejar jumlah pertandingan
- Poin Americano: skor tim dijumlahkan ke total per match (16/21/24/32), lalu masuk klasemen individual
- Tautan publik untuk melihat pertandingan dan klasemen selama turnamen berlangsung

## Lokal

```bash
npm install
cp .env.example .env.local
npx vercel env pull .env.local --yes
npm run db:push
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).
