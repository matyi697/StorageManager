-- 1. Kategóriák (Előkészítve a jövőbeli funkcióhoz)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

-- 2. Gyártók (pl. Eppendorf, Gilson, Thermo Fisher)
CREATE TABLE manufacturers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

-- 3. Pipetta Modellek (A gyártókhoz kötve, pl. Research Plus, Pipetman L)
CREATE TABLE models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    manufacturer_id INT REFERENCES manufacturers(id) ON DELETE CASCADE
);

-- 4. Alkatrészek (A fő tábla)
CREATE TABLE parts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    part_number VARCHAR(100) NOT NULL UNIQUE,     -- Gyári szám
    quantity INT NOT NULL DEFAULT 0,              -- Jelenlegi darabszám
    min_quantity INT NOT NULL DEFAULT 5,          -- Riasztási küszöb (ha ez alá esik, jelez a rendszer)
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,   -- Ár
    manufacturer_id INT REFERENCES manufacturers(id) ON DELETE SET NULL, -- Az alkatrész gyártója
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,        -- Jövőbeli kategória
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Alkatrész - Modell kapcsolótábla
-- Mivel egy alkatrész több pipetta modellhez is kompatibilis lehet, és egy modellhez sok alkatrész tartozik
CREATE TABLE part_models (
    part_id INT REFERENCES parts(id) ON DELETE CASCADE,
    model_id INT REFERENCES models(id) ON DELETE CASCADE,
    PRIMARY KEY (part_id, model_id)
);

ALTER TABLE parts ADD COLUMN location VARCHAR(255);
ALTER TABLE parts ADD COLUMN supplier VARCHAR(255);