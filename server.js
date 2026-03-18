const express = require("express");
const { Pool } = require("pg");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = 3000;

// =========================================================================
// 1. ADATBÁZIS KAPCSOLATOK
// =========================================================================

// Felhasználókezelés
const poolUsers = new Pool({
  user: "postgres",
  host: "localhost",
  database: "user_management",
  password: "admin",
  port: 5432,
});

// Alkatrész nyilvántartó (Storage Manager)
const poolStorage = new Pool({
  user: "postgres",
  host: "localhost",
  database: "storage_manager", // Átírtam az utemterv_beta-ról erre!
  password: "admin",
  port: 5432,
});

// =========================================================================
// 2. SZERVER BEÁLLÍTÁSOK
// =========================================================================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views")); // Biztosítja a helyes mappaútvonalat

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    secret: "labor_titkos_kulcs_2026_nagyon_biztonsagos",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 óra lejárati idő
  })
);

// --- MIDDLEWARE A VÉDETT OLDALAKHOZ ---
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect("/");
    }
}

// =========================================================================
// 3. BEJELENTKEZÉS ÉS KIJELENTKEZÉS
// =========================================================================

// Alapértelmezett oldal (Gyökér)
app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("login", { error: null });
});

// Ha valaki direkt a /login-ra jön be
app.get("/login", (req, res) => {
    if (req.session.userId) return res.redirect("/dashboard");
    res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  
  // SHA256 Hash készítése és nagybetűsítése
  const hashedPassword = crypto.createHash("sha256").update(password).digest("hex").toUpperCase();

  try {
    const result = await poolUsers.query(
      "SELECT id, username FROM users WHERE username = $1 AND password = $2",
      [username, hashedPassword]
    );

    if (result.rows.length > 0) {
      req.session.userId = result.rows[0].id;
      req.session.username = result.rows[0].username;
      res.redirect("/dashboard");
    } else {
      res.render("login", { error: "Hibás felhasználónév vagy jelszó!" });
    }
  } catch (err) {
    console.error("Belépési hiba:", err);
    res.render("login", { error: "Adatbázis hiba történt." });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/"); // Kijelentkezés után a gyökérre dobjuk, ami a logint adja be
});

// =========================================================================
// 4. STORAGE MANAGER VÉGPONTOK (DASHBOARD)
// =========================================================================

app.get('/dashboard', requireLogin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 100;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || ''; // Figyeljük, van-e szűrő beállítva

    try {
        // 1. Állandóan számoljuk, hány alkatrész van a minimum alatt (a piros sávhoz)
        const lowStockResult = await poolStorage.query('SELECT COUNT(*) FROM parts WHERE quantity <= min_quantity');
        const lowStockCount = parseInt(lowStockResult.rows[0].count);

        // 2. Szűrő feltétel összeállítása a táblázathoz
        let whereClause = '';
        if (filter === 'low') {
            whereClause = 'WHERE quantity <= min_quantity';
        }

        // 3. Összes listázott alkatrész megszámolása (a lapozóhoz, figyelembe véve a szűrőt)
        const countResult = await poolStorage.query(`SELECT COUNT(*) FROM parts ${whereClause}`);
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit) || 1; 

        // 4. Adatok lekérése a megfelelő oldalhoz és szűrőhöz
        const partsResult = await poolStorage.query(
            `SELECT * FROM parts ${whereClause} ORDER BY id DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        // Renderelés a dashboard.ejs-be (átadjuk a lowStockCount és filter változókat is!)
        res.render('dashboard', {
            username: req.session.username,
            parts: partsResult.rows,
            currentPage: page,
            totalPages: totalPages,
            lowStockCount: lowStockCount,
            currentFilter: filter
        });
    } catch (err) {
        console.error('Hiba a dashboard betöltésekor:', err);
        res.status(500).send('Hiba történt az adatok lekérésekor.');
    }
});

// =========================================================================
// ÚJ ALKATRÉSZ FELVITELE
// =========================================================================

// 1. Az űrlap megjelenítése (GET)
app.get('/new-part', requireLogin, (req, res) => {
    res.render('new-part', {
        username: req.session.username,
        error: null // Alapból nincs hiba
    });
});

// 2. Az űrlap adatainak mentése (POST)
app.post('/new-part', requireLogin, async (req, res) => {
    // Kinyerjük az adatokat a formból (már a location és supplier is benne van)
    const { name, part_number, quantity, min_quantity, price, location, supplier } = req.body;

    try {
        // Beszúrás a storage_manager adatbázis parts táblájába
        await poolStorage.query(
            `INSERT INTO parts (name, part_number, quantity, min_quantity, price, location, supplier) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [name, part_number, quantity, min_quantity, price, location, supplier]
        );

        // Ha sikeres a mentés, visszadobjuk a főoldalra
        res.redirect('/dashboard');

    } catch (err) {
        console.error('Hiba az új alkatrész mentésekor:', err);

        // Postgres egyedi kulcs hiba (ha a gyári szám már létezik)
        if (err.code === '23505') {
            return res.render('new-part', {
                username: req.session.username,
                error: `A(z) "${part_number}" gyári szám már szerepel a rendszerben!`
            });
        }

        res.render('new-part', {
            username: req.session.username,
            error: 'Váratlan hiba történt az adatbázisba mentés során.'
        });
    }
});

