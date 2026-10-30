#!/usr/bin/env node
/**
 * CLI de la especificación de requisitos del negocio (C0 §3).
 *
 *   business-spec check                      valida YAML, JSON Schema, IDs, referencias, predicados, paridad
 *                                            ID ↔ evaluador, subtipos canónicos, ui_target y docs generados
 *   business-spec --check                    igual (así lo llama docs/audits/2026-09-09/verify-artifacts.cjs)
 *   business-spec docs --write               regenera docs/domain/business-requirements.md
 *   business-spec compile --out dist/spec.json
 *   business-spec report --snapshot f.json [--now ISO] [--format md|json]
 *   business-spec qa-truth --snapshot f.json --requirement ID [--item ID] [--intent C14] [--now ISO]
 *   business-spec qa-truth --snapshot f.json --intent C14     lista los requisitos que la responden (R1.1 F10)
 *
 * `--snapshot` acepta una foto (business-spec/tenant-snapshot@1) o filas heredadas (business-spec/legacy-rows@1).
 */
'use strict';
const path = require('node:path');

require('ts-node').register({ project: path.join(__dirname, '..', 'tsconfig.json'), transpileOnly: true, compilerOptions: { rootDir: path.join(__dirname, '..', '..') } });
const code = require('./cli.ts').main(process.argv.slice(2));
process.exitCode = code;
