import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { TICKET_CATEGORIES, type TicketCategory } from '@helpdesk/shared'

/** The articles the AI answers from, one markdown file per topic (task 5.4). */
export const KNOWLEDGE_BASE_DIR = join(import.meta.dir, '../../knowledge-base')

// Only the `category:` line is read, so a regex stands in for a YAML parser.
// Anything else in the frontmatter, or a file without it, is refused rather
// than guessed at: the category is what tells the AI which routing an article
// belongs to.
const FRONTMATTER = /^---\r?\n(?<fields>[\s\S]*?)\r?\n---\r?\n(?<body>[\s\S]*)$/
const CATEGORY_LINE = /^category:\s*(?<category>\S+)\s*$/

export type Article = { file: string; category: TicketCategory; body: string }

/**
 * Reads every `.md` file in `dir` and joins them into the one string the
 * system prompt carries (task 5.8). Files are taken in name order so the text
 * is byte-for-byte the same on every load: the prompt cache matches on exact
 * prefix, and a reordering would miss it on every call.
 *
 * Throws on an empty folder or a malformed article, so a broken knowledge
 * base stops the API at start instead of letting the AI answer without it.
 */
export async function loadKnowledgeBase(dir: string = KNOWLEDGE_BASE_DIR): Promise<string> {
  const articles = await readArticles(dir)
  return articles
    .map(
      ({ file, category, body }) =>
        `<article file="${file}" category="${category}">\n${body}\n</article>`,
    )
    .join('\n\n')
}

export async function readArticles(dir: string): Promise<Article[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort()
  if (files.length === 0) throw new Error(`Knowledge base ${dir} has no .md files`)

  return Promise.all(
    files.map(async (file) => parseArticle(file, await readFile(join(dir, file), 'utf8'))),
  )
}

export function parseArticle(file: string, text: string): Article {
  const match = FRONTMATTER.exec(text)
  if (!match?.groups) throw new Error(`Knowledge base article ${file} has no frontmatter`)

  const fields = match.groups.fields!.split(/\r?\n/).filter((line) => line.trim() !== '')
  const category = fields.length === 1 ? CATEGORY_LINE.exec(fields[0]!)?.groups?.category : null
  if (!isCategory(category)) {
    throw new Error(
      `Knowledge base article ${file} needs frontmatter of one line, category: ${TICKET_CATEGORIES.join(' | ')}`,
    )
  }

  const body = match.groups.body!.trim()
  if (body === '') throw new Error(`Knowledge base article ${file} is empty`)

  return { file, category, body }
}

function isCategory(value: string | null | undefined): value is TicketCategory {
  return TICKET_CATEGORIES.includes(value as TicketCategory)
}
