import { useState } from 'react'
import { createFolder, addInlineCharacter, generateId } from '../state/folderStore'
import { createFolderUSK, saveFolderUSK } from '../state/unifiedStateKernel'
import { getActiveAccountId } from '../state/accountStore'

// ═══════════════════════ Styles ═══════════════════════

const S = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'center', padding: '0 12px', height: '48px', borderBottom: '0.5px solid var(--border2)', flexShrink: 0, gap: '8px' },
  title: { flex: 1, fontSize: '15px', fontWeight: 600, color: 'var(--text)' },
  body: { flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' },
  label: { fontSize: '12px', fontWeight: 500, color: 'var(--text2)', marginBottom: '4px', display: 'block' },
  textarea: { width: '100%', padding: '14px', borderRadius: '14px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '14px', color: 'var(--text)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.7 },
  input: { width: '100%', padding: '10px 12px', borderRadius: '12px', border: '0.5px solid var(--border)', background: 'var(--bg)', fontSize: '13px', color: 'var(--text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  hint: { fontSize: '11px', color: 'var(--text3)', lineHeight: 1.5 },
}

// ═══════════════════════ Main Component ═══════════════════════

export default function CreateFolder({ onBack, onCreated }) {
  const [settingText, setSettingText] = useState('')
  const [charNames, setCharNames] = useState('')
  const [worldName, setWorldName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = () => {
    if (creating) return
    setCreating(true)
    const text = settingText.trim()
    if (!text) return

    // Character names
    const raw = charNames.trim()
    const names = raw ? raw.split(/[,，\s\n]+/).filter(Boolean) : []
    if (names.length === 0) {
      alert('请在"角色名"输入框中填写至少一个角色名字（多个用逗号分隔）')
      setCreating(false)
      return
    }

    // World name: user input, fallback to character names
    const name = worldName.trim() || names.join('、')

    const folder = createFolder(name, '', text, getActiveAccountId(), '', '', '')
    const charsForUSK = []

    for (const cname of names) {
      const charData = {
        id: generateId(),
        name: cname,
        description: text,
        archetype: 'pursuer',
        affectionInitial: 0,
        affectionStages: [{ name: '默认', min: 0, max: 100, description: '好感度变化由设定文本中的描述决定' }],
        nickname: '',
        contextWindow: 40,
        temperature: 0.9,
        topP: 0.95,
      }
      addInlineCharacter(folder.id, charData)
      charsForUSK.push({ id: cname, name: cname, affectionInitial: 0 })
    }

    const usk = createFolderUSK(folder.id, charsForUSK, { sourceMode: 'drama' })
    saveFolderUSK(folder.id, usk)

    if (onCreated) onCreated(folder)
  }

  const hasContent = settingText.trim().length > 10

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button onClick={onBack} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span style={S.title}>创建新世界</span>
      </div>

      <div style={S.body}>
        <div>
          <label style={S.label}>🌍 世界名称</label>
          <div style={{ ...S.hint, marginBottom: '4px' }}>
            给你的世界起个名字。留空则自动用角色名拼凑。
          </div>
          <input
            style={S.input}
            value={worldName}
            onChange={e => setWorldName(e.target.value)}
            placeholder="如：暗潮、权与血、荆棘婚约…"
          />
        </div>

        <div>
          <label style={S.label}>📝 粘贴角色设定</label>
          <div style={{ ...S.hint, marginBottom: '6px' }}>
            不分字段、不分阶段——把你想写的一切都写在这个框里。AI 会直接读懂。
          </div>
          <textarea
            style={{ ...S.textarea, minHeight: 'calc(100dvh - 380px)' }}
            value={settingText}
            onChange={e => setSettingText(e.target.value)}
            placeholder={`把你脑子里的设定直接倒进来，像这样：

---

陆沉舟，28岁，黑道少主。表面风流不羁实则控制欲极强，说话带刺喜欢用反问句。好感低时把人当玩具敷衍了事，好感高时反而更危险——他不会放手了。从不道歉从不解释，生气时一言不发盯着你或者直接动手。对玩家称呼"小朋友"，初始好感度50。

好感低于30：冷漠敷衍，话不超过五个字，不正眼看人，碰一下就躲。
好感30-60：开始在意但死也不承认，用挑衅和讽刺掩盖关心。
好感60以上：占有欲全面爆发，不让走，敢走就堵，动手。

顾言深，26岁，清冷医生。话少但每条都在点上，手指修长永远不紧不慢。禁欲外表下控制欲极强，生气时手术刀插在你耳边的墙上。对玩家称呼"你"，初始好感度30。

玩家叫小明，普通大学生，误打误撞闯入了这个圈子。

世界观是现代都市偏暗黑。开场：小明在酒吧打工，陆沉舟推门进来——他认出了小明，但小明不知道他是谁。`}
          />
        </div>

        <div>
          <label style={S.label}>角色名（必填，多个用逗号分隔）</label>
          <div style={{ ...S.hint, marginBottom: '4px' }}>
            设定里有几个可攻略角色就填几个名字。逗号、空格、换行都可以分隔。
          </div>
          <input
            style={S.input}
            value={charNames}
            onChange={e => setCharNames(e.target.value)}
            placeholder="如：陆沉舟, 顾言深"
          />
        </div>
      </div>

      <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--border2)', flexShrink: 0, display: 'flex', gap: '10px' }}>
        <button style={{ flex: 1, padding: '14px', borderRadius: '14px', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: '15px', fontWeight: 500, cursor: 'pointer' }} onClick={onBack}>取消</button>
        <button style={{ flex: 1, padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: hasContent && !creating ? 'pointer' : 'default', opacity: hasContent && !creating ? 1 : 0.4 }} onClick={handleCreate} disabled={!hasContent || creating}>
          {creating ? '创建中…' : '开始'}
        </button>
      </div>
    </div>
  )
}