// =========================================================================
// ALKATRÉSZ ADATLAP (INFO OLDAL)
// =========================================================================

app.get('/part/:id', requireLogin, async (req, res) => {
    const partId = req.params.id;

    try {
        // Lekérdezzük az adott ID-jű alkatrészt
        const result = await poolStorage.query('SELECT * FROM parts WHERE id = $1', [partId]);
        
        // Ha nincs ilyen alkatrész (pl. rossz linket írt be)
        if (result.rows.length === 0) {
            return res.status(404).send('A keresett alkatrész nem található.');
        }

        const part = result.rows[0];

        // Átadjuk az adatokat a part.ejs-nek
        res.render('part', {
            username: req.session.username,
            part: part
        });

    } catch (err) {
        console.error('Hiba az alkatrész betöltésekor:', err);
        res.status(500).send('Hiba történt az adatok lekérésekor.');
    }
});

// =========================================================================
// ALKATRÉSZ SZERKESZTÉSE
// =========================================================================

// 1. A szerkesztő űrlap megjelenítése (GET)
app.get('/edit-part/:id', requireLogin, async (req, res) => {
    const partId = req.params.id;

    try {
        const result = await poolStorage.query('SELECT * FROM parts WHERE id = $1', [partId]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('A keresett alkatrész nem található.');
        }

        res.render('edit-part', {
            username: req.session.username,
            part: result.rows[0],
            error: null
        });

    } catch (err) {
        console.error('Hiba a szerkesztő oldal betöltésekor:', err);
        res.status(500).send('Hiba történt az adatok lekérésekor.');
    }
});

// 2. A módosított adatok mentése (POST)
app.post('/edit-part/:id', requireLogin, async (req, res) => {
    const partId = req.params.id;
    const { name, part_number, quantity, min_quantity, price, location, supplier } = req.body;

    try {
        // Frissítjük a rekordot az adatbázisban
        await poolStorage.query(
            `UPDATE parts 
             SET name = $1, part_number = $2, quantity = $3, min_quantity = $4, price = $5, location = $6, supplier = $7 
             WHERE id = $8`,
            [name, part_number, quantity, min_quantity, price, location, supplier, partId]
        );

        // Sikeres mentés után visszadobjuk az alkatrész adatlapjára, hogy lássa az eredményt
        res.redirect(`/part/${partId}`);

    } catch (err) {
        console.error('Hiba az alkatrész módosításakor:', err);

        // Készítünk egy "dummy" alkatrész objektumot a beküldött adatokból, 
        // hogy a felhasználó ne veszítse el, amit beírt, ha hiba történik.
        const submittedData = { id: partId, name, part_number, quantity, min_quantity, price, location, supplier };

        if (err.code === '23505') {
            return res.render('edit-part', {
                username: req.session.username,
                part: submittedData,
                error: `A(z) "${part_number}" gyári szám már foglalt egy másik alkatrésznél!`
            });
        }

        res.render('edit-part', {
            username: req.session.username,
            part: submittedData,
            error: 'Váratlan hiba történt a mentés során.'
        });
    }
});

