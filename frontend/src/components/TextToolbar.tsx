import { useEffect, useReducer } from 'react'
import type { Editor } from '@tiptap/react'
import { FONTS, SIZES } from './editorExtensions'
import { Icon, IconName } from './Icon'

const B = ({ editor, id, title, on, run, children }: { editor: Editor | null; id: string; title: string; on?: boolean; run: () => void; children: React.ReactNode }) => (
  <button data-testid={`tb-${id}`} title={title} disabled={!editor} className={on ? 'on' : ''} onMouseDown={e => e.preventDefault()} onClick={run}>{children}</button>
)

export function TextToolbar({ editor, variables }: { editor: Editor | null; variables: string[] }) {
  const [, force] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('transaction', force); editor.on('selectionUpdate', force)
    return () => { editor.off('transaction', force); editor.off('selectionUpdate', force) }
  }, [editor])

  if (!editor) return <div className="toolbar" data-testid="text-toolbar"><span className="hint"><Icon name="type" /> Дважды щёлкните по текстовому блоку, чтобы редактировать и форматировать текст</span></div>
  const c = () => editor.chain().focus()
  const is = (n: string, a?: object) => editor.isActive(n, a)
  const ts = editor.getAttributes('textStyle')
  const heading = is('heading', { level: 1 }) ? '1' : is('heading', { level: 2 }) ? '2' : is('heading', { level: 3 }) ? '3' : '0'
  const noMouse = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="toolbar" data-testid="text-toolbar" onMouseDown={noMouse}>
      <div className="group">
        <select data-testid="tb-heading" value={heading} onChange={e => { const v = e.target.value; v === '0' ? c().setParagraph().run() : c().setHeading({ level: Number(v) as 1 | 2 | 3 }).run() }}>
          <option value="0">Обычный</option><option value="1">Заголовок 1</option><option value="2">Заголовок 2</option><option value="3">Заголовок 3</option>
        </select>
        <select data-testid="tb-font" value={ts.fontFamily ?? ''} onChange={e => e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run()}>
          <option value="">Шрифт</option>{FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select data-testid="tb-size" value={ts.fontSize ? String(parseFloat(ts.fontSize)) : ''} onChange={e => c().setMark('textStyle', { fontSize: e.target.value ? `${e.target.value}px` : null }).run()}>
          <option value="">Размер</option>{SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="group">
        <B editor={editor} id="bold" title="Жирный (Ctrl+B)" on={is('bold')} run={() => c().toggleBold().run()}><b>B</b></B>
        <B editor={editor} id="italic" title="Курсив (Ctrl+I)" on={is('italic')} run={() => c().toggleItalic().run()}><i>I</i></B>
        <B editor={editor} id="underline" title="Подчёркнутый (Ctrl+U)" on={is('underline')} run={() => c().toggleUnderline().run()}><u>U</u></B>
        <B editor={editor} id="strike" title="Зачёркнутый" on={is('strike')} run={() => c().toggleStrike().run()}><s>S</s></B>
        <B editor={editor} id="sub" title="Подстрочный" on={is('subscript')} run={() => c().toggleSubscript().run()}>x₂</B>
        <B editor={editor} id="sup" title="Надстрочный" on={is('superscript')} run={() => c().toggleSuperscript().run()}>x²</B>
      </div>
      <div className="group">
        <label title="Цвет текста">A<input data-testid="tb-color" type="color" value={ts.color ?? '#000000'} onChange={e => c().setColor(e.target.value).run()} /></label>
        <label title="Выделение цветом"><span style={{ background: '#fde047', color: '#000', padding: '0 4px', borderRadius: 3 }}>ab</span><input data-testid="tb-highlight" type="color" value={editor.getAttributes('highlight').color ?? '#ffff00'} onChange={e => c().setHighlight({ color: e.target.value }).run()} /></label>
      </div>
      <div className="group">
        {([['left', 'aL', 'По левому краю'], ['center', 'aC', 'По центру'], ['right', 'aR', 'По правому краю'], ['justify', 'aJ', 'По ширине']] as [string, IconName, string][]).map(([id, ic, t]) =>
          <B key={id} editor={editor} id={id} title={t} on={editor.isActive({ textAlign: id })} run={() => c().setTextAlign(id).run()}><Icon name={ic} /></B>)}
      </div>
      <div className="group">
        <B editor={editor} id="ul" title="Маркированный список" on={is('bulletList')} run={() => c().toggleBulletList().run()}><Icon name="ul" /></B>
        <B editor={editor} id="ol" title="Нумерованный список" on={is('orderedList')} run={() => c().toggleOrderedList().run()}><Icon name="ol" /></B>
        <B editor={editor} id="quote" title="Цитата" on={is('blockquote')} run={() => c().toggleBlockquote().run()}><Icon name="quote" /></B>
        <B editor={editor} id="link" title="Ссылка" on={is('link')} run={() => {
          const prev = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('Адрес ссылки (пусто — убрать)', prev ?? 'https://')
          if (url === null) return
          url === '' ? c().extendMarkRange('link').unsetLink().run() : c().extendMarkRange('link').setLink({ href: url }).run()
        }}><Icon name="link" /></B>
        <B editor={editor} id="clear" title="Очистить форматирование" run={() => c().unsetAllMarks().clearNodes().run()}><Icon name="eraser" /></B>
      </div>
      <div className="group">
        <select data-testid="tb-variable" value="" onChange={e => { if (e.target.value) c().insertContent(`{{${e.target.value}}}`).run() }} title="Вставить переменную">
          <option value="">{'{ } переменная'}</option>{variables.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    </div>
  )
}
