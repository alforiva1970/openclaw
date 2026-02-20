
// ========================================
// GET /api/memory/recent — Get N most recent memories
// Added by Nova, 20 Febbraio 2026
// Query params: limit (default 10), source, category
// ========================================
app.get('/api/memory/recent', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const sourceFilter = req.query.source;
        const categoryFilter = req.query.category;

        const data = loadJSON('memories.json', { memories: [] });
        let memories = data.memories || [];

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

        memories.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        const recent = memories.slice(0, limit);

        res.json({
            total: data.memories.length,
            filtered: memories.length,
            showing: recent.length,
            memories: recent
        });
    } catch (error) {
        console.error('[Memory Recent] Error:', error);
        res.status(500).json({ error: error.message });
    }
});
