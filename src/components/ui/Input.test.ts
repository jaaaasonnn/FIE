import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

// The form fields used across the site. The behaviour is checked in a browser
// by the accessibility scan (e2e/tests/a11y), whose baseline no longer lists
// any field, select box or button without a name. This holds the lines that
// make it so in place.
const source = fs.readFileSync(path.join(__dirname, 'Input.tsx'), 'utf8')

describe('Input, Select and Textarea', () => {
  it('each ties its label to its field, so a screen reader says what the field is for', () => {
    // Three components, each with one label and one field
    expect(source.match(/<label htmlFor=\{id\}/g)).toHaveLength(3)
    expect(source.match(/^\s+id=\{id\}$/gm)).toHaveLength(3)
    expect(source.match(/const id = props\.id \?\? generated/g)).toHaveLength(3)
    expect(source).not.toMatch(/<label className=/)
  })

  it('the id comes after the spread props, so a field cannot lose it', () => {
    for (const field of source.split('{...props}').slice(1)) expect(field.trimStart().startsWith('id={id}')).toBe(true)
  })
})
