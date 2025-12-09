const { program } = require('commander');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

program
    .requiredOption('-h, --host <host>', 'Host address to bind the server')
    .requiredOption('-p, --port <port>', 'Port number to bind the server')
    .requiredOption('-c, --cache <dir>', 'Cache directory for storing files');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

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

let inventory = [];

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
 */
app.post('/register', upload.single('photo'), (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        return res.status(400).json({ error: "(400) inventory_name is required" });
    }

    const item = {
        id: randomUUID(),
        name: inventory_name,
        description: description || "",
        photo: req.file ? req.file.filename : null
    };

    inventory.push(item);

    res.status(201).json({ message: "Created", id: item.id });
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
 */
app.get('/inventory', (req, res) => {
    res.json(inventory);
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
 */
app.get('/inventory/:id', (req, res) => {
    const item = inventory.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
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
 */
app.put('/inventory/:id', (req, res) => {
    const item = inventory.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const { name, description } = req.body;
    if (name) item.name = name;
    if (description) item.description = description;

    res.json({ message: "Updated", item });
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
 */
app.get('/inventory/:id/photo', (req, res) => {
    const item = inventory.find((x) => x.id === req.params.id);

    if (!item || !item.photo) {
        return res.status(404).json({ error: "Photo not found" });
    }

    const photoPath = path.join(CACHE_DIR, item.photo);
    if (!fs.existsSync(photoPath)) {
        return res.status(404).json({ error: "Photo file missing" });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(photoPath);
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
 */
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
    const item = inventory.find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    item.photo = req.file.filename;
    res.json({ message: "Photo updated" });
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
 */
app.delete('/inventory/:id', (req, res) => {
    const index = inventory.findIndex((x) => x.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Not found" });

    inventory.splice(index, 1);
    res.json({ message: "Deleted" });
});

/**
 * @openapi
 * /search:
 *   get:
 *     summary: Search item by ID
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */
app.get('/search', (req, res) => {
    console.log("SEARCH QUERY:", req.query);
    const { id, includePhoto } = req.query;

    const item = inventory.find(x => x.id === id);

    if (!item) {
        return res.status(404).send("Not Found");
    }

    let result = `Name: ${item.name}\nDescription: ${item.description}`;

    if (includePhoto) {
        result += `\nPhoto: /inventory/${item.id}/photo`;
    }

    res.setHeader("Content-Type", "text/plain");
    res.send(result);
});


/**
 * @openapi
 * /hello:
 *   post:
 *     summary: Hello endpoint
 *     responses:
 *       201:
 *         description: Created
 *       404:
 *         description: Not found
 */
app.post('/hello', (req, res) => {
    console.log("Received /hello POST:", req.body);
    res.json({ message: "Hello received", data: req.body });
});


app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

app.use((req, res) => {
    res.status(404).send("Not Found");
});

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}/`);
    console.log(`Swagger running at http://${HOST}:${PORT}/docs`);
    console.log(`Cache directory: ${CACHE_DIR}`);
});