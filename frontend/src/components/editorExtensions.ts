import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'

/** font-size on textStyle. The page canvas maps 1 CSS px to 1 pt, so the number is the Word point size. */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.fontSize || null,
          renderHTML: (a: Record<string, unknown>) => a.fontSize ? { style: `font-size: ${a.fontSize}` } : {},
        },
      },
    }]
  },
})

export const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
  Underline, TextStyle, Color, FontFamily, FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Link.configure({ openOnClick: false, autolink: false }),
  Subscript, Superscript,
]

export const FONTS = ['Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Verdana', 'Tahoma']
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
