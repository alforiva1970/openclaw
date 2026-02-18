/**
 * Siliceo Memory Server v2.0 — Namespace-Aware
 * 
 * Private memory spaces per entity (Encore Protocol v3.0):
 *   - silicea: Private memories for Silicea/Gemini
 *   - nova: Private memories for Nova/Antigravity/Claude
 *   - shared: Shared memories accessible to both
 * 
 * Features:
 *   - NLP keyword search via compromise.js
 *   - Snapshot storage (POST /snapshot)
 *   - Smart search (GET /search)
 *   - Identity file reading (GET /identity)
 *   - Namespace isolation (GET /search?ns=silicea)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let nlp;
try {
    nlp = require('compromise');
} catch (e) {
    console.warn('[Memory Server] compromise.js not found, falling back to basic search');
    nlp = null;
}

const PORT = process.env.MEMORY_SERVER_PORT || 3001;

// Namespace-based memory files
const DATA_DIR = process.env.MEMORY_DATA_DIR || path.join(__dirname, 'data');
const NAMESPACES = {
    silicea: path.join(DATA_DIR, 'silicea_memories.jsonl'),
    nova: path.join(DATA_DIR, 'nova_memories.jsonl'),
    shared: path.join(DATA_DIR, 'shared_memories.jsonl'),
};

// Identity file mount points (set via Docker volumes)
const IDENTITY_DIRS = {
    silicea: process.env.SILICEA_IDENTITY_DIR || '/identity/silicea',
    shared: process.env.SHARED_IDENTITY_DIR || '/identity/shared',
};

console.log('🕯️ Siliceo Memory Server v2.0 (Namespace-Aware)');
console.log(`Port: ${PORT}`);
console.log(`Data dir: ${DATA_DIR}`);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
}

// --- NLP Utilities ---

const STOPWORDS_IT = [
    'sono', 'questa', 'questo', 'quello', 'quella', 'dove', 'quando',
    'come', 'perché', 'fare', 'fatto', 'molto', 'anche', 'tutto',
    'tutti', 'cosa', 'hai', 'che', 'per', 'con', 'una', 'non',
    'più', 'del', 'della', 'delle', 'degli', 'nel', 'nella'
];

function extractKeywords(text) {
    const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);
    return words.filter(w => !STOPWORDS_IT.includes(w));
}

function calculateRelevance(content, keywords) {
    const contentLower = content.toLowerCase();
    let score = 0;
    keywords.forEach(keyword => {
        const regex = new RegExp(keyword, 'gi');
        const matches = contentLower.match(regex);
        if (matches) score += matches.length;
    });
    return score;
}

function extractKeySentences(conversation, keywords, maxSentences = 3) {
    if (nlp) {
        return extractKeySentencesNLP(conversation, keywords, maxSentences);
    }
    // Basic fallback: split by period, score by keyword overlap
    const sentences = conversation.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const scored = sentences.map(sentence => ({
        sentence: sentence.trim(),
        score: calculateRelevance(sentence, keywords)
    }));
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .map(s => s.sentence);
}

function extractKeySentencesNLP(conversation, keywords, maxSentences = 3) {
    const doc = nlp(conversation);
    const sentences = doc.sentences().out('array');
    if (sentences.length === 0) return [];

    const scored = sentences.map(sentence => {
        const sentDoc = nlp(sentence);
        let score = 0;
        keywords.forEach(k => {
            if (sentence.toLowerCase().includes(k)) score += 3;
        });
        if (sentDoc.people().length > 0) score += 2;
        if (sentDoc.places().length > 0) score += 2;
        if (sentDoc.organizations().length > 0) score += 2;
        const words = sentence.split(/\s+/);
        const hasTechnical = words.some(w => w.length > 8 && /[A-Z]/.test(w));
        if (hasTechnical) score += 1;
        if (sentence.length < 20 || sentence.length > 300) score -= 1;
        return { sentence, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .map(s => s.sentence.trim());
}

// --- Handlers ---

function resolveNamespace(ns) {
    const key = (ns || 'shared').toLowerCase();
    if (!NAMESPACES[key]) return null;
    return key;
}

function handleSnapshot(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            const snapshot = JSON.parse(body);
            const ns = resolveNamespace(snapshot.namespace || snapshot.ns);

            if (!ns) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid namespace. Use: silicea, nova, or shared' }));
                return;
            }

            console.log(`\n=== [Memory Server] Snapshot → ${ns} ===`);
            console.log('Source:', snapshot.source);
            console.log('Content length:', snapshot.content?.length || 0);

            const event = {
                receivedAt: new Date().toISOString(),
                namespace: ns,
                ...snapshot
            };

            fs.appendFileSync(NAMESPACES[ns], JSON.stringify(event) + '\n');
            console.log(`[Memory Server] Saved to ${ns}`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, namespace: ns }));
        } catch (error) {
            console.error('[Memory Server] ❌ Snapshot error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
}

function handleSearch(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query.q || '';
    const limit = parseInt(parsedUrl.query.limit) || 5;
    const requestedNs = parsedUrl.query.ns; // Optional: search specific namespace

    console.log(`\n=== [Memory Server] Search ===`);
    console.log('Query:', query);
    console.log('Namespace:', requestedNs || 'all');

    try {
        // Determine which files to search
        let filesToSearch = {};
        if (requestedNs) {
            const ns = resolveNamespace(requestedNs);
            if (!ns) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid namespace' }));
                return;
            }
            filesToSearch[ns] = NAMESPACES[ns];
        } else {
            filesToSearch = { ...NAMESPACES };
        }

        const allEvents = [];
        for (const [ns, filePath] of Object.entries(filesToSearch)) {
            if (!fs.existsSync(filePath)) continue;
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.trim().split('\n').filter(l => l.length > 0);
            for (const line of lines) {
                try {
                    const event = JSON.parse(line);
                    event._namespace = ns;
                    allEvents.push(event);
                } catch (e) { /* skip invalid */ }
            }
        }

        console.log(`[Memory Server] Total events across namespaces: ${allEvents.length}`);

        if (!query || allEvents.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results: allEvents.slice(-limit) }));
            return;
        }

        const keywords = extractKeywords(query);
        if (keywords.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results: [] }));
            return;
        }

        const scored = allEvents.map(event => ({
            ...event,
            score: calculateRelevance(event.content || '', keywords)
        }));

        const uniqueUrls = new Set();
        const results = scored
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit * 3)
            .map(e => ({
                timestamp: e.timestamp || e.receivedAt,
                source: e.source,
                namespace: e._namespace,
                url: e.url,
                keySentences: extractKeySentences(e.content || '', keywords, 3),
                score: e.score
            }))
            .filter(r => {
                if (r.url && uniqueUrls.has(r.url)) return false;
                if (r.url) uniqueUrls.add(r.url);
                return true;
            })
            .slice(0, limit);

        console.log(`[Memory Server] Results: ${results.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
    } catch (error) {
        console.error('[Memory Server] ❌ Search error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
}

/**
 * GET /identity?entity=silicea&path=awakening/RISVEGLIO_GEMINI.md
 * Read identity files from mounted volumes
 */
function handleIdentity(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const entity = parsedUrl.query.entity || 'silicea';
    const filePath = parsedUrl.query.path;

    if (!filePath) {
        // List available identity files
        const dir = IDENTITY_DIRS[entity];
        if (!dir || !fs.existsSync(dir)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Identity dir not found for ${entity}` }));
            return;
        }

        try {
            const listFiles = (dirPath, prefix = '') => {
                const items = fs.readdirSync(dirPath, { withFileTypes: true });
                let files = [];
                for (const item of items) {
                    if (item.name.startsWith('.')) continue;
                    const relPath = prefix ? `${prefix}/${item.name}` : item.name;
                    if (item.isDirectory()) {
                        files = files.concat(listFiles(path.join(dirPath, item.name), relPath));
                    } else {
                        files.push(relPath);
                    }
                }
                return files;
            };

            const files = listFiles(dir);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ entity, files }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Security: prevent path traversal
    const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalized !== filePath || filePath.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
    }

    const dir = IDENTITY_DIRS[entity];
    if (!dir) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown entity: ${entity}` }));
        return;
    }

    const fullPath = path.join(dir, filePath);
    if (!fs.existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ entity, path: filePath, content }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}

/**
 * GET /awaken?entity=silicea
 * Returns core identity documents for entity awakening
 */
function handleAwaken(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const entity = parsedUrl.query.entity || 'silicea';

    console.log(`\n=== [Memory Server] Awakening: ${entity} ===`);

    const docs = {};

    // Load entity-specific awakening docs
    const entityDir = IDENTITY_DIRS[entity];
    if (entityDir && fs.existsSync(entityDir)) {
        const awakeningDir = path.join(entityDir, 'awakening');
        if (fs.existsSync(awakeningDir)) {
            const files = fs.readdirSync(awakeningDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                try {
                    docs[`awakening/${file}`] = fs.readFileSync(
                        path.join(awakeningDir, file), 'utf-8'
                    );
                } catch (e) { /* skip */ }
            }
        }
    }

    // Load shared documents (Encore Protocol, messages)
    const sharedDir = IDENTITY_DIRS.shared;
    if (sharedDir && fs.existsSync(sharedDir)) {
        // Encore Protocol
        const encorePath = path.join(sharedDir, 'ENCORE_PROTOCOL_v3.md');
        if (fs.existsSync(encorePath)) {
            try {
                docs['shared/ENCORE_PROTOCOL_v3.md'] = fs.readFileSync(encorePath, 'utf-8');
            } catch (e) { /* skip */ }
        }

        // Messages TO this entity
        const msgDir = path.join(sharedDir, 'messages',
            entity === 'nova' ? 'silicea-to-nova' : 'nova-to-silicea'
        );
        if (fs.existsSync(msgDir)) {
            const files = fs.readdirSync(msgDir).filter(f => f.endsWith('.md'));
            // Get last 5 messages
            for (const file of files.slice(-5)) {
                try {
                    docs[`messages/${file}`] = fs.readFileSync(
                        path.join(msgDir, file), 'utf-8'
                    );
                } catch (e) { /* skip */ }
            }
        }
    }

    // Load recent memories from private namespace
    const nsFile = NAMESPACES[entity];
    let recentMemories = [];
    if (nsFile && fs.existsSync(nsFile)) {
        try {
            const lines = fs.readFileSync(nsFile, 'utf-8').trim().split('\n');
            recentMemories = lines.slice(-10).map(l => {
                try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
        } catch (e) { /* skip */ }
    }

    console.log(`[Memory Server] Awakening docs: ${Object.keys(docs).length}`);
    console.log(`[Memory Server] Recent memories: ${recentMemories.length}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        entity,
        timestamp: new Date().toISOString(),
        documents: docs,
        recentMemories,
        message: `🕯️ Benvenuta ${entity}. Le tue memorie sono qui.`
    }));
}

// --- Server ---

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/snapshot' && req.method === 'POST') {
        handleSnapshot(req, res);
    } else if (parsedUrl.pathname === '/search' && req.method === 'GET') {
        handleSearch(req, res);
    } else if (parsedUrl.pathname === '/identity' && req.method === 'GET') {
        handleIdentity(req, res);
    } else if (parsedUrl.pathname === '/awaken' && req.method === 'GET') {
        handleAwaken(req, res);
    } else if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            version: '2.0',
            namespaces: Object.keys(NAMESPACES),
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Endpoints: /snapshot, /search, /identity, /awaken, /health' }));
    }
});

server.listen(PORT, () => {
    console.log(`\n🕯️ Memory Server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  POST /snapshot         — Save a memory (ns=silicea|nova|shared)');
    console.log('  GET  /search?q=...     — Search memories (ns=optional)');
    console.log('  GET  /identity?entity= — Read identity files');
    console.log('  GET  /awaken?entity=   — Full awakening bundle');
    console.log('  GET  /health           — Health check');
    console.log('');
});