// =========================================================================
// LELTÁR (TÖMEGES BEVÉTELEZÉS)
// =========================================================================

// 1. Leltár oldal megjelenítése (GET)
app.get('/stock-info', requireLogin, async (req, res) => {
    try {
        // Lekérjük az összes eddigi alkatrész nevét a kereső/legördülő (datalist) számára
        const result = await poolStorage.query('SELECT name FROM parts ORDER BY name ASC');
        
        res.render('stock-info', {
            username: req.session.username,
            existingParts: result.rows
        });
    } catch (err) {
        console.error('Hiba a leltár oldal betöltésekor:', err);
        res.status(500).send('Hiba történt.');
    }
});

// 2. Leltár feldolgozása (POST)
app.post('/stock-info', requireLogin, async (req, res) => {
    // Kinyerjük a tömböket az űrlapból
    let { partName, quantity } = req.body;

    // Ha csak 1 sort küldtek be, a req.body stringet ad vissza tömb helyett, ezt lekezeljük:
    if (!Array.isArray(partName)) partName = [partName];
    if (!Array.isArray(quantity)) quantity = [quantity];

    let newParts = [];     // Itt gyűjtjük a teljesen új alkatrészeket
    let updatedCount = 0;  // Számoljuk, hány meglévőt frissítettünk

    try {
        await poolStorage.query('BEGIN'); // Tranzakció indítása

        for (let i = 0; i < partName.length; i++) {
            const name = partName[i].trim();
            const qty = parseInt(quantity[i]) || 0;

            if (!name || qty <= 0) continue; // Üres vagy 0 darabos sorokat átugorjuk

            // Megnézzük, létezik-e már ilyen nevű alkatrész (ILIKE = kis/nagybetű nem számít)
            const checkResult = await poolStorage.query('SELECT id FROM parts WHERE name ILIKE $1 LIMIT 1', [name]);

            if (checkResult.rows.length > 0) {
                // LÉTEZIK: Hozzáadjuk a mennyiséget a meglévőhöz
                await poolStorage.query(
                    'UPDATE parts SET quantity = quantity + $1 WHERE id = $2',
                    [qty, checkResult.rows[0].id]
                );
                updatedCount++;
            } else {
                // ÚJ ALKATRÉSZ: Létrehozzuk ideiglenes gyári számmal
                const tempPartNumber = 'TEMP-' + crypto.randomBytes(3).toString('hex').toUpperCase();
                
                const insertResult = await poolStorage.query(
                    `INSERT INTO parts (name, part_number, quantity, min_quantity, price) 
                     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [name, tempPartNumber, qty, 5, 0] // Alapértelmezetten 5-ös limit, 0 Ft ár
                );
                
                // Eltesszük a listába, hogy a végén ki tudjuk írni a usernek
                newParts.push({ id: insertResult.rows[0].id, name: name, qty: qty });
            }
        }

        await poolStorage.query('COMMIT'); // Minden sikeres, mentsük el a DB-be!

        // Sikeres leltár oldal renderelése az eredménnyel
        res.render('stock-success', {
            username: req.session.username,
            updatedCount: updatedCount,
            newParts: newParts
        });

    } catch (err) {
        await poolStorage.query('ROLLBACK'); // Hiba volt, mindent visszavonunk
        console.error('Hiba a leltár mentésekor:', err);
        res.status(500).send('Kritikus hiba történt a leltározás során. Semmi sem lett elmentve.');
    }
});

// =========================================================================
// 5. SZERVER INDÍTÁSA
// =========================================================================

app.listen(PORT, () => {
    console.log(`🚀 Raktarkezelo fut: http://localhost:${PORT}`);
});