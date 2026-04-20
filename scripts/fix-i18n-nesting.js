#!/usr/bin/env node
/**
 * Fixes i18n files where keys were created as top-level with literal dots
 * (e.g., "agent.capabilities": {...}) instead of being properly nested.
 * next-intl treats dots as path separators in useTranslations(), so literal-dot
 * top-level keys are unreachable.
 *
 * Also handles the special case "admin.testAgent" → agent.editor.testAgent.
 *
 * Idempotent: safe to run multiple times.
 */
const fs = require('fs');
const path = require('path');

const LANGS = ['es', 'en', 'pt', 'fr'];
const MESSAGES_DIR = path.join(__dirname, '..', 'apps', 'dashboard', 'messages');

function setNested(obj, pathParts, value) {
    let current = obj;
    for (let i = 0; i < pathParts.length - 1; i++) {
        const k = pathParts[i];
        if (!current[k] || typeof current[k] !== 'object' || Array.isArray(current[k])) {
            current[k] = {};
        }
        current = current[k];
    }
    const finalKey = pathParts[pathParts.length - 1];
    const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

    if (isObj(value) && isObj(current[finalKey])) {
        current[finalKey] = deepMerge(current[finalKey], value);
    } else {
        current[finalKey] = value;
    }
}

function deepMerge(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
        const av = out[k];
        const bv = b[k];
        const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
        if (isObj(av) && isObj(bv)) {
            out[k] = deepMerge(av, bv);
        } else {
            out[k] = bv;
        }
    }
    return out;
}

function fixFile(lang) {
    const file = path.join(MESSAGES_DIR, `${lang}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);

    // Special: admin.testAgent is a label used by the agent editor via the
    // "agent.editor" namespace → move it there as editor.testAgent.
    if (typeof json['admin.testAgent'] === 'string') {
        setNested(json, ['agent', 'editor', 'testAgent'], json['admin.testAgent']);
        delete json['admin.testAgent'];
    }

    // Move every remaining top-level key that contains a dot into its nested
    // equivalent.
    const topKeys = Object.keys(json);
    let moved = 0;
    for (const key of topKeys) {
        if (!key.includes('.')) continue;
        const value = json[key];
        const parts = key.split('.');
        setNested(json, parts, value);
        delete json[key];
        moved++;
    }

    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`${lang}.json — moved ${moved} top-level dotted keys into nested structure`);
}

for (const lang of LANGS) fixFile(lang);
console.log('Done.');
