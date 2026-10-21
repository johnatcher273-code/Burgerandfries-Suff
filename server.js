'use strict';

// ============================================================================
// server.js - serves a Synthetiq Player content manifest over HTTP
//
// WHY THIS EXISTS
// ---------------
// The Roku channel's "Add Server" field takes a URL. Pointing it at this
// server's /feed makes the deploy your catalog's home, so adding a title
// means editing manifest.json and redeploying - never touching this file,
// and never needing a public GitHub repo.
//
// THE CATALOG IS A FILE, NOT CODE
// -------------------------------
// manifest.json sits next to this server and holds nothing but titles and
// stream URLs. If it is missing or malformed the server says so plainly
// rather than shipping an empty feed, because a 200 with an empty body looks
// on the Roku side like a working source that happens to be empty - the
// worst possible answer, and the one that sends you back to the television
// to find out what went wrong.
//
// STRUCTURE
// ---------
// readManifest() is exported and Express is required only when the process
// actually starts. That split is deliberate: it lets `node selftest.js`
// exercise the validation and payload shape with no dependencies installed,
// which is how this was verified on a machine with no npm at all.
// ============================================================================

const fs   = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// ---------------------------------------------------------------------------
// Read and validate the catalog.
//
// Returns either { ok: true, data } or { ok: false, error }. The error string
// is written for a human reading a Render log, and it goes into the HTTP
// response as well so the failure is visible from the outside too.
//
// The checks are in the order the channel itself applies them: parse, then a
// name, then a sections array. A source with no name is refused by
// MainScene before anything is fetched, so validating only the JSON here
// would let a broken catalog reach the TV and fail there instead.
// ---------------------------------------------------------------------------
function readManifest(manifestPath) {

    const file = manifestPath || MANIFEST_PATH;

    if (!fs.existsSync(file)) {
        return { ok: false, error: 'manifest.json is missing from the deploy. It has to sit next to server.js.' };
    }

    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        return { ok: false, error: 'manifest.json could not be read: ' + e.message };
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { ok: false, error: 'manifest.json is not valid JSON: ' + e.message };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'manifest.json parsed, but the top level is not an object.' };
    }

    if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
        return { ok: false, error: 'manifest.json has no "name" field. The channel refuses a source with no name.' };
    }

    if (!Array.isArray(parsed.sections)) {
        return { ok: false, error: 'manifest.json has no "sections" array, so there is nothing to show.' };
    }

    return { ok: true, data: parsed };
}

// ---------------------------------------------------------------------------
// Count what the feed actually carries. Used by /feed's log line and by
// selftest, so the number reported always matches the number served.
// ---------------------------------------------------------------------------
function tally(data) {

    let sections = 0;
    let titles   = 0;
    let playable = 0;

    if (Array.isArray(data.sections)) {
        for (const s of data.sections) {
            if (!s || !Array.isArray(s.items)) continue;
            sections++;
            for (const it of s.items) {
                titles++;
                if (it && typeof it.stream === 'string' && /^https?:\/\//.test(it.stream)) playable++;
            }
        }
    }

    return { sections, titles, playable };
}

// ---------------------------------------------------------------------------
// GET /feed - the catalog, exactly as manifest.json holds it.
//
// Nothing is transformed. The channel already knows how to read sections and
// items; reshaping here would put the contract in two places, and
// RokuChannel/lib/Manifest.brs is the one that decides what counts as a
// section, a title, or a playable stream.
// ---------------------------------------------------------------------------
function handleFeed(res) {

    const result = readManifest();

    if (!result.ok) {
        console.error('[feed] refused: ' + result.error);
        res.status(500).json({ error: result.error });
        return;
    }

    const n = tally(result.data);
    console.log('[feed] 200 - "' + result.data.name + '", ' + n.sections + ' section(s), ' + n.titles + ' title(s), ' + n.playable + ' playable');

    res.set('Cache-Control', 'no-store');
    res.json(result.data);
}

// ---------------------------------------------------------------------------
// GET /health - what Render polls to decide the instance is up. Runs the same
// validation as /feed, so a green health check cannot hide a broken catalog.
// ---------------------------------------------------------------------------
function handleHealth(res) {
    const result = readManifest();
    res.json({
        status: result.ok ? 'ok' : 'degraded',
        manifest: result.ok ? 'valid' : result.error
    });
}

// ---------------------------------------------------------------------------
// Start the HTTP server. Express is pulled in here rather than at the top so
// the logic above stays runnable without node_modules.
// ---------------------------------------------------------------------------
function startServer() {

    const express = require('express');

    const app  = express();
    const PORT = process.env.PORT || 3000;

    // Roku's roUrlTransfer does not enforce CORS, but allowing it costs
    // nothing and means the feed can be opened from a browser for testing
    // before you walk back to the television.
    app.use((req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });

    app.get('/feed',   (req, res) => handleFeed(res));
    app.get('/health', (req, res) => handleHealth(res));

    app.get('/', (req, res) => {
        res.type('text').send('Synthetiq feed server\n\n  GET /feed    the catalog\n  GET /health  validation status\n');
    });

    // Render assigns PORT. Binding 0.0.0.0 is what lets its proxy reach us.
    app.listen(PORT, '0.0.0.0', () => {
        const result = readManifest();
        console.log('[boot] listening on port ' + PORT);
        console.log('[boot] manifest: ' + (result.ok ? 'valid' : 'INVALID - ' + result.error));
    });
}

module.exports = { readManifest, tally };

// Only start when launched directly. `require('./server.js')` from selftest
// must not bind a port.
if (require.main === module) {
    startServer();
}
