import { program } from 'commander';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import bodyParser from 'body-parser';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

program
    .option('-h, --host <host>', 'Host address to bind the server', process.env.HOST)
    .option('-p, --port <port>', 'Port number to bind the server', process.env.PORT)
    .option('-c, --cache <dir>', 'Cache directory for storing files', process.env.CACHE_DIR)
    .parse(process.argv);
const options = program.opts();

const HOST = options.host || '0.0.0.0';
const PORT = options.port || 3000;
const CACHE_DIR = path.resolve(options.cache || './cache');

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'user',
    password: process.env.MYSQL_PASSWORD || 'password',
    database: process.env.MYSQL_DATABASE || 'inventory_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`Створено теку: ${CACHE_DIR}`);
}

const app = express();
const upload = multer({ dest: CACHE_DIR });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Inventory API",
            version: "1.0.0",
            description: "API documentation for Inventory Service"
        },
    },
    apis: ["./main.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @openapi
 * /register:
 *   post:
 *     summary: Register a new inventory item
 *     description: Upload photo + add name and description (multipart/form-data)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: New item created
 *       400:
 *         description: inventory_name missing
 *       500:
 *         description: Server error
 */
app.post('/register', upload.single('photo'), async (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        return res.status(400).json({ error: "(400) inventory_name is required" });
    }

    const itemId = randomUUID();
    const photoFilename = req.file ? req.file.filename : null;

    try {
        const [result] = await pool.execute(
            'INSERT INTO inventory (id, name, description, photo) VALUES (?, ?, ?, ?)',
            [itemId, inventory_name, description || "", photoFilename]
        );
        console.log("DB Insert Result:", result);
        res.status(201).json({ message: "Created", id: itemId });
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory:
 *   get:
 *     summary: Get all inventory items
 *     description: Returns list of all items in storage
 *     responses:
 *       200:
 *         description: List of items
 *       500:
 *         description: Server error
 */
app.get('/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name, description, photo FROM inventory');
        res.json(rows);
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory/{id}:
 *   get:
 *     summary: Get inventory item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Found item
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.get('/inventory/:id', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, name, description, photo FROM inventory WHERE id = ?',
            [req.params.id]
        );

        const item = rows[0];
        if (!item) return res.status(404).json({ error: "Not found" });
        res.json(item);
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory/{id}:
 *   put:
 *     summary: Update specific inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item updated
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.put('/inventory/:id', async (req, res) => {
    const { name, description } = req.body;
    const updateFields = [];
    const updateValues = [];

    if (name) {
        updateFields.push('name = ?');
        updateValues.push(name);
    }
    if (description) {
        updateFields.push('description = ?');
        updateValues.push(description);
    }

    if (updateFields.length === 0) {
        const [rows] = await pool.execute('SELECT id, name, description, photo FROM inventory WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "Not found" });
        return res.json({ message: "No changes requested", item: rows[0] });
    }

    try {
        const [result] = await pool.execute(
            `UPDATE inventory SET ${updateFields.join(', ')} WHERE id = ?`,
            [...updateValues, req.params.id]
        );

        if (result.affectedRows === 0) {
            const [checkRows] = await pool.execute('SELECT id FROM inventory WHERE id = ?', [req.params.id]);
            if (checkRows.length === 0) return res.status(404).json({ error: "Not found" });
        }

        const [rows] = await pool.execute('SELECT id, name, description, photo FROM inventory WHERE id = ?', [req.params.id]);
        const item = rows[0];

        res.json({ message: "Updated", item });

    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get inventory photo by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns JPEG photo
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.get('/inventory/:id/photo', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT photo FROM inventory WHERE id = ?',
            [req.params.id]
        );

        const item = rows[0];
        if (!item || !item.photo) {
            return res.status(404).json({ error: "Photo not found" });
        }

        const photoPath = path.join(CACHE_DIR, item.photo);
        if (!fs.existsSync(photoPath)) {
            return res.status(404).json({ error: "Photo file missing" });
        }

        res.setHeader("Content-Type", "image/jpeg");
        res.sendFile(photoPath);
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory/{id}/photo:
 *   put:
 *     summary: Update photo for inventory item
 *     description: Upload new photo for specific item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Photo updated
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Photo file is required" });
    }
    const photoFilename = req.file.filename;

    try {
        const [result] = await pool.execute(
            'UPDATE inventory SET photo = ? WHERE id = ?',
            [photoFilename, req.params.id]
        );

        if (result.affectedRows === 0) {
            const [checkRows] = await pool.execute('SELECT id FROM inventory WHERE id = ?', [req.params.id]);
            if (checkRows.length === 0) return res.status(404).json({ error: "Not found" });
        }

        res.json({ message: "Photo updated" });
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /inventory/{id}:
 *   delete:
 *     summary: Delete inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item deleted
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.delete('/inventory/:id', async (req, res) => {
    try {
        const [selectRows] = await pool.execute(
            'SELECT photo FROM inventory WHERE id = ?',
            [req.params.id]
        );
        const item = selectRows[0];

        const [result] = await pool.execute(
            'DELETE FROM inventory WHERE id = ?',
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Not found" });
        }

        if (item && item.photo) {
            const photoPath = path.join(CACHE_DIR, item.photo);
            if (fs.existsSync(photoPath)) {
                fs.unlink(photoPath, (err) => {
                    if (err) console.error("Error deleting photo file:", err);
                    else console.log(`Successfully deleted file: ${photoPath}`);
                });
            }
        }

        res.json({ message: "Deleted" });
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * @openapi
 * /search:
 *   post:
 *     summary: Search item by ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               includePhoto:
 *                 type: boolean
 *             required:
 *               - id
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
app.post('/search', async (req, res) => {
    console.log("SEARCH BODY:", req.body);
    const { id, includePhoto } = req.body;

    if (!id) {
        return res.status(400).send("ID parameter is required");
    }

    try {
        const [rows] = await pool.execute(
            'SELECT name, description, photo FROM inventory WHERE id = ?',
            [id]
        );

        const item = rows[0];

        if (!item) {
            return res.status(404).send("Not Found");
        }

        let result = `Name: ${item.name}\nDescription: ${item.description}`;

        if (includePhoto === 'true' || includePhoto === true) {
            result += `\nPhoto: /inventory/${id}/photo`;
        }

        res.setHeader("Content-Type", "text/plain");
        res.send(result);
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.resolve('RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.resolve('SearchForm.html'));
});

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}/`);
    console.log(`Swagger running at http://${HOST}:${PORT}/docs`);
    console.log(`Cache directory: ${CACHE_DIR}`);
});