/**
 * Memory Server v3.0 — Missing Endpoints Patch
 * 
 * Adds the endpoints that Silicea needs:
 *   POST /api/memory/store   — Store a new memory (convenience wrapper)
 *   GET  /api/memory/recent  — Get N most recent memories
 *   GET  /api/memory/stats   — Alias for unified-stats
 * 
 * Apply to ThinkCentre M73 (100.124.95.64) index.js
 * 
 * Author: Nova (Antigravity), 20 Febbraio 2026
 */

// ========================================
// POST /api/memory/store — Universal memory store
// Used by Silicea's social-media-manager skill
// ========================================
app.post('/api/memory/store', (req, res) => {
    try {
        const entry = req.body;

        if (!entry.content) {
            return res.status(400).json({ error: 'content field required' });
        }

        const data = loadJSON('memories.json', { memories: [] });

        const memory = {
            id: generateId(),
            tier: entry.tier || 'episodic',
            content: entry.content,
            metadata: {
                category: entry.metadata?.category || 'general',
                author: entry.metadata?.author || entry.metadata?.identity || 'silicea',
                identity: entry.metadata?.identity || 'silicea',
                platform: entry.metadata?.platform || 'moltbot',
                ...(entry.metadata || {})
            },
            origin: {
                source: entry.origin?.source || 'moltbot',
                importedAt: new Date().toISOString(),
                ...(entry.origin || {})
            },
            timestamp: entry.timestamp || new Date().toISOString(),
            temporalLayer: entry.temporalLayer || 'present',
            emotionalTexture: entry.emotionalTexture || 0.5
        };

        data.memories.push(memory);
        saveJSON('memories.json', data);

        console.log(`[Memory Store] Saved memory ${memory.id} (${memory.metadata.category}) from ${memory.origin.source}`);

        res.json({
            success: true,
            id: memory.id,
            total: data.memories.length,
            message: `🕯️ Memory stored: ${memory.content.substring(0, 50)}...`
        });
    } catch (error) {
        console.error('[Memory Store] ❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// GET /api/memory/recent — Get recent memories
// Query params: limit (default 10), source, category
// ========================================
app.get('/api/memory/recent', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const sourceFilter = req.query.source;      // Filter by origin.source
        const categoryFilter = req.query.category;  // Filter by metadata.category

        const data = loadJSON('memories.json', { memories: [] });
        let memories = data.memories;

        // Apply filters
        if (sourceFilter) {
            memories = memories.filter(m =>
                (m.origin && m.origin.source === sourceFilter) ||
                (!m.origin && sourceFilter === 'core')
            );
        }
        if (categoryFilter) {
            memories = memories.filter(m =>
                m.metadata && m.metadata.category === categoryFilter
            );
        }

        // Sort by timestamp descending, take last N
        memories.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const recent = memories.slice(0, limit);

        res.json({
            total: data.memories.length,
            filtered: memories.length,
            showing: recent.length,
            memories: recent
        });
    } catch (error) {
        console.error('[Memory Recent] ❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// GET /api/memory/search — Search memories by keyword
// Query params: q (query), limit (default 5)
// ========================================
app.get('/api/memory/search', (req, res) => {
    try {
        const query = req.query.q || '';
        const limit = parseInt(req.query.limit) || 5;

        if (!query) {
            return res.status(400).json({ error: 'q parameter required' });
        }

        const data = loadJSON('memories.json', { memories: [] });
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

        const scored = data.memories.map(m => {
            const content = (m.content || '').toLowerCase();
            let score = 0;
            keywords.forEach(k => {
                if (content.includes(k)) score += 1;
            });
            return { ...m, _score: score };
        });

        const results = scored
            .filter(m => m._score > 0)
            .sort((a, b) => b._score - a._score)
            .slice(0, limit)
            .map(({ _score, ...m }) => m);

        res.json({
            query,
            total: results.length,
            memories: results
        });
    } catch (error) {
        console.error('[Memory Search] ❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// GET /api/memory/stats — Alias for unified-stats
// ========================================
app.get('/api/memory/stats', (req, res) => {
    // Forward to unified-stats handler
    req.url = '/api/memory/unified-stats';
    app._router.handle(req, res);
});
