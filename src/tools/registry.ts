import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { join, resolve, normalize } from 'node:path'
import type { ToolDefinition, ExecuteToolFn } from '../types.js'

const DOCS_DIR = resolve(process.cwd(), 'docs')

// ── Définitions des tools (format Ollama) ────────────────────────────────────
export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Retourne la météo actuelle pour une ville. Utilise une API publique.',
      parameters: {
        type: 'object',
        required: ['city'],
        properties: {
          city: { type: 'string', description: 'Nom de la ville (ex: Paris, Lyon, Bordeaux)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Évalue une expression mathématique simple (ex: "2 + 3 * 4", "sqrt(16)").',
      parameters: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: { type: 'string', description: 'Expression mathématique à évaluer' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: 'Retourne la date et l\'heure actuelle.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_local_file',
      description: 'Lit le contenu d\'un fichier dans le dossier ./docs du projet.',
      parameters: {
        type: 'object',
        required: ['filename'],
        properties: {
          filename: { type: 'string', description: 'Nom du fichier dans ./docs (ex: "notes.md")' }
        }
      }
    }
  }
]

// ── Schémas Zod pour valider les arguments du LLM ───────────────────────────
// Le LLM peut halluiciner des arguments invalides — on valide TOUJOURS.
const argSchemas = {
  get_weather: z.object({ city: z.string().min(1) }),
  calculator: z.object({ expression: z.string().min(1) }),
  get_datetime: z.object({}).passthrough(),
  read_local_file: z.object({ filename: z.string().min(1) })
}

// ── Implémentations ──────────────────────────────────────────────────────────
async function get_weather({ city }: { city: string }): Promise<string> {
  // wttr.in : API météo publique gratuite, aucune clé requise
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+%h+humidité`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Météo indisponible pour ${city}`)
  return await res.text()
}

function calculator({ expression }: { expression: string }): string {
  // On évalue uniquement des expressions mathématiques pures
  // Sécurité : on rejette tout ce qui n'est pas des chiffres et opérateurs math
  const safe = /^[\d\s+\-*/().^%,a-z]+$/i
  if (!safe.test(expression)) throw new Error(`Expression non autorisée: ${expression}`)
  // Evaluation sécurisée via Function (scope limité)
  const mathFn = new Function(
    'Math',
    `"use strict"; return (${expression
      .replace(/\^/g, '**')
      .replace(/sqrt/g, 'Math.sqrt')
      .replace(/abs/g, 'Math.abs')
      .replace(/floor/g, 'Math.floor')
      .replace(/ceil/g, 'Math.ceil')
      .replace(/round/g, 'Math.round')
      .replace(/pi/gi, 'Math.PI')
    })`
  )
  const result = mathFn(Math)
  if (typeof result !== 'number' || !isFinite(result)) throw new Error('Résultat invalide')
  return String(result)
}

function get_datetime(): string {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
}

async function read_local_file({ filename }: { filename: string }): Promise<string> {
  // Sécurité : path traversal — on s'assure que le fichier est dans ./docs
  const target = normalize(join(DOCS_DIR, filename))
  if (!target.startsWith(DOCS_DIR + '/') && target !== DOCS_DIR) {
    throw new Error(`Accès refusé : ${filename} est en dehors de ./docs`)
  }
  const content = await readFile(target, 'utf8')
  return content.slice(0, 4000) // limite la taille pour le contexte LLM
}

const implementations: Record<string, (args: unknown) => Promise<unknown>> = {
  get_weather: async (args: unknown) => get_weather(args as { city: string }),
  calculator: async (args: unknown) => calculator(args as { expression: string }),
  get_datetime: async (_: unknown) => get_datetime(),
  read_local_file: async (args: unknown) => read_local_file(args as { filename: string })
}

// ── Exécuteur principal ──────────────────────────────────────────────────────
export const executeTool: ExecuteToolFn = async (name: string, rawArgs: unknown) => {
  const schema = (argSchemas as Record<string, z.ZodTypeAny>)[name]
  if (!schema) throw new Error(`Tool inconnu: ${name}`)

  const parsed = schema.safeParse(rawArgs)
  if (!parsed.success) throw new Error(`Arguments invalides pour ${name}: ${parsed.error.message}`)

  const impl = implementations[name]
  if (typeof impl !== 'function') throw new Error(`Implementation manquante pour ${name}`)
  return impl(parsed.data)
}
