const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());
// Serve frontend static files
app.use(express.static(__dirname));

// Utility to read DB
async function readDB() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('data.json not found. Please ensure it exists.');
            return {};
        }
        throw err;
    }
}

// Utility to write DB
async function writeDB(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Generate ID
const generateId = () => Math.random().toString(36).substring(2, 15);

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const db = await readDB();
    const user = db.cma_users.find(u => u.username === username && u.password === password);

    if (user) {
        // Exclude password in response
        const { password, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, fullName, password } = req.body;
    const db = await readDB();

    if (db.cma_users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    const newUser = {
        id: generateId(),
        username,
        fullName,
        password,
        role: 'faculty',
        status: 'pending'
    };

    db.cma_users.push(newUser);
    await writeDB(db);

    res.status(201).json({ success: true, message: 'Signup successful, pending approval.' });
});

// ============================================
// GENERIC CRUD API FACTORY
// ============================================

// Bulk data load for frontend caching
app.get('/api/db', async (req, res) => {
    const db = await readDB();
    res.json(db);
});

// Bulk data restore
app.post('/api/db', async (req, res) => {
    try {
        await writeDB(req.body);
        res.json({ success: true, message: 'Database restored successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to restore database' });
    }
});

// Helper maps to route names
const routeMap = {
    'users': 'cma_users',
    'departments': 'cma_depts',
    'programs': 'cma_progs',
    'courses': 'cma_courses',
    'plos': 'cma_plos',
    'clos': 'cma_clos'
};

Object.keys(routeMap).forEach(route => {
    const dbKey = routeMap[route];

    // GET all
    app.get(`/api/${route}`, async (req, res) => {
        const db = await readDB();
        res.json(db[dbKey] || []);
    });

    // POST (Add)
    app.post(`/api/${route}`, async (req, res) => {
        const db = await readDB();
        const newItem = { id: generateId(), ...req.body };

        // Basic unique validation
        if (req.body.code && db[dbKey].some(item => item.code && item.code.toLowerCase() === req.body.code.toLowerCase())) {
            // Need exceptional handling for CLOs where code+courseId must be unique
            let isDuplicate = true;
            if (route === 'clos' && req.body.courseId) {
                isDuplicate = db[dbKey].some(item => item.code.toLowerCase() === req.body.code.toLowerCase() && item.courseId === req.body.courseId);
            }

            if (isDuplicate) {
                return res.status(400).json({ success: false, message: `Code ${req.body.code} already exists.` });
            }
        }

        if (!db[dbKey]) db[dbKey] = [];
        db[dbKey].push(newItem);
        await writeDB(db);
        res.status(201).json(newItem);
    });

    // PUT (Update)
    app.put(`/api/${route}/:id`, async (req, res) => {
        const db = await readDB();
        const index = db[dbKey].findIndex(item => item.id === req.params.id);

        if (index !== -1) {
            db[dbKey][index] = { ...db[dbKey][index], ...req.body };
            await writeDB(db);
            res.json(db[dbKey][index]);
        } else {
            res.status(404).json({ success: false, message: 'Item not found' });
        }
    });

    // DELETE
    app.delete(`/api/${route}/:id`, async (req, res) => {
        const db = await readDB();
        db[dbKey] = db[dbKey].filter(item => item.id !== req.params.id);
        await writeDB(db);
        res.json({ success: true });
    });
});

// ============================================
// SPECIAL ROUTE: MAPPINGS
// ============================================
app.get('/api/mappings', async (req, res) => {
    const db = await readDB();
    res.json(db.cma_mappings || []);
});

app.post('/api/mappings', async (req, res) => {
    const { cloId, ploId, level } = req.body;
    const db = await readDB();
    if (!db.cma_mappings) db.cma_mappings = [];

    const existingIdx = db.cma_mappings.findIndex(m => m.cloId === cloId && m.ploId === ploId);

    if (existingIdx >= 0) {
        if (!level) {
            db.cma_mappings.splice(existingIdx, 1);
        } else {
            db.cma_mappings[existingIdx].level = level;
        }
    } else if (level) {
        db.cma_mappings.push({ id: generateId(), cloId, ploId, level });
    }

    await writeDB(db);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
