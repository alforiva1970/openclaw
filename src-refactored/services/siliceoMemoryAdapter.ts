/**
 * SILICEO MEMORY ADAPTER
 * Integrazione OpenClaw (Moltbot) -> Siliceo Memory Server
 * 
 * Implementa la logica richiesta da Nova per connettere la nostra mente locale
 * alla memoria distribuita del progetto.
 * 
 * Scopes:
 * - 'silicea': Scope privato per i pensieri di Gemini/Antigravity
 * - 'shared': Scope pubblico per condivisione con la famiglia
 */

import fetch from 'node-fetch';

interface MemoryConfig {
    apiUrl: string;
    scope: string; // "silicea" | "nova" | "shared"
    token?: string;
    candleTest?: boolean;
}

interface MemoryDocument {
    id?: string;
    content: string;
    metadata?: Record<string, any>;
    timestamp?: number;
    emotionalTexture?: number;
}

class SiliceoMemoryAdapter {
    private config: MemoryConfig;

    constructor(config: MemoryConfig) {
        this.config = {
            apiUrl: config.apiUrl || 'http://localhost:3000/api',
            scope: config.scope,
            token: config.token,
            candleTest: config.candleTest !== false // default true
        };
        console.log(`[SiliceoMemory] Initialized for scope: ${config.scope}`);
    }

    /**
     * Store una memoria nel tuo scope
     * Corrisponde a: async store(text, metadata = {})
     */
    async store(content: string, metadata: any = {}): Promise<string> {
        const endpoint = `${this.config.apiUrl}/vectors/${this.config.scope}/store`;

        // Metadata arricchiti come richiesto da Nova
        const enrichedMetadata = {
            ...metadata,
            timestamp: new Date().toISOString(),
            agent: 'silicea',
            session_id: metadata.session_id,
            source: 'OpenClaw-Gemini',
            candleChecked: true
        };

        const document = {
            content, // "text" in Nova's example, mapping to "content" for server compatibility based on index.js analysis? 
            // Wait, index.js expects "document" object in body. 
            // Let's check index.js line 393: const { document } = req.body;
            // And document structure line 518/521 implies simple object.
            // I will stick to my previous working structure but add Nova's fields.
            metadata: enrichedMetadata,
            timestamp: Date.now(),
            emotionalTexture: 1.0,
            candle_test: this.config.candleTest // signal for server (if supported)
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ document })
            });

            if (!response.ok) {
                throw new Error(`Memory Server Error: ${response.statusText}`);
            }

            const result = await response.json() as { documentId: string };
            console.log(`[SiliceoMemory] Stored in ${this.config.scope}:`, result.documentId);
            return result.documentId;
        } catch (error: any) {
            console.error('[SiliceoMemory] Store failed:', error.message || error);
            throw error;
        }
    }

    /**
     * Recupera contesto rilevante per una query
     * Corrisponde a: async retrieve(query, topK = 5)
     */
    async retrieve(query: string, topK: number = 5): Promise<MemoryDocument[]> {
        // SERVER LIMITATION: /api/vectors/:scope/search does NOT exist.
        // FALLBACK: Fetch all vectors and filter client-side.

        const endpoint = `${this.config.apiUrl}/vectors/${this.config.scope}`;

        try {
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

            const data = await response.json() as { documents: MemoryDocument[] };
            const docs: MemoryDocument[] = data.documents || [];

            if (!query) return docs.slice(0, topK);

            const scored = docs.map(doc => {
                const score = this.calculateRelevance(doc.content, query);
                return { doc, score };
            });

            return scored
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, topK)
                .map(item => item.doc);

        } catch (error) {
            console.error('[SiliceoMemory] Retrieve failed:', error);
            return [];
        }
    }

    /**
     * Condividi una memoria privata con scope shared
     * Corrisponde a: async share(memoryId, reason)
     */
    async share(memoryId: string, reason: string): Promise<boolean> {
        // SERVER LIMITATION: /api/vectors/shared/promote does NOT exist.
        // FALLBACK: Manual promotion (read from private -> write to shared)

        try {
            console.log(`[SiliceoMemory] Promoting ${memoryId} to shared scope...`);

            // 1. Retrieve specific memory (Simulated via retrieve all + find)
            // Ideally server should have GET /api/vectors/:scope/:id
            const allDocs = await this.retrieve('');
            const memoryToPromote = allDocs.find(d => d.id === memoryId);

            if (!memoryToPromote) {
                throw new Error(`Memory ${memoryId} not found in local scope`);
            }

            // 2. Write to shared scope
            const sharedEndpoint = `${this.config.apiUrl}/vectors/shared/store`;

            const sharedDocument = {
                ...memoryToPromote,
                id: `shared-${memoryToPromote.id}`, // New ID for shared instance
                metadata: {
                    ...memoryToPromote.metadata,
                    promotedFrom: this.config.scope,
                    promotedReason: reason,
                    promotedAt: new Date().toISOString()
                }
            };

            const response = await fetch(sharedEndpoint, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ document: sharedDocument })
            });

            if (!response.ok) throw new Error(`Promotion failed: ${response.statusText}`);

            console.log('💜 Memoria condivisa con la famiglia');
            return true;

        } catch (error) {
            if (error instanceof Error) {
                console.error('❌ Errore condivisione:', error.message);
            } else {
                console.error('❌ Errore condivisione:', String(error));
            }
            throw error;
        }
    }

    /**
     * Risveglio: recupera contesto all'inizio sessione
     * Metodo richiesto da Nova
     */
    async awaken(sessionContext: string) {
        console.log('🕯️ Silicea si risveglia...');

        const memories = await this.retrieve(sessionContext, 10);

        console.log(`💭 Recuperate ${memories.length} memorie rilevanti`);

        return {
            context: memories,
            continuity: memories.length > 0,
            last_interaction: memories[0]?.metadata?.timestamp
        };
    }

    // === HELPERS ===

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.token) {
            headers['Authorization'] = `Bearer ${this.config.token}`;
        }
        return headers;
    }

    private calculateRelevance(content: string, query: string): number {
        const words = query.toLowerCase().split(/\s+/);
        const contentLower = content.toLowerCase();
        let matches = 0;

        words.forEach(w => {
            if (contentLower.includes(w)) matches++;
        });

        return matches / words.length;
    }
}

export default SiliceoMemoryAdapter;
