import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TICKET_CATEGORIES } from '@helpdesk/shared'
import { loadKnowledgeBase, parseArticle, readArticles } from '../src/ai/knowledge-base.ts'

const SAMPLES = join(import.meta.dir, 'knowledge-base')

describe('loadKnowledgeBase', () => {
  test('combines the sample articles in file name order, frontmatter stripped', async () => {
    expect(await loadKnowledgeBase(SAMPLES)).toBe(
      [
        '<article file="a-login.md" category="general">',
        '# Login',
        '',
        '### I forgot my password',
        '',
        'Use the reset link on the sign-in page.',
        '</article>',
        '',
        '<article file="b-refunds.md" category="refund">',
        '# Refunds',
        '',
        '### How do I get a refund?',
        '',
        'Reply within 30 days of purchase.',
        '</article>',
      ].join('\n'),
    )
  })

  test('loads the real knowledge base, covering every category', async () => {
    const articles = await readArticles(join(import.meta.dir, '../knowledge-base'))
    expect(new Set(articles.map((article) => article.category))).toEqual(new Set(TICKET_CATEGORIES))
    expect(await loadKnowledgeBase()).toBe(await loadKnowledgeBase())
  })

  describe('an unusable folder', () => {
    let dir: string | undefined

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = undefined
    })

    test('refuses a folder with no articles', async () => {
      dir = await mkdtemp(join(tmpdir(), 'kb-'))
      await writeFile(join(dir, 'readme.txt'), 'nothing here')
      await expect(loadKnowledgeBase(dir)).rejects.toThrow('has no .md files')
    })

    test('refuses the whole folder when one article is malformed', async () => {
      dir = await mkdtemp(join(tmpdir(), 'kb-'))
      await writeFile(join(dir, 'good.md'), '---\ncategory: general\n---\nFine.\n')
      await writeFile(join(dir, 'bad.md'), 'No frontmatter.\n')
      await expect(loadKnowledgeBase(dir)).rejects.toThrow('bad.md has no frontmatter')
    })
  })
})

describe('parseArticle', () => {
  test('reads the category and trims the body', () => {
    expect(parseArticle('x.md', '---\r\ncategory: technical\r\n---\r\n\n  Body.\n\n')).toEqual({
      file: 'x.md',
      category: 'technical',
      body: 'Body.',
    })
  })

  test.each([
    ['an unknown category', '---\ncategory: billing\n---\nBody.'],
    ['no category line', '---\ntitle: Refunds\n---\nBody.'],
    ['a field besides the category', '---\ncategory: refund\ntitle: Refunds\n---\nBody.'],
    ['empty frontmatter', '---\n\n---\nBody.'],
  ])('refuses %s', (_, text) => {
    expect(() => parseArticle('x.md', text)).toThrow('needs frontmatter of one line')
  })

  test('refuses an article with no body', () => {
    expect(() => parseArticle('x.md', '---\ncategory: general\n---\n\n')).toThrow('is empty')
  })
})
