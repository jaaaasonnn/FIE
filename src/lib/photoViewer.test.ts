import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { imageConfigDefault } from 'next/dist/shared/lib/image-config'
import { WIDTHS, optimised } from '@/components/listing/PhotoViewer'

// The full-screen photo viewer (tester-fixes-2) writes its image addresses itself, as next/image would, so that the
// listing page's script does not grow. They are only right while the site uses next/image's own defaults: a width or
// quality the optimiser was not told about is refused (400) and the photo would not show.
describe('the photo viewer\'s image addresses', () => {
  it('ask for next/image\'s own widths, at its own quality, through its own path', () => {
    expect(WIDTHS).toEqual(imageConfigDefault.deviceSizes)
    expect(imageConfigDefault.qualities ?? [75]).toContain(75)
    expect(optimised('https://images.unsplash.com/photo-1?w=1200&q=80', 640))
      .toBe(`${imageConfigDefault.path}?url=https%3A%2F%2Fimages.unsplash.com%2Fphoto-1%3Fw%3D1200%26q%3D80&w=640&q=75`)
  })

  it('next.config.ts sets none of the image settings they depend on', () => {
    const config = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')
    const images = config.slice(config.indexOf('images:'))
    for (const key of ['deviceSizes', 'qualities', 'loader', 'loaderFile', 'path', 'unoptimized']) {
      expect(images, `images.${key} would change the addresses next/image writes`).not.toMatch(new RegExp(`\\b${key}\\s*:`))
    }
  })
})
